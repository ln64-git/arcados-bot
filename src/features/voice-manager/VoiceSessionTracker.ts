import type { GuildMember, VoiceChannel } from "discord.js";
import type { VoiceChannelSession } from "../../types/database";
import { getCacheManager } from "../cache-management/DiscordDataCache";
import { executeTransaction } from "../database-manager/PostgresConnection";
import type { DatabaseCore } from "../database-manager/PostgresCore";

export class VoiceSessionTracker {
	private dbCore: DatabaseCore;
	private cache = getCacheManager();

	constructor(dbCore: DatabaseCore) {
		this.dbCore = dbCore;
	}

	/**
	 * Track user joining a voice channel with atomic transaction
	 */
	async trackUserJoin(
		member: GuildMember,
		channel: VoiceChannel,
	): Promise<void> {
		if (!member || !channel) {
			throw new Error("Member and channel are required");
		}

		// Skip bots
		if (member.user.bot) return;

		const userId = member.id;
		const guildId = channel.guild.id;
		const joinedAt = new Date();

		await executeTransaction(async (client) => {
			// 1. Upsert user to ensure they exist
			await this.dbCore.upsertUserTransaction(client, {
				discordId: userId,
				guildId: guildId,
				bot: Boolean(member.user.bot),
				username: member.user.username || "Unknown",
				displayName: member.displayName || member.user.username || "Unknown",
				nickname: member.nickname || undefined,
				discriminator:
					(member.user as { discriminator?: string })?.discriminator || "0000",
				avatar: member.user.avatar || undefined,
				status: member.presence?.status || undefined,
				roles: Array.from(member.roles?.cache?.keys?.() || []),
				joinedAt: member.joinedAt || joinedAt,
				lastSeen: joinedAt,
				avatarHistory: [],
				usernameHistory: [],
				displayNameHistory: [],
				nicknameHistory: [],
				statusHistory: [],
				emoji: undefined,
				title: undefined,
				summary: undefined,
				keywords: [],
				notes: [],
				relationships: [],
				modPreferences: {
					bannedUsers: [],
					mutedUsers: [],
					kickedUsers: [],
					deafenedUsers: [],
					renamedUsers: [],
					modHistory: [],
					lastUpdated: joinedAt,
				},
				voiceInteractions: [],
			});

			// 2. Upsert channel to ensure it exists
			await this.dbCore.upsertChannelTransaction(client, {
				discordId: channel.id,
				guildId: guildId,
				channelName: channel.name,
				position: channel.position,
				isActive: true,
				activeUserIds: [],
				memberCount: 0,
			});

			// 3. Create voice channel session (primary tracking)
			await this.dbCore.createVoiceChannelSessionTransaction(client, {
				userId: userId,
				guildId: guildId,
				channelId: channel.id,
				channelName: channel.name,
				joinedAt: joinedAt,
				leftAt: undefined,
				duration: undefined,
				isActive: true,
			});

			// 4. Add member to channel tracking
			await this.dbCore.addChannelMemberTransaction(
				client,
				channel.id,
				guildId,
				userId,
			);
		});

		// 5. Update Redis cache (best-effort, non-blocking)
		try {
			await this.cache.setActiveVoiceSession(userId, {
				channelId: channel.id,
				channelName: channel.name,
				guildId: guildId,
				joinedAt: joinedAt,
			});

			await this.cache.addChannelMember(channel.id, userId, joinedAt);
		} catch (error) {
			// Cache failures shouldn't break voice tracking
			console.warn(`🔸 Cache update failed for user ${userId}:`, error);
		}
	}

	/**
	 * Track user leaving a voice channel with atomic transaction
	 */
	async trackUserLeave(
		member: GuildMember,
		channel: VoiceChannel,
	): Promise<void> {
		if (!member || !channel) {
			throw new Error("Member and channel are required");
		}

		const userId = member.id;
		const guildId = channel.guild.id;
		const leftAt = new Date();

		await executeTransaction(async (client) => {
			// 1. Get current session to calculate duration
			const currentSession =
				await this.dbCore.getCurrentVoiceChannelSessionTransaction(
					client,
					userId,
				);

			if (currentSession && currentSession.channelId === channel.id) {
				const duration = Math.floor(
					(leftAt.getTime() - currentSession.joinedAt.getTime()) / 1000,
				);

				// 2. End voice channel session
				await this.dbCore.endVoiceChannelSessionTransaction(
					client,
					userId,
					channel.id,
					leftAt,
					duration,
				);

				// 3. Remove member from channel tracking
				await this.dbCore.removeChannelMemberTransaction(
					client,
					channel.id,
					guildId,
					userId,
				);
			}
		});

		// 4. Update Redis cache (best-effort, non-blocking)
		try {
			await this.cache.removeActiveVoiceSession(userId);
			await this.cache.removeChannelMember(channel.id, userId);
		} catch (error) {
			// Cache failures shouldn't break voice tracking
			console.warn(`🔸 Cache cleanup failed for user ${userId}:`, error);
		}
	}

