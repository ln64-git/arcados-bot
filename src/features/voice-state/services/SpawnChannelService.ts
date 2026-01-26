/**
 * Spawn Channel Service
 *
 * Handles spawn channel auto-creation workflow:
 * - Detects spawn channel joins
 * - Creates user channels with preferences
 * - Positions channels correctly
 * - Handles concurrent spawn joins with locking
 * - Cleans up empty user channels
 *
 * Key improvements from legacy VoiceStateManager:
 * - FIXED: Uses SyncCoordinator for locking instead of static process-wide lock
 * - Clear separation of concerns (spawn channel-only, no session logic)
 * - Uses repository for all database operations
 */

import {
	ChannelType,
	type Client,
	type GuildMember,
	type VoiceChannel,
} from "discord.js";
import type { VoiceDataRepository } from "../repositories/VoiceDataRepository";
import type { SyncCoordinator } from "../../discord-sync/SyncCoordinator";
import type { VoiceChannelPreferences, ChannelData } from "../types/index";
import { SpawnChannelError } from "../types/index";
import type { ChannelOwnershipService } from "./ChannelOwnershipService";
import type { BlockEnforcementService } from "./BlockEnforcementService";
import { VoiceLogger } from "./helpers/VoiceLogger";

export class SpawnChannelService {
	private spawnChannelId?: string;
	// Track recently created channels to prevent premature cleanup
	private recentlyCreatedChannels = new Map<string, number>(); // channelId -> timestamp

	constructor(
		private client: Client,
		private repository: VoiceDataRepository,
		private coordinator: SyncCoordinator,
		private ownershipService: ChannelOwnershipService,
		private blockEnforcementService: BlockEnforcementService,
		spawnChannelId?: string,
	) {
		this.spawnChannelId = spawnChannelId;
	}

	/**
	 * Check if a channel is the spawn channel
	 */
	isSpawnChannel(channelId: string): boolean {
		return channelId === this.spawnChannelId;
	}

	/**
	 * Handle spawn channel join
	 *
	 * FIXED: Uses SyncCoordinator lock instead of static process-wide lock
	 */
	async handleSpawnChannelJoin(
		member: GuildMember,
	): Promise<VoiceChannel | null> {
		if (!this.spawnChannelId) {
			throw new SpawnChannelError("Spawn channel ID not configured");
		}

		const lockKey = `spawn:${member.guild.id}`;
		const releaseLock = await this.coordinator.acquireSpawnChannelLock(lockKey);

		try {
			// Load user preferences
			let prefs = await this.repository.getUserPreferences(
				member.id,
				member.guild.id,
			);

			// Initialize preferences if none exist (first time joining spawn channel)
			if (Object.keys(prefs).length === 0) {
				// Create default preferences entry in database
				await this.repository.updateUserPreferences(
					member.id,
					member.guild.id,
					{}, // Empty preferences, just creates the record
				);
				console.log(
					`🔹 [SPAWN] Initialized preferences for user ${member.id} in guild ${member.guild.id}`,
				);
			}

			// Clean up any existing channels for this user
			// Do this BEFORE creating a new channel to avoid confusion
			await this.cleanupExistingChannels(member);

			// Create new channel
			const channel = await this.createUserChannel(member, prefs);

			return channel;
		} catch (error) {
			console.error("🔸 [SPAWN] Failed to handle spawn join:", error);
			throw new SpawnChannelError("Failed to create user channel", error);
		} finally {
			// Release lock after 2 seconds to prevent rapid rejoins
			setTimeout(() => releaseLock(), 2000);
		}
	}

