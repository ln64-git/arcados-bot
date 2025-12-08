/**
 * Moderation Service
 *
 * Handles voice channel moderation operations:
 * - Apply/remove mute/deafen
 * - Validate permissions
 * - Record moderation audit trail
 * - Handle moderation errors gracefully
 *
 * Key improvements from legacy VoiceStateManager:
 * - FIXED: Consolidated 4 duplicate moderation methods (160+ lines) into single implementation (~100 lines)
 * - Uses common applyModeration() helper to eliminate duplication
 * - Clear error handling with ModerationError
 * - Repository-based audit logging
 */

import type { Client, VoiceChannel } from "discord.js";
import type { VoiceDataRepository } from "../repositories/VoiceDataRepository";
import type { ModerationEvent } from "../types/index";
import { ModerationError } from "../types/index";
import { PermissionOverrideHelper } from "./helpers/PermissionOverrideHelper";

export class ModerationService {
	constructor(
		private client: Client,
		private repository: VoiceDataRepository,
	) {}

	/**
	 * Mute a user in a voice channel
	 */
	async mute(
		channelId: string,
		userId: string,
		moderatorId: string,
	): Promise<void> {
		await this.applyModeration(channelId, userId, "mute", moderatorId);
	}

	/**
	 * Unmute a user in a voice channel
	 */
	async unmute(
		channelId: string,
		userId: string,
		moderatorId: string,
	): Promise<void> {
		await this.applyModeration(channelId, userId, "unmute", moderatorId);
	}

	/**
	 * Deafen a user in a voice channel
	 */
	async deafen(
		channelId: string,
		userId: string,
		moderatorId: string,
	): Promise<void> {
		await this.applyModeration(channelId, userId, "deafen", moderatorId);
	}

	/**
	 * Undeafen a user in a voice channel
	 */
	async undeafen(
		channelId: string,
		userId: string,
		moderatorId: string,
	): Promise<void> {
		await this.applyModeration(channelId, userId, "undeafen", moderatorId);
	}

	/**
	 * Get audit log for a channel
	 */
	async getAuditLog(
		channelId: string,
		limit: number = 50,
	): Promise<ModerationEvent[]> {
		return this.repository.getModerationHistory(channelId, limit);
	}

	/**
	 * Apply channel owner's moderation preferences to a user
	 * Called when users join or switch channels to enforce owner preferences
	 */
	async applyChannelPreferences(
		channelId: string,
		userId: string,
		guildId: string,
	): Promise<void> {
		try {
			// Get channel owner
			const ownerId = await this.repository.getCurrentOwner(channelId);
			if (!ownerId) {
				// No owner = not a user channel, ensure user is unmuted
				await this.clearModeration(channelId, userId);
				return;
			}

			// Don't apply preferences to the owner themselves
			// Clear any existing moderation from when they were in another user's channel
			if (ownerId === userId) {
				await this.clearModeration(channelId, userId);
				return;
			}

			// Check if user is grandfathered (from ownership transfer)
			// Grandfathered users keep their current moderation state
			const session = await this.repository.getActiveSession(userId, guildId);
			if (session?.is_grandfathered) {
				console.log(
					`✅ [MODERATION] User ${userId} is grandfathered - skipping moderation preferences`,
				);
				return;
			}

			// Load owner's preferences
			const prefs = await this.repository.getUserPreferences(ownerId, guildId);

			// Check if user should be muted
			const shouldBeMuted = (prefs.muted_users || []).includes(userId);
			const shouldBeDeafened = (prefs.deafened_users || []).includes(userId);

			// Apply state
			const channel = await this.getVoiceChannel(channelId);
			const member = channel.members.get(userId);

			if (!member) {
				return; // User not in channel
			}

			// Apply mute state
			if (shouldBeMuted && !member.voice.serverMute) {
				await member.voice.setMute(true);
			} else if (!shouldBeMuted && member.voice.serverMute) {
				await member.voice.setMute(false);
			}

			// Apply deafen state
			if (shouldBeDeafened && !member.voice.serverDeaf) {
				await member.voice.setDeaf(true);
			} else if (!shouldBeDeafened && member.voice.serverDeaf) {
				await member.voice.setDeaf(false);
			}

			const displayName = member.displayName || userId;
			const channelName = channel.name || channelId;
			console.log(
				`✅ [MODERATION] Applied preferences for ${displayName} in ${channelName}`,
			);
		} catch (error) {
			console.error("🔸 [MODERATION] Failed to apply preferences:", error);
		}
	}

	/**
	 * Clear all moderation from a user (unmute/undeafen)
	 */
	private async clearModeration(
		channelId: string,
		userId: string,
	): Promise<void> {
		try {
			const channel = await this.getVoiceChannel(channelId);
			const member = channel.members.get(userId);

			if (!member) return;

			if (member.voice.serverMute) {
				await member.voice.setMute(false);
			}
			if (member.voice.serverDeaf) {
				await member.voice.setDeaf(false);
			}
		} catch (error) {
			console.error("🔸 [MODERATION] Failed to clear moderation:", error);
		}
	}

