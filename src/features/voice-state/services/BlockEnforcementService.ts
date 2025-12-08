/**
 * Block Enforcement Service
 *
 * Manages bidirectional user blocking for voice channels:
 * - Check if users can join channels together
 * - Apply/remove Discord permission overrides
 * - Enforce block restrictions on join/switch
 *
 * Block behavior:
 * - Bidirectional: User1 blocks User2 → neither can join channels with the other
 * - Block supersedes ban: Uses Discord permission overrides for visual feedback
 * - Grandfathering: Blocks applied mid-call don't kick the blocked user
 * - Persistent: Blocks persist across all sessions
 */

import type { Client, VoiceChannel, Guild } from "discord.js";
import type { VoiceDataRepository } from "../repositories/VoiceDataRepository";
import { PermissionOverrideHelper } from "./helpers/PermissionOverrideHelper";
import { VoiceLogger } from "./helpers/VoiceLogger";

export interface BlockCheckResult {
	allowed: boolean;
	reason?: string;
	blocker?: string;
}

export class BlockEnforcementService {
	constructor(
		private client: Client,
		private repository: VoiceDataRepository,
	) {}

	/**
	 * Check if user can join channel based on blocks
	 *
	 * Returns { allowed: true } if user can join, or
	 * { allowed: false, reason: "...", blocker: "userId" } if blocked
	 */
	async canUserJoinChannel(
		userId: string,
		channelId: string,
		guildId: string,
	): Promise<BlockCheckResult> {
		// Get all users currently in the channel
		const channelMembers = await this.getChannelMembers(channelId);

		// Get user's blocks
		const userPrefs = await this.repository.getUserPreferences(userId, guildId);
		const userBlocks = (userPrefs.blocked_users as string[]) || [];

		// Check if user has blocked anyone in the channel
		for (const memberId of channelMembers) {
			if (userBlocks.includes(memberId)) {
				const memberName = await this.getMemberName(memberId, guildId);
				return {
					allowed: false,
					reason: `you have ${memberName} blocked`,
					blocker: userId,
				};
			}
		}

		// Check if anyone in the channel has blocked the user
		// Use batch query to avoid N+1 queries
		if (channelMembers.length > 0) {
			const memberPrefsMap = await this.repository.getUserPreferencesBatch(
				channelMembers,
				guildId,
			);

			for (const memberId of channelMembers) {
				const memberPrefs = memberPrefsMap.get(memberId) || {};
				const memberBlocks = (memberPrefs.blocked_users as string[]) || [];

				if (memberBlocks.includes(userId)) {
					const memberName = await this.getMemberName(memberId, guildId);
					return {
						allowed: false,
						reason: `${memberName} has you blocked`,
						blocker: memberId,
					};
				}
			}
		}

		return { allowed: true };
	}

	/**
	 * Apply block permissions when a user enters a channel
	 *
	 * This locks the channel for all users blocked by the entrant.
	 * Called when a user joins or switches to a channel.
	 */
	async applyBlocksOnChannelEntry(
		userId: string,
		channelId: string,
		guildId: string,
	): Promise<void> {
		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild) {
				VoiceLogger.error("BLOCK", `Guild ${guildId} not found for applying block permissions on entry`);
				return;
			}

			const channel = guild.channels.cache.get(channelId) as VoiceChannel | undefined;
			if (!channel || !channel.isVoiceBased()) {
				return;
			}

			// Get user's blocked users
			const userPrefs = await this.repository.getUserPreferences(userId, guildId);
			const blockedUsers = (userPrefs.blocked_users as string[]) || [];

