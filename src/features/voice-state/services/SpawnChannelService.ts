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

export class SpawnChannelService {
	private spawnChannelId?: string;

	constructor(
		private client: Client,
		private repository: VoiceDataRepository,
		private coordinator: SyncCoordinator,
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
					`✅ [SPAWN] Initialized preferences for user ${member.id} in guild ${member.guild.id}`,
				);
			}

			// Clean up any existing channels for this user
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

		// Move user into new channel
		try {
			await member.voice.setChannel(newChannel.id);
		} catch (error) {
			// If move fails, delete the channel
			console.error("🔸 [SPAWN] Failed to move user to new channel:", error);
			await newChannel.delete();
			throw new SpawnChannelError("Failed to move user to new channel", error);
		}

		// Record ownership
		await this.repository.recordOwnership(guild.id, newChannel.id, member.id);

		console.log(
			`✅ [SPAWN] Created channel '${channelName}' (ID: ${newChannel.id})`,
		);

		return newChannel;
	}

	/**
	 * Cleanup empty user channel
	 *
	 * Detects user channels by database flag and deletes if empty
	 */
	async cleanupEmptyChannel(channel: VoiceChannel): Promise<boolean> {
		// Check if this is a user channel in the database
		const isUserChannel = await this.repository.isUserChannel(channel.id);
		if (!isUserChannel) {
			return false;
		}

		// Check if channel is empty
		if (channel.members.size > 0) {
			return false;
		}

		try {
			const channelName = channel.name;
			await channel.delete();
			console.log(`✅ [SPAWN] Deleted empty channel ${channelName}`);
			return true;
		} catch (error) {
			console.error(`🔸 [SPAWN] Failed to delete channel ${channel.name}:`, error);
			return false;
		}
	}

	/**
	 * Cleanup existing channels for a user
	 *
	 * Removes any existing user channels to prevent duplicates
	 */
	private async cleanupExistingChannels(member: GuildMember): Promise<void> {
		const guild = member.guild;
		const existingChannels = guild.channels.cache.filter(
			(ch) =>
				ch.isVoiceBased() && ch.name === `${member.displayName}'s Channel`,
		);

		for (const channel of existingChannels.values()) {
			try {
				await channel.delete();
				console.log(`✅ [SPAWN] Deleted existing channel ${channel.name}`);
			} catch (error) {
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
		console.log(`✅ [SPAWN] Updated preferences for ${userId}`);
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