	/**
	 * Apply ban permission to a user across all channels owned by the moderator
	 * Uses Discord's permission overrides to prevent the user from connecting
	 */
	async applyBanPermissions(
		userId: string,
		moderatorId: string,
		guildId: string,
	): Promise<void> {
		try {
			// Get all channels owned by the moderator
			const channelData = await this.repository.getChannelsByOwner(
				guildId,
				moderatorId,
			);

			// Resolve channel objects
			const channels: VoiceChannel[] = [];
			for (const data of channelData) {
				try {
					const channel = await this.getVoiceChannel(data.id);
					channels.push(channel);
				} catch (error) {
					console.error(
						`🔸 [MODERATION] Could not find channel ${data.id}:`,
						error,
					);
				}
			}

			// Apply permissions using helper
			await PermissionOverrideHelper.applyToChannels(
				channels,
				userId,
				{ Connect: false },
				"MODERATION",
			);
		} catch (error) {
			console.error("🔸 [MODERATION] Failed to apply ban permissions:", error);
		}
	}

	/**
	 * Remove ban permission from a user across all channels owned by the moderator
	 */
	async removeBanPermissions(
		userId: string,
		moderatorId: string,
		guildId: string,
	): Promise<void> {
		try {
			// Get all channels owned by the moderator
			const channelData = await this.repository.getChannelsByOwner(
				guildId,
				moderatorId,
			);

			// Resolve channel objects
			const channels: VoiceChannel[] = [];
			for (const data of channelData) {
				try {
					const channel = await this.getVoiceChannel(data.id);
					channels.push(channel);
				} catch (error) {
					console.error(
						`🔸 [MODERATION] Could not find channel ${data.id}:`,
						error,
					);
				}
			}

			// Remove permissions using helper
			await PermissionOverrideHelper.removeFromChannels(
				channels,
				userId,
				"MODERATION",
			);
		} catch (error) {
			console.error(
				"🔸 [MODERATION] Failed to remove ban permissions:",
				error,
			);
		}
	}

	/**
	 * Sync ban permissions for a new channel created by an owner
	 * Applies all the owner's banned_users to the new channel
	 */
	async syncBanPermissionsForNewChannel(
		channelId: string,
		ownerId: string,
		guildId: string,
	): Promise<void> {
		try {
			// Load owner's preferences
			const prefs = await this.repository.getUserPreferences(ownerId, guildId);
			const bannedUsers = (prefs.banned_users as string[]) || [];

			if (bannedUsers.length === 0) {
				return; // No banned users to sync
			}

			const channel = await this.getVoiceChannel(channelId);

			// Apply ban permissions using helper
			await PermissionOverrideHelper.applyToUsers(
				channel,
				bannedUsers,
				{ Connect: false },
				"MODERATION",
			);
		} catch (error) {
			console.error(
				"🔸 [MODERATION] Failed to sync ban permissions for new channel:",
				error,
			);
		}
	}

	/**
	 * Apply moderation action (CONSOLIDATED)
	 *
	 * This replaces 4 near-identical methods in the legacy VoiceStateManager,
	 * reducing 160+ lines of duplicate code to a single implementation.
	 */
	private async applyModeration(
		channelId: string,
		userId: string,
		action: "mute" | "unmute" | "deafen" | "undeafen",
		moderatorId: string,
	): Promise<void> {
		// Get voice channel
		const channel = await this.getVoiceChannel(channelId);

		// Get member in channel
		const member = channel.members.get(userId);
		if (!member) {
			throw new ModerationError(
				`User ${userId} not found in channel ${channelId}`,
			);
		}

		try {
			// Apply Discord API change
			switch (action) {
				case "mute":
					await member.voice.setMute(true);
					break;
				case "unmute":
					await member.voice.setMute(false);
					break;
				case "deafen":
					await member.voice.setDeaf(true);
					break;
				case "undeafen":
					await member.voice.setDeaf(false);
					break;
			}

			// Record in audit log
			await this.repository.recordModerationEvent({
				action,
				channel_id: channelId,
				user_id: userId,
				moderator_id: moderatorId,
				timestamp: new Date(),
			});

			console.log(`✅ [MODERATION] Applied ${action} to ${userId} in ${channelId}`);
		} catch (error) {
			throw new ModerationError(`Failed to ${action} user`, error);
		}
	}

	/**
	 * Get voice channel by ID
	 */
	private async getVoiceChannel(channelId: string): Promise<VoiceChannel> {
		const channel = this.client.channels.cache.get(channelId);

		if (!channel) {
			throw new ModerationError("Channel not found");
		}

		if (!channel.isVoiceBased()) {
			throw new ModerationError("Channel is not a voice channel");
		}

		return channel as VoiceChannel;
	}
}