	/**
	 * Create user channel with preferences
	 */
	async createUserChannel(
		member: GuildMember,
		preferences: VoiceChannelPreferences,
	): Promise<VoiceChannel> {
		const guild = member.guild;
		const spawnChannel = guild.channels.cache.get(
			this.spawnChannelId!,
		) as VoiceChannel;

		if (!spawnChannel?.isVoiceBased()) {
			throw new SpawnChannelError("Spawn channel not found or not voice channel");
		}

		const channelName =
			preferences.channel_name || `${member.displayName}'s Channel`;

		// Create Discord channel
		const newChannel = await guild.channels.create({
			name: channelName,
			type: ChannelType.GuildVoice,
			parent: spawnChannel.parent ?? undefined,
			position: spawnChannel.position,
			userLimit: preferences.default_user_limit || 0,
		});

		// Position above spawn channel
		await newChannel.setPosition(spawnChannel.position - 1);

		// Grant owner Manage Channel permission so they can edit settings in Discord UI
		await newChannel.permissionOverwrites.edit(member.id, {
			ManageChannels: true,
		});

		// Apply hidden preference if set
		if (preferences.hidden === true) {
			const everyoneRole = guild.roles.everyone;
			
			// Hide channel from @everyone
			await newChannel.permissionOverwrites.create(everyoneRole.id, {
				ViewChannel: false,
			});

			// Ensure owner can see the channel
			await newChannel.permissionOverwrites.edit(member.id, {
				ViewChannel: true,
			});

			// Ensure bot can see the channel
			if (this.client.user) {
				await newChannel.permissionOverwrites.create(this.client.user.id, {
					ViewChannel: true,
				});
			}

			// Deny ViewChannel for all roles that have it allowed (from category or server)
			for (const [id, overwrite] of newChannel.permissionOverwrites.cache) {
				if (overwrite.type === 0 && id !== everyoneRole.id && overwrite.allow.has("ViewChannel")) {
					try {
						await newChannel.permissionOverwrites.edit(id, {
							ViewChannel: false,
						});
					} catch (error) {
						// Ignore errors for role permission updates
					}
				}
			}
		}

		// Insert into database (required for foreign key constraints)
		const channelData: ChannelData = {
			id: newChannel.id,
			guild_id: guild.id,
			name: channelName,
			type: ChannelType.GuildVoice,
			parent_id: newChannel.parentId,
			position: newChannel.position,
			is_user_channel: true,
			current_owner_id: member.id,
		};

		await this.repository.insertChannel(channelData);

		// Mark channel as recently created to prevent premature cleanup
		this.recentlyCreatedChannels.set(newChannel.id, Date.now());

		// Clean up old "recently created" entries (older than 10 seconds)
		const tenSecondsAgo = Date.now() - 10000;
		for (const [channelId, timestamp] of this.recentlyCreatedChannels.entries()) {
			if (timestamp < tenSecondsAgo) {
				this.recentlyCreatedChannels.delete(channelId);
			}
		}

		// Move user into new channel
		try {
			await member.voice.setChannel(newChannel.id);

			// Verify user is actually in the channel (wait a bit for Discord to update)
			// This prevents race conditions where cleanup runs before Discord updates member list
			await new Promise(resolve => setTimeout(resolve, 500));

			// Double-check the user is in the channel
			const freshChannel = guild.channels.cache.get(newChannel.id) as VoiceChannel | undefined;
			if (!freshChannel || !freshChannel.members.has(member.id)) {
				throw new Error("User not found in channel after move");
			}
		} catch (error) {
			// If move fails, delete the channel
			VoiceLogger.error("SPAWN", "Failed to move user to new channel", error);
			this.recentlyCreatedChannels.delete(newChannel.id);
			await newChannel.delete();
			// Delete from database to prevent ghost channels
			try {
				await this.repository.deleteChannel(newChannel.id);
			} catch (dbError) {
				// Ignore - channel creation failed anyway
			}
			throw new SpawnChannelError("Failed to move user to new channel", error);
		}

		// Record ownership
		await this.repository.recordOwnership(guild.id, newChannel.id, member.id);

		// Verify ownership was set correctly
		const verifiedOwner = await this.repository.getCurrentOwner(newChannel.id);
		if (verifiedOwner !== member.id) {
			console.error(`🔸 [SPAWN] Ownership verification failed! Expected ${member.id}, got ${verifiedOwner}`);
			// Try to fix it
			await this.repository.updateChannel(newChannel.id, {
				current_owner_id: member.id,
			});
		}

		return newChannel;
	}

