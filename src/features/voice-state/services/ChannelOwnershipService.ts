/**
 * Channel Ownership Service
 *
 * Manages channel ownership transfers and succession:
 * - Track current owner
 * - Determine ownership succession
 * - Handle ownership claims/renounce
 * - Query ownership history
 *
 * Key improvements from legacy VoiceStateManager:
 * - FIXED: N+1 query pattern - uses batch query for ownership determination
 * - Clear separation of concerns (ownership-only logic)
 * - Uses repository for all database operations
 */

import type { Client, VoiceChannel } from "discord.js";
import type { VoiceDataRepository } from "../repositories/VoiceDataRepository";
import type { MemberJoinTime } from "../types/index";
import { OwnershipError } from "../types/index";

export class ChannelOwnershipService {
	constructor(
		private client: Client,
		private repository: VoiceDataRepository,
	) {}

	/**
	 * Claim channel ownership
	 *
	 * User can claim ownership if:
	 * - They are in the channel
	 * - Channel has no current owner
	 */
	async claimChannel(channelId: string, userId: string): Promise<boolean> {
		const canClaim = await this.canUserClaim(channelId, userId);

		if (!canClaim) {
			return false;
		}

		await this.transferOwnership(channelId, userId);
		return true;
	}

	/**
	 * Transfer ownership to a new user
	 */
	async transferOwnership(channelId: string, newOwnerId: string): Promise<void> {
		// Update channel owner in database
		await this.repository.updateChannel(channelId, {
			current_owner_id: newOwnerId,
		});

		// Record ownership change
		const channel = this.client.channels.cache.get(channelId);
		if (channel) {
			const voiceChannel = channel as VoiceChannel;
			await this.repository.recordOwnership(
				voiceChannel.guild.id,
				channelId,
				newOwnerId,
			);
		}

		console.log(
			`✅ [OWNERSHIP] Transferred ownership of ${channelId} to ${newOwnerId}`,
		);
	}

	/**
	 * Renounce ownership
	 *
	 * Current owner gives up ownership, next oldest member becomes owner
	 */
	async renounceOwnership(channelId: string, userId: string): Promise<void> {
		const currentOwner = await this.repository.getCurrentOwner(channelId);

		if (currentOwner !== userId) {
			throw new OwnershipError("User is not the current owner");
		}

		const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
		if (!channel) {
			throw new OwnershipError("Channel not found");
		}

		// Determine next owner
		const nextOwner = await this.determineNextOwner(channel);

		if (nextOwner) {
			await this.transferOwnership(channelId, nextOwner);
			console.log(
				`✅ [OWNERSHIP] Ownership transferred to ${nextOwner} after ${userId} renounced`,
			);
		} else {
			// No one else in channel, clear owner
			await this.repository.updateChannel(channelId, {
				current_owner_id: null,
			});
			console.log(
				`✅ [OWNERSHIP] Ownership cleared for ${channelId} (no members left)`,
			);
		}
	}

	/**
	 * Determine next owner (OPTIMIZED - single batch query)
	 *
	 * Previous implementation had N+1 query pattern (queried each member individually).
	 * New implementation uses single batch query to get all members with join times.
	 *
	 * Returns the oldest non-owner member in the channel.
	 */
	async determineNextOwner(channel: VoiceChannel): Promise<string | null> {
		// OPTIMIZED: Single query instead of N+1
		const members = await this.repository.getChannelMembersWithJoinTimes(
			channel.id,
		);

		if (members.length === 0) {
			return null;
		}

		// Find first non-owner (oldest join time)
		const nextOwner = members.find((m) => !m.is_owner);
		return nextOwner?.user_id || null;
	}

	/**
	 * Check if user can claim channel
	 */
	async canUserClaim(channelId: string, userId: string): Promise<boolean> {
		const channel = this.client.channels.cache.get(channelId) as VoiceChannel;

		if (!channel || !channel.isVoiceBased()) {
			return false;
		}

		// User must be in the channel
		if (!channel.members.has(userId)) {
			return false;
		}

		// Channel must not have an owner
		const currentOwner = await this.repository.getCurrentOwner(channelId);
		return currentOwner === null;
	}

	/**
	 * Get current owner of a channel
	 */
	async getOwner(channelId: string): Promise<string | null> {
		return this.repository.getCurrentOwner(channelId);
	}

	/**
	 * Check if user is owner of a channel
	 */
	async isOwner(channelId: string, userId: string): Promise<boolean> {
		const currentOwner = await this.repository.getCurrentOwner(channelId);
		return currentOwner === userId;
	}
}
