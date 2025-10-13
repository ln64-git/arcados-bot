import type { GuildMember, VoiceChannel } from "discord.js";
import type { UserModerationPreferences } from "../../types";
import { getCacheManager } from "../cache-management/DiscordDataCache";

export interface ChannelNamingConfig {
	skipRenamePatterns?: string[];
}

export class ChannelNamingService {
	private cache = getCacheManager();
	private readonly renameCooldown = new Map<string, number>();
	private readonly COOLDOWN_MS = 5000; // 5 second cooldown between renames

	/**
	 * Centralized channel naming logic
	 * Prevents multiple handlers from fighting over channel names
	 */
	async setNameForOwner(
		channel: VoiceChannel,
		ownerId: string,
		config: ChannelNamingConfig = {},
	): Promise<boolean> {
		const channelId = channel.id;
		const now = Date.now();

		// Check cooldown to prevent rapid renames
		const lastRename = this.renameCooldown.get(channelId);
		if (lastRename && now - lastRename < this.COOLDOWN_MS) {
			console.log(`🔸 Channel ${channelId} rename on cooldown, skipping`);
			return false;
		}

		// Determine the target name
		const targetName = await this.determineChannelName(
			channel,
			ownerId,
			config,
		);

		if (!targetName || targetName === channel.name) {
			return false; // No change needed
		}

		// Check if we should skip this rename
		if (this.shouldSkipRename(channel.name, config.skipRenamePatterns)) {
			console.log(
				`🔸 Skipping rename for channel "${channel.name}" (matches skip pattern)`,
			);
			return false;
		}

		try {
			// Set cooldown before attempting rename
			this.renameCooldown.set(channelId, now);

			// Perform the rename
			await channel.setName(targetName);
			console.log(`🔹 Renamed channel to "${targetName}" for owner ${ownerId}`);

			return true;
		} catch (error) {
			console.warn(`🔸 Failed to rename channel to "${targetName}": ${error}`);
			return false;
		}
	}

	/**
	 * Determine what the channel name should be
	 * Priority: 1. User's preferred channel name, 2. Default template with nickname/displayName
	 */
	private async determineChannelName(
		channel: VoiceChannel,
		ownerId: string,
		config: ChannelNamingConfig,
	): Promise<string | null> {
		// 1. Get user preferences from cache
		const preferences = await this.cache.getUserPreferences(
			ownerId,
			channel.guild.id,
		);

		// 2. Use preferred channel name if available
		if (preferences?.preferredChannelName) {
			return preferences.preferredChannelName;
		}

		// 3. Use default template: "{nickname/displayName}'s Channel"
		const member = channel.guild.members.cache.get(ownerId);
		if (member) {
			// Use server nickname if available, otherwise displayName
			const nameToUse =
				member.nickname || member.displayName || member.user.username;
			return `${nameToUse}'s Channel`;
		}

		return null;
	}

	/**
	 * Check if we should skip renaming based on current name patterns
	 */
	private shouldSkipRename(
		currentName: string,
		skipPatterns?: string[],
	): boolean {
		const patterns = skipPatterns || ["available", "new channel", "temp"];
		const lowerName = currentName.toLowerCase();

		return patterns.some((pattern) => lowerName.includes(pattern));
	}

	/**
	 * Clear cooldown for a channel (useful for testing or manual overrides)
	 */
	clearCooldown(channelId: string): void {
		this.renameCooldown.delete(channelId);
	}

	/**
	 * Check if a channel is on cooldown
	 */
	isOnCooldown(channelId: string): boolean {
		const lastRename = this.renameCooldown.get(channelId);
		if (!lastRename) return false;

		return Date.now() - lastRename < this.COOLDOWN_MS;
	}
}
