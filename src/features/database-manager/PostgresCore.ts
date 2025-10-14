import type { PoolClient } from "pg";
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
} from "./PostgresConnection";
import {
	createPostgresIndexes,
	createPostgresTables,
	dropPostgresTables,
	initializePostgresSchema,
} from "./PostgresSchema";

export class DatabaseCore {
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

	async initialize(): Promise<void> {
		await initializePostgresSchema();

		// One-time normalization: ensure channels.active_user_ids is never NULL
		try {
			await executeQuery(
				`UPDATE ${this.tables.channels} SET active_user_ids = '{}'::text[] WHERE active_user_ids IS NULL`,
			);
		} catch (e) {
			// Best-effort; do not block initialization
			console.warn(
				"🔸 Failed to normalize active_user_ids (will continue):",
				e,
			);
		}
	}

	// Performance wrapper for database operations
	private async withPerformanceTracking<T>(
		operation: () => Promise<T>,
		operationName: string,
	): Promise<T> {
		const startTime = memoryManager.startTimer();
		try {
			const result = await operation();
			const duration = memoryManager.endTimer(startTime);
			memoryManager.recordDatabaseQueryTime(duration);

			// Log slow queries (>500ms)
			if (duration > 500) {
				console.warn(
					`🔸 Slow database query: ${operationName} took ${duration.toFixed(2)}ms`,
				);
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
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.users} 
				WHERE discord_id = $1 AND guild_id = $2
			`;
			return await executeQueryOne<User>(query, [discordId, guildId]);
		}, `getUser(${discordId}, ${guildId})`);
	}

	async getUsersByGuild(guildId: string): Promise<User[]> {
		return this.withPerformanceTracking(async () => {
			const query = `SELECT * FROM ${this.tables.users} WHERE guild_id = $1`;
			return await executeQuery<User>(query, [guildId]);
		}, `getUsersByGuild(${guildId})`);
	}

	async upsertUser(
		user: Omit<User, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const query = `
			INSERT INTO ${this.tables.users} (
				discord_id, guild_id, bot, username, display_name, nickname, discriminator,
				avatar, status, roles, joined_at, last_seen, avatar_history,
				username_history, display_name_history, nickname_history, status_history, emoji,
				title, summary, keywords, notes, relationships, mod_preferences, voice_interactions
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
			)
			ON CONFLICT (discord_id, guild_id) 
			DO UPDATE SET
				bot = EXCLUDED.bot,
				username = EXCLUDED.username,
				display_name = EXCLUDED.display_name,
				nickname = EXCLUDED.nickname,
				discriminator = EXCLUDED.discriminator,
				avatar = EXCLUDED.avatar,
				status = EXCLUDED.status,
				roles = EXCLUDED.roles,
				joined_at = EXCLUDED.joined_at,
				last_seen = EXCLUDED.last_seen,
				avatar_history = EXCLUDED.avatar_history,
				username_history = EXCLUDED.username_history,
				display_name_history = EXCLUDED.display_name_history,
				nickname_history = EXCLUDED.nickname_history,
				status_history = EXCLUDED.status_history,
				emoji = EXCLUDED.emoji,
				title = EXCLUDED.title,
				summary = EXCLUDED.summary,
				keywords = EXCLUDED.keywords,
				notes = EXCLUDED.notes,
				relationships = EXCLUDED.relationships,
				mod_preferences = EXCLUDED.mod_preferences,
				voice_interactions = EXCLUDED.voice_interactions,
				updated_at = CURRENT_TIMESTAMP
		`;

		await executeQuery(query, [
			user.discordId,
			user.guildId,
			user.bot,
			user.username,
			user.displayName,
			user.nickname,
			user.discriminator,
			user.avatar,
			user.status,
			user.roles,
			user.joinedAt,
			user.lastSeen,
			JSON.stringify(user.avatarHistory),
			user.usernameHistory,
			user.displayNameHistory,
			user.nicknameHistory,
			JSON.stringify(user.statusHistory),
			user.emoji,
			user.title,
			user.summary,
			user.keywords,
			user.notes,
			JSON.stringify(user.relationships),
			JSON.stringify(user.modPreferences),
			JSON.stringify(user.voiceInteractions),
		]);
	}

	async upsertUserTransaction(
		client: PoolClient,
		user: Omit<User, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const query = `
			INSERT INTO ${this.tables.users} (
				discord_id, guild_id, bot, username, display_name, nickname, discriminator,
				avatar, status, roles, joined_at, last_seen, avatar_history,
				username_history, display_name_history, nickname_history, status_history, emoji,
				title, summary, keywords, notes, relationships, mod_preferences, voice_interactions
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
			)
			ON CONFLICT (discord_id, guild_id) 
			DO UPDATE SET
				bot = EXCLUDED.bot,
				username = EXCLUDED.username,
				display_name = EXCLUDED.display_name,
				nickname = EXCLUDED.nickname,
				discriminator = EXCLUDED.discriminator,
				avatar = EXCLUDED.avatar,
				status = EXCLUDED.status,
				roles = EXCLUDED.roles,
				joined_at = EXCLUDED.joined_at,
				last_seen = EXCLUDED.last_seen,
				avatar_history = EXCLUDED.avatar_history,
				username_history = EXCLUDED.username_history,
				display_name_history = EXCLUDED.display_name_history,
				nickname_history = EXCLUDED.nickname_history,
				status_history = EXCLUDED.status_history,
				emoji = EXCLUDED.emoji,
				title = EXCLUDED.title,
				summary = EXCLUDED.summary,
				keywords = EXCLUDED.keywords,
				notes = EXCLUDED.notes,
				relationships = EXCLUDED.relationships,
				mod_preferences = EXCLUDED.mod_preferences,
				voice_interactions = EXCLUDED.voice_interactions,
				updated_at = CURRENT_TIMESTAMP
		`;

		await client.query(query, [
			user.discordId,
			user.guildId,
			user.bot,
			user.username,
			user.displayName,
			user.nickname,
			user.discriminator,
			user.avatar,
			user.status,
			user.roles,
			user.joinedAt,
			user.lastSeen,
			JSON.stringify(user.avatarHistory),
			user.usernameHistory,
			user.displayNameHistory,
			user.nicknameHistory,
			JSON.stringify(user.statusHistory),
			user.emoji,
			user.title,
			user.summary,
			user.keywords,
			user.notes,
			JSON.stringify(user.relationships),
			JSON.stringify(user.modPreferences),
			JSON.stringify(user.voiceInteractions),
		]);
	}

	// ==================== ROLE OPERATIONS ====================

	async getRolesByGuild(guildId: string): Promise<Role[]> {
		try {
			const query = `SELECT * FROM ${this.tables.roles} WHERE guild_id = $1`;
			return await executeQuery<Role>(query, [guildId]);
		} catch (error) {
			console.error("🔸 Error getting roles by guild:", error);
			return [];
		}
	}

	async upsertRole(
		role: Omit<Role, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const query = `
			INSERT INTO ${this.tables.roles} (
				discord_id, guild_id, name, color, mentionable
			) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (discord_id, guild_id)
			DO UPDATE SET
				name = EXCLUDED.name,
				color = EXCLUDED.color,
				mentionable = EXCLUDED.mentionable,
				updated_at = CURRENT_TIMESTAMP
		`;

		await executeQuery(query, [
			role.discordId,
			role.guildId,
			role.name,
			role.color,
			role.mentionable,
		]);
	}

	// ==================== MESSAGE OPERATIONS ====================

	async getMessagesByGuild(guildId: string, limit = 100): Promise<DBMessage[]> {
		try {
			const query = `
				SELECT * FROM ${this.tables.messages} 
				WHERE guild_id = $1 
				ORDER BY timestamp DESC 
				LIMIT $2
			`;
			return await executeQuery<DBMessage>(query, [guildId, limit]);
		} catch (error) {
			console.error("🔸 Error getting messages by guild:", error);
			return [];
		}
	}

	async getMessagesByChannel(
		guildId: string,
		channelName: string,
		limit = 100,
	): Promise<DBMessage[]> {
		try {
			const query = `
				SELECT * FROM ${this.tables.messages} 
				WHERE guild_id = $1 AND channel_id = $2 
				ORDER BY timestamp DESC 
				LIMIT $3
			`;
			return await executeQuery<DBMessage>(query, [
				guildId,
				channelName,
				limit,
			]);
		} catch (error) {
			console.error("🔸 Error getting messages by channel:", error);
			return [];
		}
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
		const query = `
			SELECT m.*, u.* FROM ${this.tables.messages} m
			LEFT JOIN ${this.tables.users} u ON m.author_id = u.discord_id AND m.guild_id = u.guild_id
			WHERE m.guild_id = $1
			ORDER BY m.timestamp DESC
			LIMIT $2
		`;

		const rows = await executeQuery(query, [guildId, limit]);

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
		const query = `
			SELECT m.*, u.* FROM ${this.tables.messages} m
			LEFT JOIN ${this.tables.users} u ON m.author_id = u.discord_id AND m.guild_id = u.guild_id
			WHERE m.guild_id = $1
			ORDER BY m.timestamp ASC
			LIMIT $2
		`;

		const rows = await executeQuery(query, [guildId, limit]);

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
	}

	async upsertMessage(
		message: Omit<DBMessage, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const query = `
			INSERT INTO ${this.tables.messages} (
				discord_id, content, author_id, channel_id, guild_id, timestamp,
				edited_at, deleted_at, mentions, reactions, reply_to, attachments, embeds
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (discord_id)
			DO UPDATE SET
				content = EXCLUDED.content,
				author_id = EXCLUDED.author_id,
				channel_id = EXCLUDED.channel_id,
				guild_id = EXCLUDED.guild_id,
				timestamp = EXCLUDED.timestamp,
				edited_at = EXCLUDED.edited_at,
				deleted_at = EXCLUDED.deleted_at,
				mentions = EXCLUDED.mentions,
				reactions = EXCLUDED.reactions,
				reply_to = EXCLUDED.reply_to,
				attachments = EXCLUDED.attachments,
				embeds = EXCLUDED.embeds,
				updated_at = CURRENT_TIMESTAMP
		`;

		await executeQuery(query, [
			message.discordId,
			message.content,
			message.authorId,
			message.channelId,
			message.guildId,
			message.timestamp,
			message.editedAt,
			message.deletedAt,
			message.mentions,
			JSON.stringify(message.reactions),
			message.replyTo,
			JSON.stringify(message.attachments),
			JSON.stringify(message.embeds),
		]);
	}

	async batchInsertMessages(
		messages: Omit<DBMessage, "id" | "createdAt" | "updatedAt">[],
	): Promise<void> {
		if (messages.length === 0) return;

		const values = messages
			.map((_, index) => {
				const offset = index * 13;
				return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`;
			})
			.join(", ");

		const query = `
			INSERT INTO ${this.tables.messages} (
				discord_id, content, author_id, channel_id, guild_id, timestamp,
				edited_at, deleted_at, mentions, reactions, reply_to, attachments, embeds
			) VALUES ${values}
			ON CONFLICT (discord_id) DO NOTHING
		`;

		const params = messages.flatMap((message) => [
			message.discordId,
			message.content,
			message.authorId,
			message.channelId,
			message.guildId,
			message.timestamp,
			message.editedAt,
			message.deletedAt,
			message.mentions,
			JSON.stringify(message.reactions),
			message.replyTo,
			JSON.stringify(message.attachments),
			JSON.stringify(message.embeds),
		]);

		await executeQuery(query, params);
	}

