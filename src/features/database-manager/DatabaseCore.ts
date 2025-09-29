import type { Db } from "mongodb";
import type {
	DatabaseCollections,
	Message as DBMessage,
	GuildSync,
	Role,
	User,
	UserInteraction,
	VoiceSession,
} from "../../types/database";
import { getDatabase } from "../../utils/database";

export class DatabaseCore {
	private db: Db | null = null;
	private collections: DatabaseCollections | null = null;

	async initialize(): Promise<void> {
		this.db = await getDatabase();
		if (!this.db) {
			throw new Error("Database connection failed.");
		}

		this.collections = {
			users: this.db.collection("users"),
			roles: this.db.collection("roles"),
			messages: this.db.collection("messages"),
			voiceSessions: this.db.collection("voiceSessions"),
			guildSyncs: this.db.collection("guildSyncs"),
			userInteractions: this.db.collection("userInteractions"),
		};

		// Create indexes for better performance
		await this.createIndexes();
	}

	private async createIndexes(): Promise<void> {
		if (!this.collections) return;

		try {
			// User indexes
			await this.collections.users.createIndex(
				{ discordId: 1, guildId: 1 },
				{ unique: true },
			);
			await this.collections.users.createIndex({ guildId: 1 });
			await this.collections.users.createIndex({ lastSeen: 1 });

			// Role indexes
			await this.collections.roles.createIndex(
				{ discordId: 1, guildId: 1 },
				{ unique: true },
			);
			await this.collections.roles.createIndex({ guildId: 1 });

			// Message indexes
			await this.collections.messages.createIndex(
				{ discordId: 1 },
				{ unique: true },
			);
			await this.collections.messages.createIndex({ guildId: 1, channelId: 1 });
			await this.collections.messages.createIndex({ authorId: 1 });
			await this.collections.messages.createIndex({ timestamp: 1 });
			await this.collections.messages.createIndex({ mentions: 1 });

			// Voice session indexes
			await this.collections.voiceSessions.createIndex({
				userId: 1,
				guildId: 1,
			});
			await this.collections.voiceSessions.createIndex({ joinedAt: 1 });
			await this.collections.voiceSessions.createIndex({ leftAt: 1 });

			// Guild sync indexes
			await this.collections.guildSyncs.createIndex(
				{ guildId: 1 },
				{ unique: true },
			);

			// User interaction indexes
			await this.collections.userInteractions.createIndex({
				fromUserId: 1,
				toUserId: 1,
				guildId: 1,
			});
			await this.collections.userInteractions.createIndex({
				guildId: 1,
				timestamp: 1,
			});
			await this.collections.userInteractions.createIndex({
				interactionType: 1,
			});

			console.log("🔹 Database indexes created successfully");
		} catch (error) {
			console.error("🔸 Error creating database indexes:", error);
		}
	}

	private getCollections(): DatabaseCollections {
		if (!this.collections) {
			throw new Error("Database not initialized. Call initialize() first.");
		}
		return this.collections;
	}

	// ==================== USER OPERATIONS ====================

	async getUser(discordId: string, guildId: string): Promise<User | null> {
		try {
			const collections = this.getCollections();
			return await collections.users.findOne({ discordId, guildId });
		} catch (error) {
			console.error("🔸 Error getting user:", error);
			return null;
		}
	}

	async getUsersByGuild(guildId: string): Promise<User[]> {
		try {
			const collections = this.getCollections();
			return await collections.users.find({ guildId }).toArray();
		} catch (error) {
			console.error("🔸 Error getting users by guild:", error);
			return [];
		}
	}