	/**
	 * Cleanup empty user channel
	 *
	 * Detects user channels by database flag and deletes if empty
	 * Prevents cleanup of recently created channels to avoid race conditions
	 * BUT: If channel is truly empty (no members), allow cleanup even if recently created
	 */
	async cleanupEmptyChannel(channel: VoiceChannel): Promise<boolean> {
		// Check if channel is empty first - if it has members, don't delete regardless of age
		const isEmpty = channel.members.size === 0;

		// Don't cleanup channels that were just created (within last 3 seconds) UNLESS they're empty
		// This prevents race conditions where cleanup runs before user is moved
		// But if the channel is truly empty, we can clean it up even if recently created
		if (this.recentlyCreatedChannels.has(channel.id) && !isEmpty) {
			const createdTime = this.recentlyCreatedChannels.get(channel.id)!;
			const age = Date.now() - createdTime;
			if (age < 3000) {
				VoiceLogger.info("SPAWN", `Skipping cleanup of recently created channel ${channel.name} (${age}ms old, has ${channel.members.size} members)`);
				return false;
			}
			// Channel is old enough and has members, remove from tracking
			this.recentlyCreatedChannels.delete(channel.id);
		}

		// Check if this is a user channel in the database
		const isUserChannel = await this.repository.isUserChannel(channel.id);
		if (!isUserChannel) {
			return false;
		}

		// Check if channel is empty (double-check after potential delay)
		if (!isEmpty) {
			return false;
		}

		// If channel is empty, remove from recently created tracking (it's safe to delete)
		if (this.recentlyCreatedChannels.has(channel.id)) {
			this.recentlyCreatedChannels.delete(channel.id);
		}

		try {
			// Delete from Discord first
			await channel.delete();

			// Delete from database to prevent ghost channels
			try {
				await this.repository.deleteChannel(channel.id);
			} catch (dbError) {
				// Log but don't fail - Discord deletion succeeded
				VoiceLogger.error("SPAWN", `Failed to delete channel ${channel.name} from database`, dbError);
			}

			return true;
		} catch (error: any) {
			// Ignore "Unknown Channel" errors (channel already deleted)
			if (error?.code === 10003) {
				this.recentlyCreatedChannels.delete(channel.id);
				// Try to clean up database record even if Discord channel is already gone
				try {
					await this.repository.deleteChannel(channel.id);
				} catch (dbError) {
					// Ignore - channel might not exist in DB either
				}
				return false; // Channel already deleted, consider it cleaned up
			}
			VoiceLogger.error("SPAWN", `Failed to delete channel ${channel.name}`, error);
			return false;
		}
	}

	/**
	 * Handle owner leaving a channel that still has members
	 * Transfers ownership to the next longest-tenured member
	 */
	async handleOwnerLeave(channel: VoiceChannel, leavingOwnerId: string): Promise<void> {
		try {
			// Check if there are still members in the channel (using Discord API, not DB)
			if (channel.members.size === 0) {
				console.log(`🔹 [OWNERSHIP] Channel ${channel.name} is empty, will be deleted`);
				return;
			}

			console.log(
				`🔄 [OWNERSHIP] Owner ${leavingOwnerId} left ${channel.name} with ${channel.members.size} members remaining`,
			);

			// Find the longest-tenured member from the remaining members
			// We need to query each member's session to find who joined earliest
			let oldestMember: { userId: string; joinedAt: Date } | null = null;

			for (const [userId, member] of channel.members) {
				// Skip the leaving owner
				if (userId === leavingOwnerId) continue;

				// Get their active session
				const session = await this.repository.getActiveSession(userId, channel.guild.id);
				if (!session) {
					console.log(`🔸 [OWNERSHIP] No active session found for ${member.displayName}`);
					continue;
				}

				console.log(`🔍 [OWNERSHIP] ${member.displayName} joined at ${session.joined_at.toISOString()}`);

				// Check if this is the oldest
				if (!oldestMember || session.joined_at < oldestMember.joinedAt) {
					oldestMember = { userId, joinedAt: session.joined_at };
				}
			}

			if (oldestMember) {
				const newOwner = channel.members.get(oldestMember.userId);
				const newOwnerName = newOwner?.displayName || oldestMember.userId;
				console.log(`🔄 [OWNERSHIP] Transferring ownership to ${newOwnerName} (joined at ${oldestMember.joinedAt.toISOString()})`);

				// Transfer ownership (this will also handle grandfathering and renaming)
				await this.ownershipService.transferOwnership(channel.id, oldestMember.userId);

				// Sync block permissions for new owner
				await this.blockEnforcementService.syncBlockPermissionsForChannel(
					channel.id,
					oldestMember.userId,
					channel.guild.id,
				);
			} else {
				console.log(`🔸 [OWNERSHIP] No eligible members to transfer ownership to (${channel.members.size} members in channel)`);
			}
		} catch (error) {
			console.error(`🔸 [OWNERSHIP] Failed to handle owner leave:`, error);
		}
	}

