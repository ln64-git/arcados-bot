import type { GuildMember, VoiceChannel } from "discord.js";
import { config, isDevelopment } from "../../config";
import type { VoiceChannelSession } from "../../types/database";
import { getCacheManager } from "../cache-management/DiscordDataCache";
import { executeTransaction } from "../database-manager/PostgresConnection";
import type { DatabaseCore } from "../database-manager/PostgresCore";

export class VoiceSessionTracker {
	private dbCore: DatabaseCore;
	private cache = getCacheManager();
	private readonly debugEnabled = isDevelopment;

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

		const isBot = member.user.bot;

		const userId = member.id;
		const guildId = channel.guild.id;
		const joinedAt = new Date();

		// Only track sessions for configured guild
		if (guildId !== config.guildId) {
			if (this.debugEnabled) {
				console.log(
					`🔍 Skipping voice tracking - wrong guild: ${guildId} vs ${config.guildId}`,
				);
			}
			return;
		}

		// Validate all required fields before proceeding
		if (!userId || !guildId || !channel.id || !channel.name) {
			throw new Error(
				`Invalid data: userId=${userId}, guildId=${guildId}, channelId=${channel.id}, channelName=${channel.name}`,
			);
		}

		await executeTransaction(async (client) => {
			// Proactively end any other active sessions for this user in other channels
			await client.query(
				`
					UPDATE voice_channel_sessions
					SET 
						is_active = FALSE,
						left_at = COALESCE(left_at, CURRENT_TIMESTAMP),
						duration = COALESCE(duration, GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - joined_at))::int)),
						updated_at = CURRENT_TIMESTAMP
					WHERE user_id = $1 AND is_active = TRUE AND channel_id <> $2
				`,
				[userId, channel.id],
			);

			// Note: We don't check for existing session in same channel here
			// The database will handle conflicts gracefully with ON CONFLICT clause

			// 1. Upsert user to ensure they exist (only for non-bots)
			if (!isBot) {
				await this.dbCore.upsertUserTransaction(client, {
					discordId: userId,
					guildId: guildId,
					bot: false,
					username: member.user.username || "Unknown",
					displayName: member.displayName || member.user.username || "Unknown",
					nickname: member.nickname || undefined,
					discriminator:
						(member.user as { discriminator?: string })?.discriminator ||
						"0000",
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
			}

			// 2. Upsert channel to ensure it exists (with proper defaults)
			// Only update if this is a new channel or if we need to update member counts
			if (guildId === config.guildId) {
				console.log(
					`🔍 DEBUG: VoiceSessionTracker updating channel "${channel.name}" at position ${channel.position}`,
				);

				// Check if this channel was just created (within last 30 seconds)
				// If so, don't update position to avoid overwriting corrected position
				const channelAge = Date.now() - channel.createdTimestamp;
				const isNewChannel = channelAge < 30000; // 30 seconds

				if (isNewChannel) {
					console.log(
						`🔍 DEBUG: Skipping position update for new channel "${channel.name}" (age: ${channelAge}ms)`,
					);
				}

				await this.dbCore.upsertChannelTransaction(client, {
					discordId: channel.id,
					guildId: guildId,
					channelName: channel.name,
					position: isNewChannel ? undefined : channel.position, // Don't update position for new channels
					isActive: true,
					activeUserIds: [], // Ensure array, not NULL
					memberCount: 0, // Ensure integer, not NULL
				});

				console.log(
					`🔍 DEBUG: VoiceSessionTracker database update completed for "${channel.name}"`,
				);
			}

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
			if (this.debugEnabled) {
				console.warn(`🔸 Cache update failed for user ${userId}:`, error);
			}
		}

		// 6. Immediate sync to update channel member counts
		try {
			await this.dbCore.syncChannelActiveUsers(channel.id);
		} catch (error) {
			console.warn(
				`🔸 Failed to sync channel active users for ${channel.id}:`,
				error,
			);
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

		// Only track sessions for configured guild
		if (guildId !== config.guildId) {
			if (this.debugEnabled) {
				console.log(
					`🔍 Skipping voice leave tracking - wrong guild: ${guildId} vs ${config.guildId}`,
				);
			}
			return;
		}

		// Validate all required fields before proceeding
		if (!userId || !guildId || !channel.id || !channel.name) {
			throw new Error(
				`Invalid data: userId=${userId}, guildId=${guildId}, channelId=${channel.id}, channelName=${channel.name}`,
			);
		}

		await executeTransaction(async (client) => {
			// 1. Get current session to calculate duration
			const currentSession =
				await this.dbCore.getCurrentVoiceChannelSessionTransaction(
					client,
					userId,
					guildId,
				);

			if (this.debugEnabled) {
				console.log(
					`🔍 trackUserLeave: Found session for ${userId} in ${channel.name}:`,
					currentSession ? "YES" : "NO",
				);
				if (currentSession) {
					console.log(
						`🔍 Current session details: channelId=${currentSession.channelId}, isActive=${currentSession.isActive}`,
					);
				}
			}

			if (currentSession) {
				if (currentSession.channelId === channel.id) {
					const joinedAt =
						currentSession.joinedAt instanceof Date
							? currentSession.joinedAt
							: new Date(currentSession.joinedAt);
					const duration = Math.floor(
						(leftAt.getTime() - joinedAt.getTime()) / 1000,
					);

					// End voice channel session
					await this.dbCore.endVoiceChannelSessionTransaction(
						client,
						userId,
						channel.id,
						leftAt,
						duration,
					);

					console.log(
						`🔸 Closed session for user ${userId} in channel ${channel.name} (duration: ${duration}s)`,
					);
				} else {
					// User was in a different channel, close that session too
					const joinedAt =
						currentSession.joinedAt instanceof Date
							? currentSession.joinedAt
							: new Date(currentSession.joinedAt);
					const duration = Math.floor(
						(leftAt.getTime() - joinedAt.getTime()) / 1000,
					);

					await this.dbCore.endVoiceChannelSessionTransaction(
						client,
						userId,
						currentSession.channelId,
						leftAt,
						duration,
					);

					if (this.debugEnabled) {
						console.log(
							`🔸 Closed session for user ${userId} in different channel ${currentSession.channelId}`,
						);
					}
				}
			} else {
				console.log(
					`🔸 No active session found for user ${userId} leaving channel ${channel.name}`,
				);
			}
		});

		// 4. Update Redis cache (best-effort, non-blocking)
		try {
			await this.cache.removeActiveVoiceSession(userId);
			await this.cache.removeChannelMember(channel.id, userId);
		} catch (error) {
			// Cache failures shouldn't break voice tracking
			if (this.debugEnabled) {
				console.warn(`🔸 Cache cleanup failed for user ${userId}:`, error);
			}
		}

		// 5. Immediate sync to update channel member counts
		try {
			await this.dbCore.syncChannelActiveUsers(channel.id);
		} catch (error) {
			console.warn(
				`🔸 Failed to sync channel active users for ${channel.id}:`,
				error,
			);
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
		if (!member || !oldChannel || !newChannel) {
			throw new Error("Member, oldChannel, and newChannel are required");
		}

		const isBot = member.user.bot;

		// Validate all required fields before proceeding
		if (
			!member.id ||
			!oldChannel.id ||
			!oldChannel.name ||
			!newChannel.id ||
			!newChannel.name
		) {
			throw new Error(
				`Invalid data: userId=${member.id}, oldChannelId=${oldChannel.id}, oldChannelName=${oldChannel.name}, newChannelId=${newChannel.id}, newChannelName=${newChannel.name}`,
			);
		}

		// Handle as leave + join in single transaction
		await executeTransaction(async (client) => {
			// Proactively end any other active sessions for this user across other channels
			await client.query(
				`
					UPDATE voice_channel_sessions
					SET 
						is_active = FALSE,
						left_at = COALESCE(left_at, CURRENT_TIMESTAMP),
						duration = COALESCE(duration, GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - joined_at))::int)),
						updated_at = CURRENT_TIMESTAMP
					WHERE user_id = $1 AND is_active = TRUE AND channel_id NOT IN ($2, $3)
				`,
				[member.id, oldChannel.id, newChannel.id],
			);
			// Leave old channel
			const leftAt = new Date();
			const currentSession =
				await this.dbCore.getCurrentVoiceChannelSessionTransaction(
					client,
					member.id,
				);

			if (currentSession && currentSession.channelId === oldChannel.id) {
				const joinedAt =
					currentSession.joinedAt instanceof Date
						? currentSession.joinedAt
						: new Date(currentSession.joinedAt);
				const duration = Math.floor(
					(leftAt.getTime() - joinedAt.getTime()) / 1000,
				);

				await this.dbCore.endVoiceChannelSessionTransaction(
					client,
					member.id,
					oldChannel.id,
					leftAt,
					duration,
				);

				// Member tracking now handled by voice_channel_sessions table
			}

			// Join new channel
			const joinedAt = new Date();
			if (!isBot) {
				await this.dbCore.upsertUserTransaction(client, {
					discordId: member.id,
					guildId: newChannel.guild.id,
					bot: false,
					username: member.user.username || "Unknown",
					displayName: member.displayName || member.user.username || "Unknown",
					nickname: member.nickname || undefined,
					discriminator:
						(member.user as { discriminator?: string })?.discriminator ||
						"0000",
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
			}

			await this.dbCore.upsertChannelTransaction(client, {
				discordId: newChannel.id,
				guildId: newChannel.guild.id,
				channelName: newChannel.name,
				position: newChannel.position,
				isActive: true,
				activeUserIds: undefined, // Don't overwrite existing members
				memberCount: undefined, // Don't overwrite existing count
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

			// Member tracking now handled by voice_channel_sessions table
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