	/**
	 * Track user moving between channels (atomic)
	 */
	async trackUserMove(
		member: GuildMember,
		oldChannel: VoiceChannel,
		newChannel: VoiceChannel,
	): Promise<void> {
		// Handle as leave + join in single transaction
		await executeTransaction(async (client) => {
			// Leave old channel
			const leftAt = new Date();
			const currentSession =
				await this.dbCore.getCurrentVoiceChannelSessionTransaction(
					client,
					member.id,
				);

			if (currentSession && currentSession.channelId === oldChannel.id) {
				const duration = Math.floor(
					(leftAt.getTime() - currentSession.joinedAt.getTime()) / 1000,
				);

				await this.dbCore.endVoiceChannelSessionTransaction(
					client,
					member.id,
					oldChannel.id,
					leftAt,
					duration,
				);

				await this.dbCore.removeChannelMemberTransaction(
					client,
					oldChannel.id,
					oldChannel.guild.id,
					member.id,
				);
			}

			// Join new channel
			const joinedAt = new Date();
			await this.dbCore.upsertUserTransaction(client, {
				discordId: member.id,
				guildId: newChannel.guild.id,
				bot: Boolean(member.user.bot),
				username: member.user.username || "Unknown",
				displayName: member.displayName || member.user.username || "Unknown",
				nickname: member.nickname || undefined,
				discriminator:
					(member.user as { discriminator?: string })?.discriminator || "0000",
				avatar: member.user.avatar || undefined,
				status: member.presence?.status || undefined,
				roles: Array.from(member.roles?.cache?.keys?.() || []),
				joinedAt: member.joinedAt || joinedAt,
				lastSeen: joinedAt,
				avatarHistory: [],
				usernameHistory: [],
				displayNameHistory: [],
				nicknameHistory: [],
				statusHistory: [],
				emoji: undefined,
				title: undefined,
				summary: undefined,
				keywords: [],
				notes: [],
				relationships: [],
				modPreferences: {
					bannedUsers: [],
					mutedUsers: [],
					kickedUsers: [],
					deafenedUsers: [],
					renamedUsers: [],
					modHistory: [],
					lastUpdated: joinedAt,
				},
				voiceInteractions: [],
			});

			await this.dbCore.upsertChannelTransaction(client, {
				discordId: newChannel.id,
				guildId: newChannel.guild.id,
				channelName: newChannel.name,
				position: newChannel.position,
				isActive: true,
				activeUserIds: [],
				memberCount: 0,
			});

			await this.dbCore.createVoiceChannelSessionTransaction(client, {
				userId: member.id,
				guildId: newChannel.guild.id,
				channelId: newChannel.id,
				channelName: newChannel.name,
				joinedAt: joinedAt,
				leftAt: undefined,
				duration: undefined,
				isActive: true,
			});

			await this.dbCore.addChannelMemberTransaction(
				client,
				newChannel.id,
				newChannel.guild.id,
				member.id,
			);
		});

		// Update Redis cache (best-effort, non-blocking)
		try {
			await this.cache.removeActiveVoiceSession(member.id);
			await this.cache.removeChannelMember(oldChannel.id, member.id);

			await this.cache.setActiveVoiceSession(member.id, {
				channelId: newChannel.id,
				channelName: newChannel.name,
				guildId: newChannel.guild.id,
				joinedAt: new Date(),
			});

			await this.cache.addChannelMember(newChannel.id, member.id, new Date());
		} catch (error) {
			console.warn(`🔸 Cache update failed for user ${member.id}:`, error);
		}
	}

	/**
	 * Get current active session for a user
	 */
	async getCurrentSession(userId: string): Promise<VoiceChannelSession | null> {
		return this.dbCore.getCurrentVoiceChannelSession(userId);
	}

	/**
	 * Get all active sessions for a channel
	 */
	async getChannelSessions(channelId: string): Promise<VoiceChannelSession[]> {
		return this.dbCore.getChannelVoiceChannelSessions(channelId);
	}
}