	// ==================== GUILD SYNC OPERATIONS ====================

	async getGuildSync(guildId: string): Promise<GuildSync | null> {
		try {
			const query = `SELECT * FROM ${this.tables.guildSyncs} WHERE guild_id = $1`;
			return await executeQueryOne<GuildSync>(query, [guildId]);
		} catch (error) {
			console.error("🔸 Error getting guild sync:", error);
			return null;
		}
	}

	async updateGuildSync(
		guildSync: Omit<GuildSync, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const query = `
			INSERT INTO ${this.tables.guildSyncs} (
				guild_id, last_sync_at, last_message_id, total_users, total_messages, total_roles, is_fully_synced
			) VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (guild_id)
			DO UPDATE SET
				last_sync_at = EXCLUDED.last_sync_at,
				last_message_id = EXCLUDED.last_message_id,
				total_users = EXCLUDED.total_users,
				total_messages = EXCLUDED.total_messages,
				total_roles = EXCLUDED.total_roles,
				is_fully_synced = EXCLUDED.is_fully_synced,
				updated_at = CURRENT_TIMESTAMP
		`;

		await executeQuery(query, [
			guildSync.guildId,
			guildSync.lastSyncAt,
			guildSync.lastMessageId,
			guildSync.totalUsers,
			guildSync.totalMessages,
			guildSync.totalRoles,
			guildSync.isFullySynced,
		]);
	}

