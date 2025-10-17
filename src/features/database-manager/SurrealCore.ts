import type { Surreal } from "surrealdb.js";
import type {
	AvatarHistory,
	Channel,
	Message as DBMessage,
	DatabaseTables,
	GuildSync,
	ModHistoryEntry,
	ModPreferences,
	RenamedUser,
	Role,
	User,
	UserStatus,
	VoiceChannelSession,
	VoiceInteraction,
} from "../../types/database";
import { memoryManager } from "../performance-monitoring/MemoryManager";
import {
	executeQuery,
	executeQueryOne,
	executeTransaction,
	getSurrealConnection,
} from "./SurrealConnection";
import { initializeSurrealSchema } from "./SurrealSchema";

export class SurrealCore {
	private static instance: SurrealCore | null = null;
	private isInitialized = false;
	private queryCache = new Map<string, { data: unknown; timestamp: number }>();
	private cacheTimeout = 30000; // 30 seconds cache
	private tables: DatabaseTables = {
		users: "users",
		roles: "roles",
		messages: "messages",
		guildSyncs: "guild_syncs",
		relationships: "relationships",
		interactionRecords: "interaction_records",
		channels: "channels",
		voiceChannelSessions: "voice_channel_sessions",
	};

	static getInstance(): SurrealCore {
		if (!SurrealCore.instance) {
			SurrealCore.instance = new SurrealCore();
		}
		return SurrealCore.instance;
	}

	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return; // Already initialized
		}

		await initializeSurrealSchema();
		this.isInitialized = true;
		console.log("🔹 SurrealDB core initialized successfully");
	}

	// Cache helper methods
	private getCachedResult<T>(cacheKey: string): T | null {
		const cached = this.queryCache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
			return cached.data as T;
		}
		return null;
	}

	private setCachedResult<T>(cacheKey: string, data: T): void {
		this.queryCache.set(cacheKey, {
			data,
			timestamp: Date.now(),
		});
	}

	private clearCache(): void {
		this.queryCache.clear();
	}

	// Performance wrapper for database operations
	private async withPerformanceTracking<T>(
		operation: () => Promise<T>,
		operationName: string,
		useCache = false,
		cacheKey?: string,
	): Promise<T> {
		// Check cache first if enabled
		if (useCache && cacheKey) {
			const cached = this.getCachedResult<T>(cacheKey);
			if (cached !== null) {
				return cached;
			}
		}

		const startTime = memoryManager.startTimer();
		try {
			const result = await operation();
			const duration = memoryManager.endTimer(startTime);
			memoryManager.recordDatabaseQueryTime(duration);

			// Cache result if enabled
			if (useCache && cacheKey) {
				this.setCachedResult(cacheKey, result);
			}

			return result;
		} catch (error) {
			const duration = memoryManager.endTimer(startTime);
			console.error(
				`🔸 Database error in ${operationName} (${duration.toFixed(2)}ms):`,
				error,
			);
			throw error;
		}
	}

	// ==================== USER OPERATIONS ====================

	async getUser(discordId: string, guildId: string): Promise<User | null> {
		return this.withPerformanceTracking(
			async () => {
				const query = `
				SELECT * FROM ${this.tables.users} 
				WHERE discord_id = $discord_id AND guild_id = $guild_id
			`;
				return await executeQueryOne<User>(query, {
					discord_id: discordId,
					guild_id: guildId,
				});
			},
			`getUser(${discordId}, ${guildId})`,
			true,
			`user_${discordId}_${guildId}`,
		);
	}

	async getUsersByGuild(guildId: string): Promise<User[]> {
		return this.withPerformanceTracking(async () => {
			const query = `SELECT * FROM ${this.tables.users} WHERE guild_id = $guild_id`;
			return await executeQuery<User>(query, { guild_id: guildId });
		}, `getUsersByGuild(${guildId})`);
	}

	async upsertUser(
		user: Omit<User, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const recordId = `users:${user.discordId}_${user.guildId}`;

			const query = `
				UPDATE ${recordId} MERGE {
					discord_id: $discord_id,
					guild_id: $guild_id,
					bot: $bot,
					username: $username,
					display_name: $display_name,
					nickname: $nickname,
					discriminator: $discriminator,
					avatar: $avatar,
					status: $status,
					roles: $roles,
					joined_at: $joined_at,
					last_seen: $last_seen,
					avatar_history: $avatar_history,
					username_history: $username_history,
					display_name_history: $display_name_history,
					nickname_history: $nickname_history,
					status_history: $status_history,
					emoji: $emoji,
					title: $title,
					summary: $summary,
					keywords: $keywords,
					notes: $notes,
					relationships: $relationships,
					mod_preferences: $mod_preferences,
					voice_interactions: $voice_interactions,
					updated_at: time::now()
				}
			`;

			await executeQuery(query, {
				discord_id: user.discordId,
				guild_id: user.guildId,
				bot: user.bot,
				username: user.username,
				display_name: user.displayName,
				nickname: user.nickname,
				discriminator: user.discriminator,
				avatar: user.avatar,
				status: user.status,
				roles: user.roles,
				joined_at: user.joinedAt,
				last_seen: user.lastSeen,
				avatar_history: user.avatarHistory,
				username_history: user.usernameHistory,
				display_name_history: user.displayNameHistory,
				nickname_history: user.nicknameHistory,
				status_history: user.statusHistory,
				emoji: user.emoji,
				title: user.title,
				summary: user.summary,
				keywords: user.keywords,
				notes: user.notes,
				relationships: user.relationships,
				mod_preferences: user.modPreferences,
				voice_interactions: user.voiceInteractions,
			});

			// Clear related caches
			this.queryCache.delete(`guild_stats_${user.guildId}`);
		}, `upsertUser(${user.discordId})`);
	}

	// ==================== ROLE OPERATIONS ====================

	async getRolesByGuild(guildId: string): Promise<Role[]> {
		return this.withPerformanceTracking(
			async () => {
				const query = `SELECT * FROM ${this.tables.roles} WHERE guild_id = $guild_id`;
				return await executeQuery<Role>(query, { guild_id: guildId });
			},
			`getRolesByGuild(${guildId})`,
			true,
			`roles_${guildId}`,
		);
	}

	async upsertRole(
		role: Omit<Role, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const recordId = `roles:${role.discordId}_${role.guildId}`;

			const query = `
				UPDATE ${recordId} MERGE {
					discord_id: $discord_id,
					guild_id: $guild_id,
					name: $name,
					color: $color,
					mentionable: $mentionable,
					updated_at: time::now()
				}
			`;

			await executeQuery(query, {
				discord_id: role.discordId,
				guild_id: role.guildId,
				name: role.name,
				color: role.color,
				mentionable: role.mentionable,
			});
		}, `upsertRole(${role.discordId})`);
	}

	// ==================== MESSAGE OPERATIONS ====================

	async getMessage(messageId: string): Promise<DBMessage | null> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.messages}
				WHERE discord_id = $discord_id
			`;
			return await executeQueryOne<DBMessage>(query, {
				discord_id: messageId,
			});
		}, `getMessage(${messageId})`);
	}

	async getMessagesByGuild(guildId: string, limit = 100): Promise<DBMessage[]> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.messages} 
				WHERE guild_id = $guild_id 
				ORDER BY timestamp DESC 
				LIMIT $limit
			`;
			return await executeQuery<DBMessage>(query, { guild_id: guildId, limit });
		}, `getMessagesByGuild(${guildId})`);
	}

	async getMessagesByChannel(
		guildId: string,
		channelName: string,
		limit = 100,
	): Promise<DBMessage[]> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.messages} 
				WHERE guild_id = $guild_id AND channel_id = $channel_id 
				ORDER BY timestamp DESC 
				LIMIT $limit
			`;
			return await executeQuery<DBMessage>(query, {
				guild_id: guildId,
				channel_id: channelName,
				limit,
			});
		}, `getMessagesByChannel(${guildId}, ${channelName})`);
	}

	async getRecentMessagesWithUsers(
		guildId: string,
		limit = 20,
	): Promise<
		{
			message: DBMessage;
			user: User | null;
		}[]
	> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT 
					m.*,
					u.*
				FROM ${this.tables.messages} m
				LEFT JOIN ${this.tables.users} u ON m.author_id = u.discord_id AND m.guild_id = u.guild_id
				WHERE m.guild_id = $guild_id
				ORDER BY m.timestamp DESC
				LIMIT $limit
			`;

			const rows = await executeQuery(query, { guild_id: guildId, limit });

			return rows.map((row: Record<string, unknown>) => ({
				message: {
					id: row.id,
					discordId: row.discord_id,
					content: row.content,
					authorId: row.author_id,
					channelId: row.channel_id,
					guildId: row.guild_id,
					timestamp: row.timestamp,
					editedAt: row.edited_at,
					deletedAt: row.deleted_at,
					mentions: row.mentions,
					reactions: row.reactions,
					replyTo: row.reply_to,
					attachments: row.attachments,
					embeds: row.embeds,
					createdAt: row.created_at,
					updatedAt: row.updated_at,
				},
				user: row.discord_id
					? {
							id: row.id,
							bot: row.bot,
							discordId: row.discord_id,
							username: row.username,
							displayName: row.display_name,
							discriminator: row.discriminator,
							avatar: row.avatar,
							status: row.status,
							roles: row.roles,
							joinedAt: row.joined_at,
							lastSeen: row.last_seen,
							avatarHistory: row.avatar_history,
							usernameHistory: row.username_history,
							displayNameHistory: row.display_name_history,
							statusHistory: row.status_history,
							emoji: row.emoji,
							title: row.title,
							summary: row.summary,
							keywords: row.keywords,
							notes: row.notes,
							relationships: row.relationships,
							modPreferences: row.mod_preferences,
							voiceInteractions: row.voice_interactions,
							createdAt: row.created_at,
							updatedAt: row.updated_at,
						}
					: null,
			}));
		}, `getRecentMessagesWithUsers(${guildId})`);
	}

	async getOldestMessagesWithUsers(
		guildId: string,
		limit = 20,
	): Promise<
		{
			message: DBMessage;
			user: User | null;
		}[]
	> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT 
					m.*,
					u.*
				FROM ${this.tables.messages} m
				LEFT JOIN ${this.tables.users} u ON m.author_id = u.discord_id AND m.guild_id = u.guild_id
				WHERE m.guild_id = $guild_id
				ORDER BY m.timestamp ASC
				LIMIT $limit
			`;

			const rows = await executeQuery(query, { guild_id: guildId, limit });

			return rows.map((row: Record<string, unknown>) => ({
				message: {
					id: row.id,
					discordId: row.discord_id,
					content: row.content,
					authorId: row.author_id,
					channelId: row.channel_id,
					guildId: row.guild_id,
					timestamp: row.timestamp,
					editedAt: row.edited_at,
					deletedAt: row.deleted_at,
					mentions: row.mentions,
					reactions: row.reactions,
					replyTo: row.reply_to,
					attachments: row.attachments,
					embeds: row.embeds,
					createdAt: row.created_at,
					updatedAt: row.updated_at,
				},
				user: row.discord_id
					? {
							id: row.id,
							bot: row.bot,
							discordId: row.discord_id,
							username: row.username,
							displayName: row.display_name,
							discriminator: row.discriminator,
							avatar: row.avatar,
							status: row.status,
							roles: row.roles,
							joinedAt: row.joined_at,
							lastSeen: row.last_seen,
							avatarHistory: row.avatar_history,
							usernameHistory: row.username_history,
							displayNameHistory: row.display_name_history,
							statusHistory: row.status_history,
							emoji: row.emoji,
							title: row.title,
							summary: row.summary,
							keywords: row.keywords,
							notes: row.notes,
							relationships: row.relationships,
							modPreferences: row.mod_preferences,
							voiceInteractions: row.voice_interactions,
							createdAt: row.created_at,
							updatedAt: row.updated_at,
						}
					: null,
			}));
		}, `getOldestMessagesWithUsers(${guildId})`);
	}

	async upsertMessage(
		message: Omit<DBMessage, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const recordId = `messages:${message.discordId}`;

			const query = `
				UPDATE ${recordId} MERGE {
					discord_id: $discord_id,
					content: $content,
					author_id: $author_id,
					channel_id: $channel_id,
					guild_id: $guild_id,
					timestamp: $timestamp,
					edited_at: $edited_at,
					deleted_at: $deleted_at,
					mentions: $mentions,
					reactions: $reactions,
					reply_to: $reply_to,
					attachments: $attachments,
					embeds: $embeds,
					updated_at: time::now()
				}
			`;

			await executeQuery(query, {
				discord_id: message.discordId,
				content: message.content,
				author_id: message.authorId,
				channel_id: message.channelId,
				guild_id: message.guildId,
				timestamp: message.timestamp,
				edited_at: message.editedAt,
				deleted_at: message.deletedAt,
				mentions: message.mentions,
				reactions: message.reactions,
				reply_to: message.replyTo,
				attachments: message.attachments,
				embeds: message.embeds,
			});
		}, `upsertMessage(${message.discordId})`);
	}

	async batchInsertMessages(
		messages: Omit<DBMessage, "id" | "createdAt" | "updatedAt">[],
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			if (messages.length === 0) return;

			// Create batch query for all messages using SurrealDB syntax
			const queries = messages
				.map((message) => {
					const recordId = `messages:${message.discordId}`;
					const mentions = JSON.stringify(message.mentions || []);
					const reactions = JSON.stringify(message.reactions || []);
					const attachments = JSON.stringify(message.attachments || []);
					const embeds = JSON.stringify(message.embeds || []);

					return `
					INSERT INTO messages {
						id: ${recordId},
						discordId: "${message.discordId}",
						content: ${message.content ? `"${message.content.replace(/"/g, '\\"')}"` : "null"},
						authorId: "${message.authorId}",
						channelId: "${message.channelId}",
						guildId: "${message.guildId}",
						timestamp: "${message.timestamp.toISOString()}",
						editedAt: ${message.editedAt ? `"${message.editedAt.toISOString()}"` : "null"},
						deletedAt: ${message.deletedAt ? `"${message.deletedAt.toISOString()}"` : "null"},
						mentions: ${mentions},
						reactions: ${reactions},
						replyTo: ${message.replyTo ? `"${message.replyTo}"` : "null"},
						attachments: ${attachments},
						embeds: ${embeds},
						flags: ${message.flags ? message.flags : "null"},
						type: ${message.type ? message.type : "null"},
						createdAt: time::now(),
						updatedAt: time::now()
					};
				`;
				})
				.join("\n");

			await executeQuery(queries, {});
		}, `batchInsertMessages(${messages.length} messages)`);
	}

	// ==================== GUILD SYNC OPERATIONS ====================

	async getGuildSync(guildId: string): Promise<GuildSync | null> {
		return this.withPerformanceTracking(async () => {
			const query = `SELECT * FROM ${this.tables.guildSyncs} WHERE guild_id = $guild_id`;
			return await executeQueryOne<GuildSync>(query, { guild_id: guildId });
		}, `getGuildSync(${guildId})`);
	}

	async updateGuildSync(
		guildSync: Omit<GuildSync, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const recordId = `guild_syncs:${guildSync.guildId}`;

			const query = `
				UPDATE ${recordId} MERGE {
					guild_id: $guild_id,
					last_sync_at: $last_sync_at,
					last_message_id: $last_message_id,
					total_users: $total_users,
					total_messages: $total_messages,
					total_roles: $total_roles,
					is_fully_synced: $is_fully_synced,
					updated_at: time::now()
				}
			`;

			await executeQuery(query, {
				guild_id: guildSync.guildId,
				last_sync_at: guildSync.lastSyncAt,
				last_message_id: guildSync.lastMessageId,
				total_users: guildSync.totalUsers,
				total_messages: guildSync.totalMessages,
				total_roles: guildSync.totalRoles,
				is_fully_synced: guildSync.isFullySynced,
			});
		}, `updateGuildSync(${guildSync.guildId})`);
	}

	// ==================== ROLE RESTORATION OPERATIONS ====================

	async restoreMemberRoles(
		member: import("discord.js").GuildMember,
	): Promise<{ success: boolean; restoredCount: number; error?: string }> {
		return this.withPerformanceTracking(async () => {
			const query = `SELECT * FROM ${this.tables.users} WHERE discord_id = $discord_id`;
			const userData = await executeQueryOne(query, { discord_id: member.id });

			if (!userData || !userData.roles || userData.roles.length === 0) {
				return {
					success: true,
					restoredCount: 0,
					error: `No stored roles found for user ${member.user.tag}`,
				};
			}

			// Filter out roles that no longer exist in the guild
			const validRoles = userData.roles.filter((roleId: string) =>
				member.guild.roles.cache.has(roleId),
			);

			if (validRoles.length === 0) {
				return {
					success: true,
					restoredCount: 0,
					error: `No valid roles found for user ${member.user.tag} - all stored roles may have been deleted`,
				};
			}

			// Add roles to the member
			await member.roles.add(
				validRoles,
				"Automatic role restoration on rejoin",
			);

			return {
				success: true,
				restoredCount: validRoles.length,
			};
		}, `restoreMemberRoles(${member.id}, ${member.guild.id})`);
	}

	// ==================== STATISTICS ====================

	async getGuildStats(guildId: string): Promise<{
		totalUsers: number;
		totalMessages: number;
		totalRoles: number;
		totalVoiceSessions: number;
	}> {
		return this.withPerformanceTracking(
			async () => {
				const queries = [
					`SELECT count() as count FROM ${this.tables.users} WHERE guildId = $guildId`,
					`SELECT count() as count FROM ${this.tables.messages} WHERE guildId = $guildId`,
					`SELECT count() as count FROM ${this.tables.roles} WHERE guildId = $guildId`,
					`SELECT count() as count FROM ${this.tables.users} WHERE guildId = $guildId AND voiceInteractions IS NOT NULL AND array::len(voiceInteractions) > 0`,
				];

				const results = await Promise.all(
					queries.map((query) => executeQueryOne(query, { guildId: guildId })),
				);

				return {
					totalUsers: results[0]?.count || 0,
					totalMessages: results[1]?.count || 0,
					totalRoles: results[2]?.count || 0,
					totalVoiceSessions: results[3]?.count || 0,
				};
			},
			`getGuildStats(${guildId})`,
			true,
			`guild_stats_${guildId}`,
		);
	}

	// ==================== MODERATION PREFERENCES OPERATIONS ====================

	async getModPreferences(userId: string): Promise<ModPreferences | null> {
		return this.withPerformanceTracking(async () => {
			const query = `SELECT mod_preferences FROM ${this.tables.users} WHERE discord_id = $discord_id`;
			const user = await executeQueryOne(query, { discord_id: userId });
			return user?.mod_preferences || null;
		}, `getModPreferences(${userId})`);
	}

	async updateModPreferences(
		userId: string,
		guildId: string,
		preferences: Partial<ModPreferences>,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			// First, ensure the user exists with proper data
			const user = await this.getUser(userId, guildId);
			if (!user) {
				// User doesn't exist, create them with minimal required data
				const minimalUserData: Omit<User, "id" | "createdAt" | "updatedAt"> = {
					discordId: userId,
					username: `user_${userId}`,
					displayName: `User ${userId}`,
					discriminator: "0000",
					avatar: "",
					avatarHistory: [],
					bot: false,
					usernameHistory: [],
					displayNameHistory: [],
					roles: [],
					joinedAt: new Date(),
					lastSeen: new Date(),
					statusHistory: [],
					status: "",
					relationships: [],
					voiceInteractions: [],
					modPreferences: {
						bannedUsers: [],
						mutedUsers: [],
						kickedUsers: [],
						deafenedUsers: [],
						renamedUsers: [],
						modHistory: [],
						lastUpdated: new Date(),
						...preferences,
					},
				};
				await this.upsertUser(minimalUserData);
				return;
			}

			// User exists, update their preferences
			const recordId = `users:${userId}_${guildId}`;
			const query = `
				UPDATE ${recordId} SET mod_preferences = $mod_preferences, updated_at = time::now()
			`;

			// Merge preferences with existing ones
			const existingPreferences = user.modPreferences || {};
			const mergedPreferences = { ...existingPreferences, ...preferences };

			await executeQuery(query, { mod_preferences: mergedPreferences });
		}, `updateModPreferences(${userId})`);
	}

	// ==================== VOICE INTERACTION OPERATIONS ====================

	async addVoiceInteraction(
		userId: string,
		guildId: string,
		interaction: VoiceInteraction,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const recordId = `users:${userId}_${guildId}`;
			const query = `
				UPDATE ${recordId} SET 
					voice_interactions = array::union(voice_interactions ?? [], [$interaction]),
					updated_at = time::now()
			`;
			await executeQuery(query, { interaction });
		}, `addVoiceInteraction(${userId}, ${interaction.channelId})`);
	}

	async updateVoiceInteraction(
		userId: string,
		guildId: string,
		channelId: string,
		leftAt: Date,
		duration: number,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			// First, get the current user data to find the interaction
			const user = await this.getUser(userId, guildId);
			if (!user) {
				console.warn(`User ${userId} not found in guild ${guildId}`);
				return;
			}

			// Find and update the specific voice interaction
			const updatedInteractions = user.voiceInteractions.map((interaction) => {
				if (interaction.channelId === channelId && !interaction.leftAt) {
					return {
						...interaction,
						leftAt,
						duration,
					};
				}
				return interaction;
			});

			// Update the user with the modified interactions
			const recordId = `users:${userId}_${guildId}`;
			const query = `
				UPDATE ${recordId} SET 
					voice_interactions = $voice_interactions,
					updated_at = time::now()
			`;
			await executeQuery(query, { voice_interactions: updatedInteractions });
		}, `updateVoiceInteraction(${userId}, ${channelId})`);
	}

	async getUserVoiceInteractions(
		userId: string,
		guildId: string,
		channelId?: string,
	): Promise<VoiceInteraction[]> {
		return this.withPerformanceTracking(
			async () => {
				let query = `
					SELECT voice_interactions FROM ${this.tables.users}
					WHERE discord_id = $discord_id AND guild_id = $guild_id
				`;
				const params: Record<string, unknown> = {
					discord_id: userId,
					guild_id: guildId,
				};

				if (channelId) {
					query += " AND voice_interactions CONTAINS $channel_id";
					params.channel_id = channelId;
				}

				const result = await executeQueryOne(query, params);
				return result?.voice_interactions || [];
			},
			`getUserVoiceInteractions(${userId}, ${channelId || "all"})`,
		);
	}

	// ==================== CHANNEL OPERATIONS ====================

	async upsertChannel(
		channel: Omit<Channel, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const recordId = `channels:${channel.discordId}_${channel.guildId}`;

			const query = `
				UPDATE ${recordId} MERGE {
					discord_id: $discord_id,
					guild_id: $guild_id,
					channel_name: $channel_name,
					position: $position,
					is_active: $is_active,
					active_user_ids: $active_user_ids,
					member_count: $member_count,
					status: $status,
					last_status_change: $last_status_change,
					updated_at: time::now()
				}
			`;

			await executeQuery(query, {
				discord_id: channel.discordId,
				guild_id: channel.guildId,
				channel_name: channel.channelName,
				position: channel.position,
				is_active: channel.isActive,
				active_user_ids: channel.activeUserIds,
				member_count: channel.memberCount,
				status: channel.status,
				last_status_change: channel.lastStatusChange,
			});
		}, `upsertChannel(${channel.discordId})`);
	}

	async getChannel(
		discordId: string,
		guildId: string,
	): Promise<Channel | null> {
		return this.withPerformanceTracking(
			async () => {
				const query = `
				SELECT * FROM ${this.tables.channels}
				WHERE discord_id = $discord_id AND guild_id = $guild_id
			`;
				return await executeQueryOne<Channel>(query, {
					discord_id: discordId,
					guild_id: guildId,
				});
			},
			`getChannel(${discordId})`,
			true,
			`channel_${discordId}_${guildId}`,
		);
	}

	async getActiveChannels(guildId: string): Promise<Channel[]> {
		return this.withPerformanceTracking(
			async () => {
				const query = `
				SELECT * FROM ${this.tables.channels}
				WHERE guild_id = $guild_id AND is_active = true
				ORDER BY member_count DESC, created_at ASC
			`;
				const result = await executeQuery<Channel>(query, {
					guild_id: guildId,
				});
				// Ensure we always return an array
				return Array.isArray(result) ? result : [];
			},
			`getActiveChannels(${guildId})`,
			true,
			`active_channels_${guildId}`,
		);
	}

	async addChannelMember(
		discordId: string,
		guildId: string,
		userId: string,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const recordId = `channels:${discordId}_${guildId}`;
			const query = `
				UPDATE ${recordId} SET 
					active_user_ids = array::append(active_user_ids, $user_id),
					member_count = array::len(array::append(active_user_ids, $user_id)),
					is_active = true,
					updated_at = time::now()
			`;
			await executeQuery(query, { user_id: userId });
		}, `addChannelMember(${discordId}, ${userId})`);
	}

	async removeChannelMember(
		discordId: string,
		guildId: string,
		userId: string,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const recordId = `channels:${discordId}_${guildId}`;
			const query = `
				UPDATE ${recordId} SET 
					active_user_ids = array::remove(active_user_ids, $user_id),
					member_count = array::len(array::remove(active_user_ids, $user_id)),
					is_active = array::len(array::remove(active_user_ids, $user_id)) > 0,
					updated_at = time::now()
			`;
			await executeQuery(query, { user_id: userId });
		}, `removeChannelMember(${discordId}, ${userId})`);
	}

	async setChannelInactive(discordId: string, guildId: string): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const recordId = `channels:${discordId}_${guildId}`;
			const query = `
				UPDATE ${recordId} SET 
					is_active = false,
					active_user_ids = [],
					member_count = 0,
					updated_at = time::now()
			`;
			await executeQuery(query, {});
		}, `setChannelInactive(${discordId})`);
	}

	async deleteChannel(discordId: string, guildId: string): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const recordId = `channels:${discordId}_${guildId}`;
			const query = `DELETE ${recordId}`;
			await executeQuery(query, {});
		}, `deleteChannel(${discordId})`);
	}

	// ==================== VOICE CHANNEL SESSION OPERATIONS ====================

	async createVoiceChannelSession(
		session: Omit<VoiceChannelSession, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				CREATE ${this.tables.voiceChannelSessions} SET
					user_id = $user_id,
					guild_id = $guild_id,
					channel_id = $channel_id,
					channel_name = $channel_name,
					joined_at = $joined_at,
					left_at = $left_at,
					duration = $duration,
					is_active = $is_active
			`;
			await executeQuery(query, {
				user_id: session.userId,
				guild_id: session.guildId,
				channel_id: session.channelId,
				channel_name: session.channelName,
				joined_at: session.joinedAt,
				left_at: session.leftAt,
				duration: session.duration,
				is_active: session.isActive,
			});
		}, `createVoiceChannelSession(${session.userId})`);
	}

	async endVoiceChannelSession(
		userId: string,
		channelId: string,
		leftAt: Date,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				UPDATE ${this.tables.voiceChannelSessions} SET 
					left_at = $left_at,
					duration = time::diff(joined_at, $left_at, 's'),
					is_active = false,
					updated_at = time::now()
				WHERE user_id = $user_id AND channel_id = $channel_id AND is_active = true
			`;
			await executeQuery(query, {
				user_id: userId,
				channel_id: channelId,
				left_at: leftAt,
			});
		}, `endVoiceChannelSession(${userId})`);
	}

	async getActiveVoiceChannelSessions(
		channelId?: string,
	): Promise<VoiceChannelSession[]> {
		return this.withPerformanceTracking(
			async () => {
				let result: VoiceChannelSession[] = [];

				if (channelId) {
					const query = `
						SELECT * FROM ${this.tables.voiceChannelSessions}
						WHERE channel_id = $channel_id AND is_active = true
						ORDER BY joined_at ASC
					`;
					result = await executeQuery<VoiceChannelSession>(query, {
						channel_id: channelId,
					});
				} else {
					const query = `
						SELECT * FROM ${this.tables.voiceChannelSessions}
						WHERE is_active = true
						ORDER BY joined_at ASC
					`;
					result = await executeQuery<VoiceChannelSession>(query, {});
				}

				// Ensure we always return an array
				return Array.isArray(result) ? result : [];
			},
			`getActiveVoiceChannelSessions(${channelId || "all"})`,
			true,
			`active_sessions_${channelId || "all"}`,
		);
	}

	async getUserVoiceChannelSessions(
		userId: string,
		guildId: string,
		limit = 50,
	): Promise<VoiceChannelSession[]> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.voiceChannelSessions}
				WHERE user_id = $user_id AND guild_id = $guild_id
				ORDER BY joined_at DESC
				LIMIT $limit
			`;
			return await executeQuery<VoiceChannelSession>(query, {
				user_id: userId,
				guild_id: guildId,
				limit,
			});
		}, `getUserVoiceChannelSessions(${userId})`);
	}

	async getChannelVoiceChannelSessions(
		channelId: string,
		limit = 100,
	): Promise<VoiceChannelSession[]> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.voiceChannelSessions}
				WHERE channel_id = $channel_id
				ORDER BY joined_at DESC
				LIMIT $limit
			`;
			return await executeQuery<VoiceChannelSession>(query, {
				channel_id: channelId,
				limit,
			});
		}, `getChannelVoiceChannelSessions(${channelId})`);
	}

	async getCurrentVoiceChannelSession(
		userId: string,
	): Promise<VoiceChannelSession | null> {
		return this.withPerformanceTracking(
			async () => {
				const query = `
				SELECT * FROM ${this.tables.voiceChannelSessions}
				WHERE user_id = $user_id AND is_active = true
				ORDER BY joined_at DESC
				LIMIT 1
			`;
				return await executeQueryOne<VoiceChannelSession>(query, {
					user_id: userId,
				});
			},
			`getCurrentVoiceChannelSession(${userId})`,
			true,
			`current_session_${userId}`,
		);
	}

	// ==================== TRANSACTIONAL VOICE CHANNEL SESSION OPERATIONS ====================

	async createVoiceChannelSessionTransaction(
		surreal: Surreal,
		session: Omit<VoiceChannelSession, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		// Calculate duration in application code
		const now = new Date();
		const duration = Math.floor(
			(now.getTime() - session.joinedAt.getTime()) / 1000,
		);

		// 1) End any other active sessions for this user
		await surreal.query(
			`
			UPDATE ${this.tables.voiceChannelSessions} SET 
				is_active = false,
				left_at = time::now(),
				duration = $duration,
				updated_at = time::now()
			WHERE user_id = $user_id AND guild_id = $guild_id AND is_active = true AND channel_id != $channel_id
		`,
			{
				user_id: session.userId,
				guild_id: session.guildId,
				channel_id: session.channelId,
				duration: duration,
			},
		);

		// 2) Create new session
		await surreal.query(
			`
			CREATE ${this.tables.voiceChannelSessions} SET
				user_id = $user_id,
				guild_id = $guild_id,
				channel_id = $channel_id,
				channel_name = $channel_name,
				joined_at = $joined_at,
				left_at = $left_at,
				duration = $duration,
				is_active = $is_active
		`,
			{
				user_id: session.userId,
				guild_id: session.guildId,
				channel_id: session.channelId,
				channel_name: session.channelName,
				joined_at: session.joinedAt,
				left_at: session.leftAt,
				duration: session.duration,
				is_active: session.isActive,
			},
		);
	}

	async endVoiceChannelSessionTransaction(
		surreal: Surreal,
		userId: string,
		channelId: string,
		leftAt: Date,
		duration?: number,
	): Promise<void> {
		const query = `
			UPDATE ${this.tables.voiceChannelSessions} SET 
				left_at = $left_at,
				duration = $duration,
				is_active = false,
				updated_at = time::now()
			WHERE user_id = $user_id AND channel_id = $channel_id AND is_active = true
		`;
		await surreal.query(query, {
			user_id: userId,
			channel_id: channelId,
			left_at: leftAt,
			duration,
		});
	}

	async getCurrentVoiceChannelSessionTransaction(
		surreal: Surreal,
		userId: string,
		guildId: string,
	): Promise<VoiceChannelSession | null> {
		const query = `
			SELECT * FROM ${this.tables.voiceChannelSessions}
			WHERE user_id = $user_id AND guild_id = $guild_id AND is_active = true
			ORDER BY joined_at DESC
			LIMIT 1
		`;
		const result = await surreal.query(query, {
			user_id: userId,
			guild_id: guildId,
		});
		return result[0]?.result?.[0] || null;
	}

	// ==================== DATA SYNCHRONIZATION ====================

	async syncChannelActiveUsers(channelId: string): Promise<void> {
		return this.withPerformanceTracking(async () => {
			// Get all active sessions for this channel
			const activeSessions =
				await this.getActiveVoiceChannelSessions(channelId);

			// Ensure activeSessions is an array
			const sessions = Array.isArray(activeSessions) ? activeSessions : [];
			const activeUserIds = sessions.map((session) => session.userId);

			// Update the channel's active_user_ids and member_count
			const query = `
				UPDATE ${this.tables.channels} SET 
					active_user_ids = $active_user_ids,
					member_count = $member_count,
					updated_at = time::now()
				WHERE discord_id = $discord_id
			`;
			await executeQuery(query, {
				discord_id: channelId,
				active_user_ids: activeUserIds,
				member_count: activeUserIds.length,
			});
		}, `syncChannelActiveUsers(${channelId})`);
	}

	async syncAllChannelsActiveUsers(): Promise<void> {
		return this.withPerformanceTracking(async () => {
			// Get all active channels
			const channels = await executeQuery<Channel>(`
				SELECT discord_id FROM ${this.tables.channels} 
				WHERE is_active = true
			`);

			// Sync each channel
			for (const channel of channels) {
				await this.syncChannelActiveUsers(channel.discordId);
			}
		}, "syncAllChannelsActiveUsers()");
	}

	// ==================== VOICE SESSION QUERIES (HELPERS) ====================

	/** Check if a user has an active session in the given channel */
	async hasActiveSession(userId: string, channelId: string): Promise<boolean> {
		const row = await executeQueryOne<{ exists: boolean }>(
			`
				SELECT EXISTS (
					SELECT 1 FROM ${this.tables.voiceChannelSessions}
					WHERE user_id = $user_id AND channel_id = $channel_id AND is_active = true
				) AS exists
			`,
			{ user_id: userId, channel_id: channelId },
		);
		return Boolean(row?.exists);
	}

	/** Get all active voice sessions (minimal fields for reconciliation) */
	async getAllActiveSessions(): Promise<
		Array<{
			userId: string;
			channelId: string;
			channelName: string;
			guildId: string;
		}>
	> {
		const rows = await executeQuery<{
			user_id: string;
			channel_id: string;
			channel_name: string;
			guild_id: string;
		}>(
			`
				SELECT user_id, channel_id, channel_name, guild_id
				FROM ${this.tables.voiceChannelSessions}
				WHERE is_active = true
			`,
		);

		// Ensure rows is an array
		const safeRows = Array.isArray(rows) ? rows : [];
		return safeRows.map((r) => ({
			userId: r.user_id,
			channelId: r.channel_id,
			channelName: r.channel_name,
			guildId: r.guild_id,
		}));
	}

	/** Get active channel members (users currently in a specific channel) */
	async getActiveChannelMembers(channelId: string): Promise<string[]> {
		return this.withPerformanceTracking(
			async () => {
				const sessions = await this.getActiveVoiceChannelSessions(channelId);
				return sessions.map((session) => session.userId);
			},
			`getActiveChannelMembers(${channelId})`,
			true,
			`channel_members_${channelId}`,
		);
	}

	/** Get count of active channel members */
	async getActiveChannelMemberCount(channelId: string): Promise<number> {
		return this.withPerformanceTracking(
			async () => {
				const query = `
				SELECT COUNT() AS count FROM ${this.tables.voiceChannelSessions}
				WHERE channelId = $channel_id AND isActive = true
			`;
				const result = await executeQueryOne<{ count: number }>(query, {
					channel_id: channelId,
				});
				return result?.count || 0;
			},
			`getActiveChannelMemberCount(${channelId})`,
			true,
			`channel_member_count_${channelId}`,
		);
	}

	// ==================== BATCH OPERATIONS ====================

	/** Batch upsert multiple users at once */
	async batchUpsertUsers(
		users: Array<Omit<User, "id" | "createdAt" | "updatedAt">>,
	): Promise<void> {
		if (users.length === 0) return;

		return this.withPerformanceTracking(async () => {
			// Create batch query for all users using direct value embedding (no parameters)
			const queries = users
				.map((user, index) => {
					const recordId = `users:${user.discordId}_${user.guildId}`;
					const avatarHistory = JSON.stringify(user.avatarHistory || []);
					const usernameHistory = JSON.stringify(user.usernameHistory || []);
					const displayNameHistory = JSON.stringify(
						user.displayNameHistory || [],
					);
					const nicknameHistory = JSON.stringify(user.nicknameHistory || []);
					const statusHistory = JSON.stringify(user.statusHistory || []);
					const keywords = JSON.stringify(user.keywords || []);
					const notes = JSON.stringify(user.notes || []);
					const relationships = JSON.stringify(user.relationships || []);
					const voiceInteractions = JSON.stringify(
						user.voiceInteractions || [],
					);
					const roles = JSON.stringify(user.roles || []);
					const modPreferences = JSON.stringify(user.modPreferences || {});

					return `
					INSERT INTO users {
						id: ${recordId},
						discordId: "${user.discordId}",
						guildId: "${user.guildId}",
						bot: ${user.bot},
						username: "${user.username}",
						displayName: "${user.displayName}",
						nickname: "${user.nickname}",
						discriminator: "${user.discriminator}",
						avatar: ${user.avatar ? `"${user.avatar}"` : "null"},
						status: "${user.status}",
						roles: ${roles},
						joinedAt: "${user.joinedAt.toISOString()}",
						lastSeen: "${user.lastSeen.toISOString()}",
						avatarHistory: ${avatarHistory},
						usernameHistory: ${usernameHistory},
						displayNameHistory: ${displayNameHistory},
						nicknameHistory: ${nicknameHistory},
						statusHistory: ${statusHistory},
						emoji: ${user.emoji ? `"${user.emoji}"` : "null"},
						title: ${user.title ? `"${user.title}"` : "null"},
						summary: ${user.summary ? `"${user.summary}"` : "null"},
						keywords: ${keywords},
						notes: ${notes},
						relationships: ${relationships},
						modPreferences: ${modPreferences},
						voiceInteractions: ${voiceInteractions},
						createdAt: time::now(),
						updatedAt: time::now()
					};
				`;
				})
				.join("\n");

			const result = await executeQuery(queries, {});

			// Clear related caches
			const guildIds = [...new Set(users.map((u) => u.guildId))];
			for (const guildId of guildIds) {
				this.queryCache.delete(`guild_stats_${guildId}`);
			}
		}, `batchUpsertUsers(${users.length} users)`);
	}

	/** Batch upsert multiple roles at once */
	async batchUpsertRoles(
		roles: Array<Omit<Role, "id" | "createdAt" | "updatedAt">>,
	): Promise<void> {
		if (roles.length === 0) return;

		return this.withPerformanceTracking(async () => {
			// Create batch query for all roles using direct value embedding
			const queries = roles
				.map((role) => {
					const recordId = `roles:${role.discordId}_${role.guildId}`;
					return `
					INSERT INTO roles {
						id: ${recordId},
						discordId: "${role.discordId}",
						guildId: "${role.guildId}",
						name: "${role.name}",
						color: ${role.color !== null && role.color !== undefined ? role.color : "null"},
						mentionable: ${role.mentionable},
						permissions: "${role.permissions}",
						position: ${role.position},
						createdAt: time::now(),
						updatedAt: time::now()
					};
				`;
				})
				.join("\n");

			const result = await executeQuery(queries, {});

			// Clear related caches
			const guildIds = [...new Set(roles.map((r) => r.guildId))];
			for (const guildId of guildIds) {
				this.queryCache.delete(`guild_stats_${guildId}`);
			}
		}, `batchUpsertRoles(${roles.length} roles)`);
	}

	/** Batch upsert multiple channels at once */
	async batchUpsertChannels(
		channels: Array<Omit<Channel, "id" | "createdAt" | "updatedAt">>,
	): Promise<void> {
		if (channels.length === 0) return;

		return this.withPerformanceTracking(async () => {
			// Create batch query for all channels using direct value embedding
			const queries = channels
				.map((channel) => {
					const recordId = `channels:${channel.discordId}_${channel.guildId}`;
					const activeUserIds = JSON.stringify(channel.activeUserIds || []);
					const lastStatusChange = channel.lastStatusChange
						? `"${channel.lastStatusChange.toISOString()}"`
						: "null";

					return `
				INSERT INTO channels {
					id: ${recordId},
					discordId: "${channel.discordId}",
					guildId: "${channel.guildId}",
					channelName: "${channel.channelName}",
					position: ${channel.position},
					isActive: ${channel.isActive},
					activeUserIds: ${activeUserIds},
					memberCount: ${channel.memberCount},
					status: "${channel.status}",
					lastStatusChange: ${lastStatusChange},
					type: "${channel.type}",
					topic: ${channel.topic ? `"${channel.topic}"` : "null"},
					createdAt: time::now(),
					updatedAt: time::now()
				};
			`;
				})
				.join("\n");

			const result = await executeQuery(queries, {});

			// Clear related caches
			const guildIds = [...new Set(channels.map((c) => c.guildId))];
			for (const guildId of guildIds) {
				this.queryCache.delete(`guild_stats_${guildId}`);
			}
		}, `batchUpsertChannels(${channels.length} channels)`);
	}

	// ==================== MAINTENANCE ====================

	async wipeDatabase(): Promise<void> {
		const { dropSurrealTables, createSurrealTables } = await import(
			"./SurrealSchema"
		);
		await dropSurrealTables();
		await createSurrealTables();
	}
}