			if (blockedUsers.length > 0) {
				// Apply permissions using helper
				await PermissionOverrideHelper.applyToUsers(
					channel,
					blockedUsers,
					{ Connect: false },
					"BLOCK",
				);
			}
		} catch (error) {
			VoiceLogger.error("BLOCK", "Failed to apply blocks on channel entry", error);
		}
	}

	/**
	 * Apply block permission overrides to all user's owned channels
	 *
	 * Sets Connect = false permission override on all channels owned by blockerId
	 * This gives visual feedback in Discord UI (channel appears locked to blockedId)
	 */
	async applyBlockPermissions(
		blockerId: string,
		blockedId: string,
		guildId: string,
	): Promise<void> {
		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild) {
				VoiceLogger.error("BLOCK", `Guild ${guildId} not found for applying block permissions`);
				return;
			}

			// Get all channels owned by the blocker
			const channelData = await this.repository.getChannelsByOwner(
				guildId,
				blockerId,
			);

			VoiceLogger.block(`Applying block permissions to ${channelData.length} channels owned by ${blockerId}`);

			// Resolve channel objects
			const channels: VoiceChannel[] = [];
			for (const data of channelData) {
				const channel = guild.channels.cache.get(data.id) as VoiceChannel | undefined;
				if (channel?.isVoiceBased()) {
					channels.push(channel);
				}
			}

			// Apply permissions using helper
			await PermissionOverrideHelper.applyToChannels(
				channels,
				blockedId,
				{ Connect: false },
				"BLOCK",
			);
		} catch (error) {
			VoiceLogger.error("BLOCK", "Failed to apply block permissions", error);
		}
	}

	/**
	 * Sync block permissions for a specific channel
	 *
	 * Called when a channel is created or ownership transfers
	 * Applies Connect: false for all users blocked by the owner
	 */
	async syncBlockPermissionsForChannel(
		channelId: string,
		ownerId: string,
		guildId: string,
	): Promise<void> {
		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild) {
				VoiceLogger.error("BLOCK", `Guild ${guildId} not found for syncing block permissions`);
				return;
			}

			const channel = guild.channels.cache.get(channelId) as VoiceChannel | undefined;
			if (!channel || !channel.isVoiceBased()) {
				return;
			}

			// Get owner's blocked users
			const ownerPrefs = await this.repository.getUserPreferences(ownerId, guildId);
			const blockedUsers = (ownerPrefs.blocked_users as string[]) || [];

			VoiceLogger.block(`Syncing block permissions for channel ${channel.name} (owner: ${ownerId}, ${blockedUsers.length} blocked users)`);

			// Apply permissions using helper
			await PermissionOverrideHelper.applyToUsers(
				channel,
				blockedUsers,
				{ Connect: false },
				"BLOCK",
			);
		} catch (error) {
			VoiceLogger.error("BLOCK", "Failed to sync block permissions", error);
		}
	}

	/**
	 * Remove block permission overrides from all user's owned channels
	 *
	 * Removes Connect permission override from all channels owned by blockerId
	 */
	async removeBlockPermissions(
		blockerId: string,
		blockedId: string,
		guildId: string,
	): Promise<void> {
		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild) {
				VoiceLogger.error("BLOCK", `Guild ${guildId} not found for removing block permissions`);
				return;
			}

			// Get all channels owned by the blocker
			const channelData = await this.repository.getChannelsByOwner(
				guildId,
				blockerId,
			);

			VoiceLogger.block(`Removing block permissions from ${channelData.length} channels owned by ${blockerId}`);

			// Resolve channel objects
			const channels: VoiceChannel[] = [];
			for (const data of channelData) {
				const channel = guild.channels.cache.get(data.id) as VoiceChannel | undefined;
				if (channel?.isVoiceBased()) {
					channels.push(channel);
				}
			}

			// Remove permissions using helper
			await PermissionOverrideHelper.removeFromChannels(
				channels,
				blockedId,
				"BLOCK",
			);
		} catch (error) {
			VoiceLogger.error("BLOCK", "Failed to remove block permissions", error);
		}
	}

	/**
	 * Check if userA has userB blocked
	 */
	async hasUserBlocked(
		userA: string,
		userB: string,
		guildId: string,
	): Promise<boolean> {
		const prefs = await this.repository.getUserPreferences(userA, guildId);
		const blockedUsers = (prefs.blocked_users as string[]) || [];
		return blockedUsers.includes(userB);
	}

	/**
	 * Apply block permissions to all channels where blocker has members
	 * This handles non-user-owned channels (like permanent server channels)
	 *
	 * When user blocks someone, apply Connect: false to:
	 * - All channels the blocker owns (already handled by applyBlockPermissions)
	 * - All channels where the blocker is currently present (this method)
	 */
	async applyBlockToActiveChannels(
		blockerId: string,
		blockedId: string,
		guildId: string,
	): Promise<void> {
		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild) {
				VoiceLogger.error("BLOCK", `Guild ${guildId} not found for applying active channel blocks`);
				return;
			}

			// Get blocker's current voice channel
			const blockerMember = guild.members.cache.get(blockerId);
			if (!blockerMember?.voice.channel) {
				// Blocker not in a voice channel, nothing to do
				return;
			}

			const channel = blockerMember.voice.channel as VoiceChannel;

			// Try to apply permission override
			try {
				await channel.permissionOverwrites.edit(blockedId, {
					Connect: false,
				});
				VoiceLogger.block(`Applied Connect: false to active channel ${channel.name} for user ${blockedId}`);
			} catch (error) {
				VoiceLogger.error("BLOCK", `Failed to apply permissions to active channel ${channel.name}`, error);
			}
		} catch (error) {
			VoiceLogger.error("BLOCK", "Failed to apply active channel blocks", error);
		}
	}

	/**
	 * Remove block permissions from all channels where blocker has members
	 */
	async removeBlockFromActiveChannels(
		blockerId: string,
		blockedId: string,
		guildId: string,
	): Promise<void> {
		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild) {
				VoiceLogger.error("BLOCK", `Guild ${guildId} not found for removing active channel blocks`);
				return;
			}

			// Get blocker's current voice channel
			const blockerMember = guild.members.cache.get(blockerId);
			if (!blockerMember?.voice.channel) {
				// Blocker not in a voice channel, nothing to do
				return;
			}

			const channel = blockerMember.voice.channel as VoiceChannel;

			// Try to remove permission override
			try {
				await channel.permissionOverwrites.delete(blockedId);
				VoiceLogger.block(`Removed permissions from active channel ${channel.name} for user ${blockedId}`);
			} catch (error) {
				VoiceLogger.error("BLOCK", `Failed to remove permissions from active channel ${channel.name}`, error);
			}
		} catch (error) {
			VoiceLogger.error("BLOCK", "Failed to remove active channel blocks", error);
		}
	}

	/**
	 * Clean up block permissions on a channel when a user leaves
	 * This removes permission overrides that are no longer needed
	 *
	 * Should be called when a user leaves a non-owned channel
	 */
	async cleanupBlockPermissionsOnLeave(
		userId: string,
		channelId: string,
		guildId: string,
	): Promise<void> {
		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild) return;

			const channel = guild.channels.cache.get(channelId) as VoiceChannel | undefined;
			if (!channel || !channel.isVoiceBased()) return;

			// Check if this is a user-owned channel
			const ownerId = await this.repository.getCurrentOwner(channelId);
			if (ownerId === userId) {
				// User owns this channel, don't remove permissions
				// (they should persist even when owner leaves)
				return;
			}

			// Get the user's blocked users
			const userPrefs = await this.repository.getUserPreferences(userId, guildId);
			const blockedUsers = (userPrefs.blocked_users as string[]) || [];

			// Remove permission overrides for all blocked users
			for (const blockedUserId of blockedUsers) {
				try {
					await channel.permissionOverwrites.delete(blockedUserId);
					VoiceLogger.block(`Cleaned up permissions for ${blockedUserId} on ${channel.name} (user ${userId} left)`);
				} catch (error) {
					// Permission might not exist, that's fine
				}
			}
		} catch (error) {
			VoiceLogger.error("BLOCK", "Failed to cleanup block permissions", error);
		}
	}

	/**
	 * Get all users currently in a voice channel
	 */
	private async getChannelMembers(channelId: string): Promise<string[]> {
		const channel = this.client.channels.cache.get(channelId);
		if (!channel) return [];

		const voiceChannel = channel as VoiceChannel;
		if (!voiceChannel.isVoiceBased()) return [];

		return Array.from(voiceChannel.members.keys());
	}

	/**
	 * Get display name for a member (helper for error messages)
	 */
	private async getMemberName(userId: string, guildId: string): Promise<string> {
		const guild = this.client.guilds.cache.get(guildId);
		if (!guild) return userId;

		const member = guild.members.cache.get(userId);
		return member?.displayName || userId;
	}
}