	// ==================== ROLE RESTORATION OPERATIONS ====================

	async restoreMemberRoles(
		member: import("discord.js").GuildMember,
	): Promise<{ success: boolean; restoredCount: number; error?: string }> {
		return this.withPerformanceTracking(async () => {
			const query = `SELECT * FROM ${this.tables.users} WHERE discord_id = $1`;
			const userData = await executeQueryOne(query, [member.id]);

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
		const queries = [
			`SELECT COUNT(*) as count FROM ${this.tables.users} WHERE guild_id = $1`,
			`SELECT COUNT(*) as count FROM ${this.tables.messages} WHERE guild_id = $1`,
			`SELECT COUNT(*) as count FROM ${this.tables.roles} WHERE guild_id = $1`,
			// Count users with at least one voice interaction; cast voice_interactions to jsonb explicitly
			`SELECT COUNT(*) as count FROM ${this.tables.users} WHERE guild_id = $1 AND jsonb_array_length(voice_interactions::jsonb) > 0`,
		];

		const results = await Promise.all(
			queries.map((query) => executeQueryOne(query, [guildId])),
		);

		return {
			totalUsers: Number.parseInt(results[0]?.count || "0"),
			totalMessages: Number.parseInt(results[1]?.count || "0"),
			totalRoles: Number.parseInt(results[2]?.count || "0"),
			totalVoiceSessions: Number.parseInt(results[3]?.count || "0"),
		};
	}

	// ==================== MODERATION PREFERENCES OPERATIONS ====================

	async getModPreferences(userId: string): Promise<ModPreferences | null> {
		return this.withPerformanceTracking(async () => {
			const query = `SELECT mod_preferences FROM ${this.tables.users} WHERE discord_id = $1`;
			const user = await executeQueryOne(query, [userId]);
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
				// User doesn't exist, we need to create them with minimal required data
				// Get user data from Discord if possible
				try {
					const guild = this.client?.guilds?.cache?.get(guildId);
					if (guild) {
						const member = await guild.members.fetch(userId);
						if (member) {
							// Create user with Discord data
							const userData: Omit<User, "_id" | "createdAt" | "updatedAt"> = {
								discordId: userId,
								username: member.user.username,
								displayName: member.displayName,
								discriminator: member.user.discriminator,
								avatar: member.user.displayAvatarURL(),
								avatarHistory: [],
								bot: member.user.bot,
								usernameHistory: [],
								displayNameHistory: [],
								roles: member.roles.cache.map((role) => role.id),
								joinedAt: member.joinedAt || new Date(),
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
							await this.upsertUser(userData);
							return;
						}
					}
				} catch (error) {
					console.warn(
						`🔸 Could not fetch Discord data for user ${userId}:`,
						error,
					);
				}

				// Fallback: create user with minimal data
				const minimalUserData: Omit<User, "_id" | "createdAt" | "updatedAt"> = {
					discordId: userId,
					username: `user_${userId}`, // Fallback username
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
			const query = `
				UPDATE ${this.tables.users}
				SET mod_preferences = jsonb_set(
					COALESCE(mod_preferences, '{}'::jsonb),
					'{lastUpdated}',
					to_jsonb(CURRENT_TIMESTAMP)
				),
				updated_at = CURRENT_TIMESTAMP
				WHERE discord_id = $1 AND guild_id = $2
			`;

			// Merge preferences with existing ones
			const existingPreferences = user.modPreferences || {};
			const mergedPreferences = { ...existingPreferences, ...preferences };

			await executeQuery(query, [userId, guildId]);

			// Update specific preference fields
			for (const [key, value] of Object.entries(preferences)) {
				if (value !== undefined) {
					const updateQuery = `
						UPDATE ${this.tables.users}
						SET mod_preferences = jsonb_set(
							COALESCE(mod_preferences, '{}'::jsonb),
							'{${key}}',
							$1::jsonb
						),
						updated_at = CURRENT_TIMESTAMP
						WHERE discord_id = $2 AND guild_id = $3
					`;
					await executeQuery(updateQuery, [
						JSON.stringify(value),
						userId,
						guildId,
					]);
				}
			}
		}, `updateModPreferences(${userId})`);
	}

	// ==================== VOICE INTERACTION OPERATIONS ====================

	async addVoiceInteraction(
		userId: string,
		guildId: string,
		interaction: VoiceInteraction,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				UPDATE ${this.tables.users}
				SET voice_interactions = voice_interactions || $1::jsonb,
					updated_at = CURRENT_TIMESTAMP
				WHERE discord_id = $2 AND guild_id = $3
			`;
			await executeQuery(query, [
				JSON.stringify([interaction]),
				userId,
				guildId,
			]);
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
			const query = `
				UPDATE ${this.tables.users}
				SET voice_interactions = $1,
					updated_at = CURRENT_TIMESTAMP
				WHERE discord_id = $2 AND guild_id = $3
			`;
			await executeQuery(query, [
				JSON.stringify(updatedInteractions),
				userId,
				guildId,
			]);
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
				WHERE discord_id = $1 AND guild_id = $2
			`;
				const params = [userId, guildId];

				if (channelId) {
					query += " AND voice_interactions @> $3";
					params.push(JSON.stringify([{ channelId }]));
				}

				const result = await executeQueryOne(query, params);
				return result?.voice_interactions || [];
			},
			`getUserVoiceInteractions(${userId}, ${channelId || "all"})`,
		);
	}

	// ==================== MODERATION HISTORY OPERATIONS ====================

	async addModHistory(
		userId: string,
		guildId: string,
		entry: ModHistoryEntry,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				UPDATE ${this.tables.users}
				SET mod_preferences = jsonb_set(
					mod_preferences,
					'{modHistory}',
					COALESCE(mod_preferences->'modHistory', '[]'::jsonb) || $1::jsonb
				),
				updated_at = CURRENT_TIMESTAMP
				WHERE discord_id = $2 AND guild_id = $3
			`;
			await executeQuery(query, [JSON.stringify([entry]), userId, guildId]);
		}, `addModHistory(${userId}, ${entry.action})`);
	}

	async getUserModHistory(
		userId: string,
		guildId: string,
		limit?: number,
	): Promise<ModHistoryEntry[]> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT mod_preferences->'modHistory' as mod_history
				FROM ${this.tables.users}
				WHERE discord_id = $1 AND guild_id = $2
			`;
			const result = await executeQueryOne(query, [userId, guildId]);
			const modHistory = result?.mod_history || [];

			if (limit && modHistory.length > limit) {
				return modHistory.slice(-limit);
			}

			return modHistory;
		}, `getUserModHistory(${userId})`);
	}