	async upsertUser(
		user: Omit<User, "_id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		await collections.users.updateOne(
			{ discordId: user.discordId, guildId: user.guildId },
			{
				$set: {
					...user,
					updatedAt: now,
				},
				$setOnInsert: {
					createdAt: now,
				},
			},
			{ upsert: true },
		);
	}

	// ==================== ROLE OPERATIONS ====================

	async getRolesByGuild(guildId: string): Promise<Role[]> {
		try {
			const collections = this.getCollections();
			return await collections.roles.find({ guildId }).toArray();
		} catch (error) {
			console.error("🔸 Error getting roles by guild:", error);
			return [];
		}
	}

	async upsertRole(
		role: Omit<Role, "_id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		await collections.roles.updateOne(
			{ discordId: role.discordId, guildId: role.guildId },
			{
				$set: {
					...role,
					updatedAt: now,
				},
				$setOnInsert: {
					createdAt: now,
				},
			},
			{ upsert: true },
		);
	}

	// ==================== MESSAGE OPERATIONS ====================

	async getMessagesByGuild(
		guildId: string,
		limit: number = 100,
	): Promise<DBMessage[]> {
		try {
			const collections = this.getCollections();
			return await collections.messages
				.find({ guildId })
				.sort({ timestamp: -1 })
				.limit(limit)
				.toArray();
		} catch (error) {
			console.error("🔸 Error getting messages by guild:", error);
			return [];
		}
	}

	async getMessagesByChannel(
		guildId: string,
		channelName: string,
		limit: number = 100,
	): Promise<DBMessage[]> {
		try {
			const collections = this.getCollections();
			return await collections.messages
				.find({ guildId, channelId: channelName })
				.sort({ timestamp: -1 })
				.limit(limit)
				.toArray();
		} catch (error) {
			console.error("🔸 Error getting messages by channel:", error);
			return [];
		}
	}

	async getRecentMessagesWithUsers(
		guildId: string,
		limit: number = 20,
	): Promise<
		{
			message: DBMessage;
			user: User | null;
		}[]
	> {
		const collections = this.getCollections();

		// Get most recent messages
		const messages = await collections.messages
			.find({ guildId })
			.sort({ timestamp: -1 })
			.limit(limit)
			.toArray();

		// Get user data for each message author
		const result = await Promise.all(
			messages.map(async (message: DBMessage) => {
				const user = await collections.users.findOne({
					discordId: message.authorId,
					guildId: message.guildId,
				});
				return { message, user };
			}),
		);

		return result;
	}

	async getOldestMessagesWithUsers(
		guildId: string,
		limit: number = 20,
	): Promise<
		{
			message: DBMessage;
			user: User | null;
		}[]
	> {
		const collections = this.getCollections();

		// Get oldest messages
		const messages = await collections.messages
			.find({ guildId })
			.sort({ timestamp: 1 })
			.limit(limit)
			.toArray();

		// Get user data for each message author
		const result = await Promise.all(
			messages.map(async (message: DBMessage) => {
				const user = await collections.users.findOne({
					discordId: message.authorId,
					guildId: message.guildId,
				});
				return { message, user };
			}),
		);

		return result;
	}

	async upsertMessage(
		message: Omit<DBMessage, "_id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		await collections.messages.updateOne(
			{ discordId: message.discordId },
			{
				$set: {
					...message,
					updatedAt: now,
				},
				$setOnInsert: {
					createdAt: now,
				},
			},
			{ upsert: true },
		);
	}

	async batchInsertMessages(
		messages: Omit<DBMessage, "_id" | "createdAt" | "updatedAt">[],
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		const documents = messages.map((message) => ({
			...message,
			createdAt: now,
			updatedAt: now,
		}));

		await collections.messages.insertMany(documents);
	}

	// ==================== VOICE SESSION OPERATIONS ====================

	async getVoiceSessionsByUser(
		userId: string,
		guildId: string,
	): Promise<VoiceSession[]> {
		try {
			const collections = this.getCollections();
			return await collections.voiceSessions
				.find({ userId, guildId })
				.sort({ joinedAt: -1 })
				.toArray();
		} catch (error) {
			console.error("🔸 Error getting voice sessions by user:", error);
			return [];
		}
	}

	async getVoiceSessionsByGuild(guildId: string): Promise<VoiceSession[]> {
		try {
			const collections = this.getCollections();
			return await collections.voiceSessions
				.find({ guildId })
				.sort({ joinedAt: -1 })
				.toArray();
		} catch (error) {
			console.error("🔸 Error getting voice sessions by guild:", error);
			return [];
		}
	}

	async createVoiceSession(
		session: Omit<VoiceSession, "_id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		await collections.voiceSessions.insertOne({
			...session,
			createdAt: now,
			updatedAt: now,
		});
	}

	async updateVoiceSession(
		userId: string,
		guildId: string,
		leftAt: Date,
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		await collections.voiceSessions.updateOne(
			{ userId, guildId, leftAt: { $exists: false } },
			{
				$set: {
					leftAt,
					duration: Math.floor((leftAt.getTime() - Date.now()) / 1000),
					updatedAt: now,
				},
			},
		);
	}

	// ==================== INTERACTION OPERATIONS ====================

	async recordInteraction(
		interaction: Omit<UserInteraction, "_id" | "createdAt">,
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		await collections.userInteractions.insertOne({
			...interaction,
			createdAt: now,
		});
	}

	async getUserInteractions(
		fromUserId: string,
		toUserId: string,
		guildId: string,
	): Promise<UserInteraction[]> {
		try {
			const collections = this.getCollections();
			return await collections.userInteractions
				.find({ fromUserId, toUserId, guildId })
				.sort({ timestamp: -1 })
				.toArray();
		} catch (error) {
			console.error("🔸 Error getting user interactions:", error);
			return [];
		}
	}

	// ==================== GUILD SYNC OPERATIONS ====================

	async getGuildSync(guildId: string): Promise<GuildSync | null> {
		try {
			const collections = this.getCollections();
			return await collections.guildSyncs.findOne({ guildId });
		} catch (error) {
			console.error("🔸 Error getting guild sync:", error);
			return null;
		}
	}

	async updateGuildSync(
		guildSync: Omit<GuildSync, "_id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		await collections.guildSyncs.updateOne(
			{ guildId: guildSync.guildId },
			{
				$set: {
					...guildSync,
					updatedAt: now,
				},
				$setOnInsert: {
					createdAt: now,
				},
			},
			{ upsert: true },
		);
	}

	// ==================== STATISTICS ====================

	async getGuildStats(guildId: string): Promise<{
		totalUsers: number;
		totalMessages: number;
		totalRoles: number;
		totalVoiceSessions: number;
	}> {
		const collections = this.getCollections();

		const [totalUsers, totalMessages, totalRoles, totalVoiceSessions] =
			await Promise.all([
				collections.users.countDocuments({ guildId }),
				collections.messages.countDocuments({ guildId }),
				collections.roles.countDocuments({ guildId }),
				collections.voiceSessions.countDocuments({ guildId }),
			]);

		return {
			totalUsers,
			totalMessages,
			totalRoles,
			totalVoiceSessions,
		};
	}

	// ==================== MAINTENANCE ====================

	async wipeDatabase(): Promise<void> {
		const collections = this.getCollections();

		console.log("🔹 Wiping database...");

		// Drop all collections
		await Promise.all([
			collections.users
				.drop()
				.catch(() => {}), // Ignore if collection doesn't exist
			collections.roles.drop().catch(() => {}),
			collections.messages.drop().catch(() => {}),
			collections.voiceSessions.drop().catch(() => {}),
			collections.guildSyncs.drop().catch(() => {}),
			collections.userInteractions.drop().catch(() => {}),
		]);

		// Recreate indexes
		await this.createIndexes();

		console.log("🔹 Database wiped successfully");
	}
}
