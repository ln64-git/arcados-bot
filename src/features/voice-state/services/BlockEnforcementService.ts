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
		for (const memberId of channelMembers) {
			const memberPrefs = await this.repository.getUserPreferences(
				memberId,
				guildId,
			);
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

		return { allowed: true };
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
				console.error(
					`🔸 [BLOCK] Guild ${guildId} not found for applying block permissions`,
				);
				return;
			}

			// Get all channels owned by the blocker
			const ownerChannels = await this.repository.getChannelsByOwner(
				blockerId,
				guildId,
			);

			console.log(
				`🔹 [BLOCK] Applying block permissions to ${ownerChannels.length} channels owned by ${blockerId}`,
			);

			for (const channelData of ownerChannels) {
				const channel = guild.channels.cache.get(channelData.id) as
					| VoiceChannel
					| undefined;
				if (!channel || !channel.isVoiceBased()) continue;

				try {
					await channel.permissionOverwrites.edit(blockedId, {
						Connect: false,
					});
					console.log(
						`✅ [BLOCK] Applied Connect: false to ${channel.name} for user ${blockedId}`,
					);
				} catch (error) {
					console.error(
						`🔸 [BLOCK] Failed to apply permissions to channel ${channel.name}:`,
						error,
					);
				}
			}
		} catch (error) {
			console.error("🔸 [BLOCK] Failed to apply block permissions:", error);
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
				console.error(
					`🔸 [BLOCK] Guild ${guildId} not found for removing block permissions`,
				);
				return;
			}

			// Get all channels owned by the blocker
			const ownerChannels = await this.repository.getChannelsByOwner(
				blockerId,
				guildId,
			);

			console.log(
				`🔹 [BLOCK] Removing block permissions from ${ownerChannels.length} channels owned by ${blockerId}`,
			);

			for (const channelData of ownerChannels) {
				const channel = guild.channels.cache.get(channelData.id) as
					| VoiceChannel
					| undefined;
				if (!channel || !channel.isVoiceBased()) continue;

				try {
					// Delete the permission override entirely
					await channel.permissionOverwrites.delete(blockedId);
					console.log(
						`✅ [BLOCK] Removed permissions from ${channel.name} for user ${blockedId}`,
					);
				} catch (error) {
					console.error(
						`🔸 [BLOCK] Failed to remove permissions from channel ${channel.name}:`,
						error,
					);
				}
			}
		} catch (error) {
			console.error("🔸 [BLOCK] Failed to remove block permissions:", error);
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