	/**
	 * Cleanup existing channels for a user
	 *
	 * Removes any existing user channels owned by this user to prevent duplicates
	 * Checks both by name (for backwards compatibility) and by database ownership
	 */
	private async cleanupExistingChannels(member: GuildMember): Promise<void> {
		const guild = member.guild;

		// Find channels by name (for backwards compatibility)
		const channelsByName = guild.channels.cache.filter(
			(ch): ch is VoiceChannel =>
				ch.isVoiceBased() && ch.name === `${member.displayName}'s Channel`,
		);

		// Also find channels owned by this user in the database
		const allVoiceChannels = guild.channels.cache.filter(
			(ch): ch is VoiceChannel => ch.isVoiceBased(),
		);

		const channelsToDelete: VoiceChannel[] = [];

		// Check each voice channel to see if it's owned by this user
		for (const channel of allVoiceChannels.values()) {
			const owner = await this.repository.getCurrentOwner(channel.id);
			if (owner === member.id) {
				channelsToDelete.push(channel);
			}
		}

		// Also add channels found by name (in case they're not in DB yet)
		for (const channel of channelsByName.values()) {
			if (!channelsToDelete.includes(channel)) {
				channelsToDelete.push(channel);
			}
		}

		// Delete all found channels (but only if they're empty)
		for (const channel of channelsToDelete) {
			try {
				// Double-check channel still exists and is empty before deleting
				const freshChannel = guild.channels.cache.get(channel.id) as VoiceChannel | undefined;
				if (!freshChannel) {
					// Channel already deleted, remove from tracking if present
					this.recentlyCreatedChannels.delete(channel.id);
					continue;
				}

				// Don't delete recently created channels (they might be the one we're about to use)
				if (this.recentlyCreatedChannels.has(channel.id)) {
					const createdTime = this.recentlyCreatedChannels.get(channel.id)!;
					const age = Date.now() - createdTime;
					if (age < 5000) {
						VoiceLogger.info("SPAWN", `Skipping deletion of recently created channel ${freshChannel.name}`);
						continue;
					}
				}

				// Only delete if empty (user might have moved to it)
				// Also check that the member is NOT in this channel (they should be in spawn)
				if (freshChannel.members.size === 0 && !freshChannel.members.has(member.id)) {
					await freshChannel.delete();
					// Delete from database to prevent ghost channels
					try {
						await this.repository.deleteChannel(freshChannel.id);
					} catch (dbError) {
						VoiceLogger.error("SPAWN", `Failed to delete channel ${freshChannel.name} from database`, dbError);
					}
					this.recentlyCreatedChannels.delete(channel.id); // Remove from tracking
					VoiceLogger.spawn(`Deleted existing channel ${freshChannel.name} (owned by ${member.displayName})`);
				} else if (freshChannel.members.has(member.id)) {
					VoiceLogger.info("SPAWN", `Skipping deletion of ${freshChannel.name} - user is in this channel`);
				} else {
					VoiceLogger.info("SPAWN", `Skipping deletion of ${freshChannel.name} - has ${freshChannel.members.size} members`);
				}
			} catch (error: any) {
				// Ignore "Unknown Channel" errors (channel already deleted)
				if (error?.code === 10003) {
					this.recentlyCreatedChannels.delete(channel.id);
					continue;
				}
				console.error(
					"🔸 [SPAWN] Failed to delete existing channel:",
					error,
				);
			}
		}
	}

	/**
	 * Update user preferences
	 */
	async updatePreferences(
		userId: string,
		guildId: string,
		preferences: VoiceChannelPreferences,
	): Promise<void> {
		await this.repository.updateUserPreferences(userId, guildId, preferences);
		// Don't log - reduces log spam for frequent preference updates
	}

	/**
	 * Get user preferences
	 */
	async getPreferences(
		userId: string,
		guildId: string,
	): Promise<VoiceChannelPreferences> {
		return this.repository.getUserPreferences(userId, guildId);
	}
}

