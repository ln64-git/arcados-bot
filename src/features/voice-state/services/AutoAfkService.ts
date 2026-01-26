/**
 * Auto AFK Service
 *
 * Automatically moves users to the AFK channel if they've been alone
 * in a voice channel for over 1 hour (excluding the bot owner).
 *
 * Features:
 * - Tracks when users become alone in voice channels
 * - Sets a 1-hour timer for each user
 * - Moves users to AFK channel (channel with "afk" in name) after timeout
 * - Excludes bot owner from auto-AFK
 * - Clears timers when users are no longer alone or leave
 */

import type { Client, VoiceChannel, GuildMember } from "discord.js";
import { VoiceLogger } from "./helpers/VoiceLogger";

interface AloneTimer {
	userId: string;
	guildId: string;
	channelId: string;
	timer: NodeJS.Timeout;
	startTime: Date;
}

export class AutoAfkService {
	private aloneTimers = new Map<string, AloneTimer>(); // userId:guildId -> timer
	private readonly AFK_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour in milliseconds

	constructor(
		private client: Client,
		private botOwnerId?: string,
	) {}

	/**
	 * Check if a user is alone in a voice channel
	 * Returns true if the user is the only member (excluding bots)
	 */
	private isUserAlone(member: GuildMember): boolean {
		const voiceState = member.voice;
		if (!voiceState?.channelId) {
			return false;
		}

		const channel = voiceState.channel;
		if (!channel || !channel.isVoiceBased()) {
			return false;
		}

		// Count members excluding bots
		const humanMembers = channel.members.filter(
			(m) => !m.user.bot && m.id !== member.id,
		);

		return humanMembers.size === 0;
	}

	/**
	 * Find the AFK channel in a guild
	 * Returns the first voice channel with "afk" in its name (case-insensitive)
	 */
	private findAfkChannel(guildId: string): VoiceChannel | null {
		const guild = this.client.guilds.cache.get(guildId);
		if (!guild) {
			return null;
		}

		// Search for a voice channel with "afk" in the name
		const afkChannel = guild.channels.cache.find(
			(channel) =>
				channel.isVoiceBased() &&
				channel.name.toLowerCase().includes("afk"),
		) as VoiceChannel | undefined;

		return afkChannel || null;
	}

	/**
	 * Move a user to the AFK channel
	 */
	private async moveToAfkChannel(
		member: GuildMember,
		channelId: string,
	): Promise<void> {
		const afkChannel = this.findAfkChannel(member.guild.id);
		if (!afkChannel) {
			VoiceLogger.warn(
				"AUTO_AFK",
				`No AFK channel found in guild ${member.guild.name}`,
			);
			return;
		}

		// Check if user is still in the same channel
		if (member.voice?.channelId !== channelId) {
			VoiceLogger.info(
				"AUTO_AFK",
				`User ${member.displayName} is no longer in channel ${channelId}, skipping AFK move`,
			);
			return;
		}

		// Check if user is still alone
		if (!this.isUserAlone(member)) {
			VoiceLogger.info(
				"AUTO_AFK",
				`User ${member.displayName} is no longer alone, skipping AFK move`,
			);
			return;
		}

		try {
			await member.voice.setChannel(afkChannel);
			VoiceLogger.info(
				"AUTO_AFK",
				`Moved ${member.displayName} to AFK channel after being alone for 1 hour`,
			);
		} catch (error) {
			VoiceLogger.error(
				"AUTO_AFK",
				`Failed to move ${member.displayName} to AFK channel`,
				error,
			);
		}
	}

	/**
	 * Start tracking a user who is alone in a voice channel
	 * Sets a timer to move them to AFK after 1 hour
	 */
	checkAndStartTimer(member: GuildMember): void {
		// Skip if user is bot owner
		if (this.botOwnerId && member.id === this.botOwnerId) {
			return;
		}

		// Skip if user is not in a voice channel
		if (!member.voice?.channelId) {
			return;
		}

		// Skip if user is not alone
		if (!this.isUserAlone(member)) {
			// Clear any existing timer if user is no longer alone
			this.clearTimer(member.id, member.guild.id);
			return;
		}

		const key = `${member.id}:${member.guild.id}`;
		const channelId = member.voice.channelId;

		// If timer already exists, don't create a new one
		if (this.aloneTimers.has(key)) {
			return;
		}

		// Don't move if already in AFK channel
		const currentChannel = member.voice.channel;
		if (
			currentChannel &&
			currentChannel.name.toLowerCase().includes("afk")
		) {
			return;
		}

		// Create timer to move user to AFK after 1 hour
		const timer = setTimeout(async () => {
			// Fetch fresh member to ensure we have latest voice state
			const guild = this.client.guilds.cache.get(member.guild.id);
			const freshMember = guild?.members.cache.get(member.id);
			if (freshMember) {
				await this.moveToAfkChannel(freshMember, channelId);
			}
			this.clearTimer(member.id, member.guild.id);
		}, this.AFK_TIMEOUT_MS);

		this.aloneTimers.set(key, {
			userId: member.id,
			guildId: member.guild.id,
			channelId,
			timer,
			startTime: new Date(),
		});

		VoiceLogger.info(
			"AUTO_AFK",
			`Started 1-hour timer for ${member.displayName} (alone in ${currentChannel?.name})`,
		);
	}

	/**
	 * Clear the timer for a user
	 * Called when user is no longer alone, leaves, or switches channels
	 */
	clearTimer(userId: string, guildId: string): void {
		const key = `${userId}:${guildId}`;
		const timerData = this.aloneTimers.get(key);

		if (timerData) {
			clearTimeout(timerData.timer);
			this.aloneTimers.delete(key);
			VoiceLogger.info(
				"AUTO_AFK",
				`Cleared timer for user ${userId} in guild ${guildId}`,
			);
		}
	}

	/**
	 * Handle voice state update
	 * Called by VoiceStateCoordinator to check if user should be tracked
	 */
	handleVoiceStateUpdate(member: GuildMember): void {
		// Skip if user is bot owner
		if (this.botOwnerId && member.id === this.botOwnerId) {
			return;
		}

		// If user left voice, clear timer
		if (!member.voice?.channelId) {
			this.clearTimer(member.id, member.guild.id);
			return;
		}

		// Check if channel changed - if so, clear old timer first
		const key = `${member.id}:${member.guild.id}`;
		const existingTimer = this.aloneTimers.get(key);
		if (existingTimer && existingTimer.channelId !== member.voice.channelId) {
			// User switched channels, clear old timer
			this.clearTimer(member.id, member.guild.id);
		}

		// Check if user is alone and start/update timer
		this.checkAndStartTimer(member);
	}

	/**
	 * Cleanup all timers (called on shutdown)
	 */
	cleanup(): void {
		for (const [key, timerData] of this.aloneTimers.entries()) {
			clearTimeout(timerData.timer);
		}
		this.aloneTimers.clear();
		VoiceLogger.info("AUTO_AFK", "Cleaned up all auto-AFK timers");
	}
}