	// ==================== HIERARCHY DETERMINATION ====================

	async getUsersInGuild(guildId: string, userIds: string[]): Promise<User[]> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.users}
				WHERE guild_id = $1 AND discord_id = ANY($2)
			`;
			return await executeQuery<User>(query, [guildId, userIds]);
		}, `getUsersInGuild(${guildId}, ${userIds.length} users)`);
	}

	// ==================== CHANNEL OPERATIONS ====================

	async upsertChannel(
		channel: Omit<Channel, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				INSERT INTO ${this.tables.channels} (
					discord_id, guild_id, channel_name, position, is_active, active_user_ids, member_count, status, last_status_change
				) VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8, $9
				)
				ON CONFLICT (discord_id, guild_id)
				DO UPDATE SET
					channel_name = EXCLUDED.channel_name,
					position = EXCLUDED.position,
					is_active = EXCLUDED.is_active,
					active_user_ids = EXCLUDED.active_user_ids,
					member_count = EXCLUDED.member_count,
					status = COALESCE(EXCLUDED.status, ${this.tables.channels}.status),
					last_status_change = COALESCE(EXCLUDED.last_status_change, ${this.tables.channels}.last_status_change),
					updated_at = CURRENT_TIMESTAMP
			`;
			await executeQuery(query, [
				channel.discordId,
				channel.guildId,
				channel.channelName,
				channel.position,
				channel.isActive,
				channel.activeUserIds,
				channel.memberCount,
				channel.status ?? null,
				channel.lastStatusChange ?? null,
			]);
		}, `upsertChannel(${channel.discordId})`);
	}

	async upsertChannelTransaction(
		client: PoolClient,
		channel: Omit<Channel, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		// Build dynamic query based on which fields are provided
		const fields: string[] = [];
		const values: unknown[] = [];
		const updates: string[] = [];
		let paramIndex = 1;

		// Always include these fields
		fields.push("discord_id", "guild_id");
		values.push(channel.discordId, channel.guildId);
		paramIndex += 2;

		if (channel.channelName !== undefined) {
			fields.push("channel_name");
			values.push(channel.channelName);
			updates.push(`channel_name = $${paramIndex}`);
			paramIndex++;
		}

		if (channel.position !== undefined) {
			fields.push("position");
			values.push(channel.position);
			updates.push(`position = $${paramIndex}`);
			paramIndex++;
		}

		if (channel.isActive !== undefined) {
			fields.push("is_active");
			values.push(channel.isActive);
			updates.push(`is_active = $${paramIndex}`);
			paramIndex++;
		}

		// Only update active_user_ids and member_count if explicitly provided
		if (channel.activeUserIds !== undefined) {
			fields.push("active_user_ids");
			values.push(channel.activeUserIds);
			updates.push(`active_user_ids = $${paramIndex}`);
			paramIndex++;
		}

		if (channel.memberCount !== undefined) {
			fields.push("member_count");
			values.push(channel.memberCount);
			updates.push(`member_count = $${paramIndex}`);
			paramIndex++;
		}

		if (channel.status !== undefined) {
			fields.push("status");
			values.push(channel.status);
			updates.push(`status = $${paramIndex}`);
			paramIndex++;
		}

		if (channel.lastStatusChange !== undefined) {
			fields.push("last_status_change");
			values.push(channel.lastStatusChange);
			updates.push(`last_status_change = $${paramIndex}`);
			paramIndex++;
		}

		// Always update timestamp
		updates.push("updated_at = CURRENT_TIMESTAMP");

		const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");
		const updateClause = updates.join(", ");

		const query = `
			INSERT INTO ${this.tables.channels} (${fields.join(", ")})
			VALUES (${placeholders})
			ON CONFLICT (discord_id, guild_id)
			DO UPDATE SET ${updateClause}
		`;

		await client.query(query, values);
	}

	/**
	 * Get active members in a voice channel from voice_channel_sessions table
	 */
	async getActiveChannelMembers(channelId: string): Promise<string[]> {
		const query = `
			SELECT user_id 
			FROM ${this.tables.voiceChannelSessions}
			WHERE channel_id = $1 AND is_active = true
		`;
		const rows = await executeQuery<{ user_id: string }>(query, [channelId]);
		return rows.map((row) => row.user_id);
	}

	/**
	 * Get count of active members in a voice channel from voice_channel_sessions table
	 */
	async getActiveChannelMemberCount(channelId: string): Promise<number> {
		const query = `
			SELECT COUNT(*) as count
			FROM ${this.tables.voiceChannelSessions}
			WHERE channel_id = $1 AND is_active = true
		`;
		const result = await executeQueryOne<{ count: string }>(query, [channelId]);
		return result ? Number.parseInt(result.count, 10) : 0;
	}

	async getChannel(
		discordId: string,
		guildId: string,
	): Promise<Channel | null> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.channels}
				WHERE discord_id = $1 AND guild_id = $2
			`;
			return await executeQueryOne<Channel>(query, [discordId, guildId]);
		}, `getChannel(${discordId})`);
	}

	async getActiveChannels(guildId: string): Promise<Channel[]> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.channels}
				WHERE guild_id = $1 AND is_active = TRUE
				ORDER BY member_count DESC, created_at ASC
			`;
			return await executeQuery<Channel>(query, [guildId]);
		}, `getActiveChannels(${guildId})`);
	}

	async addChannelMember(
		discordId: string,
		guildId: string,
		userId: string,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				UPDATE ${this.tables.channels}
				SET 
					active_user_ids = CASE 
						WHEN $3 = ANY(active_user_ids) THEN active_user_ids
						ELSE active_user_ids || $3
					END,
					member_count = CASE 
						WHEN $3 = ANY(active_user_ids) THEN member_count
						ELSE member_count + 1
					END,
					is_active = TRUE,
					updated_at = CURRENT_TIMESTAMP
				WHERE discord_id = $1 AND guild_id = $2
			`;
			await executeQuery(query, [discordId, guildId, userId]);
		}, `addChannelMember(${discordId}, ${userId})`);
	}

	async removeChannelMember(
		discordId: string,
		guildId: string,
		userId: string,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				UPDATE ${this.tables.channels}
				SET 
					active_user_ids = array_remove(active_user_ids, $3),
					member_count = GREATEST(member_count - 1, 0),
					is_active = CASE 
						WHEN array_length(array_remove(active_user_ids, $3), 1) IS NULL THEN FALSE
						ELSE TRUE
					END,
					updated_at = CURRENT_TIMESTAMP
				WHERE discord_id = $1 AND guild_id = $2
			`;
			await executeQuery(query, [discordId, guildId, userId]);
		}, `removeChannelMember(${discordId}, ${userId})`);
	}

	async addChannelMemberTransaction(
		client: PoolClient,
		discordId: string,
		guildId: string,
		userId: string,
	): Promise<void> {
		const query = `
			UPDATE ${this.tables.channels}
			SET 
				active_user_ids = CASE 
					WHEN $3 = ANY(active_user_ids) THEN active_user_ids
					ELSE active_user_ids || $3
				END,
				member_count = CASE 
					WHEN $3 = ANY(active_user_ids) THEN member_count
					ELSE member_count + 1
				END,
				is_active = TRUE,
				updated_at = CURRENT_TIMESTAMP
			WHERE discord_id = $1 AND guild_id = $2
		`;
		await client.query(query, [discordId, guildId, userId]);
	}

	async removeChannelMemberTransaction(
		client: PoolClient,
		discordId: string,
		guildId: string,
		userId: string,
	): Promise<void> {
		const query = `
			UPDATE ${this.tables.channels}
			SET 
				active_user_ids = array_remove(active_user_ids, $3),
				member_count = GREATEST(member_count - 1, 0),
				is_active = CASE 
					WHEN array_length(array_remove(active_user_ids, $3), 1) IS NULL THEN FALSE
					ELSE TRUE
				END,
				updated_at = CURRENT_TIMESTAMP
			WHERE discord_id = $1 AND guild_id = $2
		`;
		await client.query(query, [discordId, guildId, userId]);
	}

	async setChannelInactive(discordId: string, guildId: string): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				UPDATE ${this.tables.channels}
				SET 
					is_active = FALSE,
					active_user_ids = '{}',
					member_count = 0,
					updated_at = CURRENT_TIMESTAMP
				WHERE discord_id = $1 AND guild_id = $2
			`;
			await executeQuery(query, [discordId, guildId]);
		}, `setChannelInactive(${discordId})`);
	}

	async deleteChannel(discordId: string, guildId: string): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				DELETE FROM ${this.tables.channels}
				WHERE discord_id = $1 AND guild_id = $2
			`;
			await executeQuery(query, [discordId, guildId]);
		}, `deleteChannel(${discordId})`);
	}

	// ==================== VOICE CHANNEL SESSION OPERATIONS ====================

	async createVoiceChannelSession(
		session: Omit<VoiceChannelSession, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				INSERT INTO ${this.tables.voiceChannelSessions} (
					user_id, guild_id, channel_id, channel_name, joined_at, left_at, duration, is_active
				) VALUES (
					$1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::timestamp, $6::timestamp, $7::int, $8::boolean
				)
				ON CONFLICT (user_id, channel_id, is_active) DO NOTHING
			`;
			await executeQuery(query, [
				session.userId,
				session.guildId,
				session.channelId,
				session.channelName,
				session.joinedAt,
				session.leftAt,
				session.duration,
				session.isActive,
			]);
		}, `createVoiceChannelSession(${session.userId})`);
	}

	async endVoiceChannelSession(
		userId: string,
		channelId: string,
		leftAt: Date,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const query = `
				UPDATE ${this.tables.voiceChannelSessions}
				SET 
					left_at = $3,
					duration = EXTRACT(EPOCH FROM ($3 - joined_at))::INTEGER,
					is_active = FALSE,
					updated_at = CURRENT_TIMESTAMP
				WHERE user_id = $1 AND channel_id = $2 AND is_active = TRUE
			`;
			await executeQuery(query, [userId, channelId, leftAt]);
		}, `endVoiceChannelSession(${userId})`);
	}

	async getActiveVoiceChannelSessions(
		channelId?: string,
	): Promise<VoiceChannelSession[]> {
		return this.withPerformanceTracking(
			async () => {
				if (channelId) {
					// Get sessions for specific channel
					const query = `
					SELECT * FROM ${this.tables.voiceChannelSessions}
					WHERE channel_id = $1 AND is_active = TRUE
					ORDER BY joined_at ASC
				`;
					return await executeQuery<VoiceChannelSession>(query, [channelId]);
				}

				// Get all active sessions across all channels
				const query = `
				SELECT * FROM ${this.tables.voiceChannelSessions}
				WHERE is_active = TRUE
				ORDER BY joined_at ASC
			`;
				return await executeQuery<VoiceChannelSession>(query);
			},
			`getActiveVoiceChannelSessions(${channelId || "all"})`,
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
				WHERE user_id = $1 AND guild_id = $2
				ORDER BY joined_at DESC
				LIMIT $3
			`;
			return await executeQuery<VoiceChannelSession>(query, [
				userId,
				guildId,
				limit,
			]);
		}, `getUserVoiceChannelSessions(${userId})`);
	}

	async getChannelVoiceChannelSessions(
		channelId: string,
		limit = 100,
	): Promise<VoiceChannelSession[]> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.voiceChannelSessions}
				WHERE channel_id = $1
				ORDER BY joined_at DESC
				LIMIT $2
			`;
			return await executeQuery<VoiceChannelSession>(query, [channelId, limit]);
		}, `getChannelVoiceChannelSessions(${channelId})`);
	}

	async getCurrentVoiceChannelSession(
		userId: string,
	): Promise<VoiceChannelSession | null> {
		return this.withPerformanceTracking(async () => {
			const query = `
				SELECT * FROM ${this.tables.voiceChannelSessions}
				WHERE user_id = $1 AND is_active = TRUE
				ORDER BY joined_at DESC
				LIMIT 1
			`;
			return await executeQueryOne<VoiceChannelSession>(query, [userId]);
		}, `getCurrentVoiceChannelSession(${userId})`);
	}

	// ==================== TRANSACTIONAL VOICE CHANNEL SESSION OPERATIONS ====================

	async createVoiceChannelSessionTransaction(
		client: PoolClient,
		session: Omit<VoiceChannelSession, "id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		// 1) End any other active sessions for this user (ensures only one active session globally)
		//    Compute duration based on joined_at where available
		await client.query(
			`
				UPDATE ${this.tables.voiceChannelSessions}
				SET 
					is_active = FALSE,
					left_at = COALESCE(left_at, CURRENT_TIMESTAMP),
					duration = COALESCE(duration, GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - joined_at))::int)),
					updated_at = CURRENT_TIMESTAMP
				WHERE user_id = $1::varchar AND guild_id = $2::varchar AND is_active = TRUE AND channel_id <> $3::varchar
			`,
			[session.userId, session.guildId, session.channelId],
		);

		// 2) Insert or refresh active session for this channel
		// Try UPDATE existing active row first to avoid relying on partial unique indexes
		const updateResult = await client.query(
			`
				UPDATE ${this.tables.voiceChannelSessions}
				SET 
					channel_name = $4,
					joined_at = $5,
					left_at = $6,
					duration = $7,
					is_active = $8,
					updated_at = CURRENT_TIMESTAMP
				WHERE user_id = $1::varchar AND guild_id = $2::varchar AND channel_id = $3::varchar AND is_active = TRUE
			`,
			[
				session.userId,
				session.guildId,
				session.channelId,
				session.channelName,
				session.joinedAt,
				session.leftAt,
				session.duration,
				session.isActive,
			],
		);

		if (updateResult.rowCount === 0) {
			await client.query(
				`
					INSERT INTO ${this.tables.voiceChannelSessions} (
						user_id, guild_id, channel_id, channel_name, joined_at, left_at, duration, is_active
					) VALUES (
						$1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::timestamp, $6::timestamp, $7::int, $8::boolean
					)
					ON CONFLICT (user_id, channel_id, is_active) DO NOTHING
				`,
				[
					session.userId,
					session.guildId,
					session.channelId,
					session.channelName,
					session.joinedAt,
					session.leftAt,
					session.duration,
					session.isActive,
				],
			);
		}
	}

	async endVoiceChannelSessionTransaction(
		client: PoolClient,
		userId: string,
		channelId: string,
		leftAt: Date,
		duration?: number,
	): Promise<void> {
		const query = `
			UPDATE ${this.tables.voiceChannelSessions}
			SET 
				left_at = $3,
				duration = $4,
				is_active = FALSE,
				updated_at = CURRENT_TIMESTAMP
			WHERE user_id = $1 AND channel_id = $2 AND is_active = TRUE
		`;
		await client.query(query, [userId, channelId, leftAt, duration]);
	}

	async getCurrentVoiceChannelSessionTransaction(
		client: PoolClient,
		userId: string,
	): Promise<VoiceChannelSession | null> {
		const query = `
			SELECT * FROM ${this.tables.voiceChannelSessions}
			WHERE user_id = $1 AND is_active = TRUE
			ORDER BY joined_at DESC
			LIMIT 1
		`;
		const result = await client.query(query, [userId]);
		if (result.rows[0]) {
			const session = result.rows[0];
			// Normalize field names to camelCase and convert timestamps to Date
			return {
				id: session.id,
				userId: session.user_id,
				guildId: session.guild_id,
				channelId: session.channel_id,
				channelName: session.channel_name,
				joinedAt: new Date(session.joined_at),
				leftAt: session.left_at ? new Date(session.left_at) : undefined,
				duration: session.duration ?? undefined,
				isActive: session.is_active,
				createdAt: new Date(session.created_at),
				updatedAt: new Date(session.updated_at),
			};
		}
		return null;
	}

	// ==================== DATA SYNCHRONIZATION ====================

	async syncChannelActiveUsers(channelId: string): Promise<void> {
		return this.withPerformanceTracking(async () => {
			// Get all active sessions for this channel
			const activeSessions =
				await this.getActiveVoiceChannelSessions(channelId);
			const activeUserIds = activeSessions.map((session) => session.userId);

			// Update the channel's active_user_ids and member_count
			const query = `
				UPDATE ${this.tables.channels}
				SET 
					active_user_ids = $2,
					member_count = $3,
					updated_at = CURRENT_TIMESTAMP
				WHERE discord_id = $1
			`;
			await executeQuery(query, [
				channelId,
				activeUserIds,
				activeUserIds.length,
			]);
		}, `syncChannelActiveUsers(${channelId})`);
	}

	async syncAllChannelsActiveUsers(): Promise<void> {
		return this.withPerformanceTracking(async () => {
			// Get all active channels
			const channels = await executeQuery<Channel>(`
				SELECT discord_id FROM ${this.tables.channels} 
				WHERE is_active = TRUE
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
					WHERE user_id = $1 AND channel_id = $2 AND is_active = TRUE
				) AS exists
			`,
			[userId, channelId],
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
				WHERE is_active = TRUE
			`,
		);
		return rows.map((r) => ({
			userId: (r as any).userId ?? (r as any).user_id,
			channelId: (r as any).channelId ?? (r as any).channel_id,
			channelName: (r as any).channelName ?? (r as any).channel_name,
			guildId: (r as any).guildId ?? (r as any).guild_id,
		}));
	}

	// ==================== MAINTENANCE ====================

	async wipeDatabase(): Promise<void> {
		await dropPostgresTables();
		await createPostgresTables();
		await createPostgresIndexes();
	}
}
