import type { Db } from "mongodb";
import type {
	AvatarHistory,
	Message as DBMessage,
	DatabaseCollections,
	GuildSync,
	ModPreferences,
	RenamedUser,
	Role,
	User,
	UserStatus,
	VoiceSession,
} from "../../types/database";
import { memoryManager } from "../performance-monitoring/MemoryManager";
import { getDatabase } from "./DatabaseConnection";

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
		};

		// Create indexes for better performance
		await this.createIndexes();
	}

	private async createIndexes(): Promise<void> {
		if (!this.collections) return;

		try {
			// User indexes
			await this.collections.users.createIndex(
				{ discordId: 1 },
				{ unique: true },
			);
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
			const collections = this.getCollections();
			return await collections.users.findOne({ discordId, guildId });
		}, `getUser(${discordId}, ${guildId})`);
	}

	async getUsersByGuild(guildId: string): Promise<User[]> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			return collections.users.find({ guildId }).toArray();
		}, `getUsersByGuild(${guildId})`);
	}

	async upsertUser(
		user: Omit<User, "_id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		await collections.users.updateOne(
			{ discordId: user.discordId },
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
			return collections.roles.find({ guildId }).toArray();
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

	async getMessagesByGuild(guildId: string, limit = 100): Promise<DBMessage[]> {
		try {
			const collections = this.getCollections();
			return collections.messages
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
		limit = 100,
	): Promise<DBMessage[]> {
		try {
			const collections = this.getCollections();
			return collections.messages
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
		limit = 20,
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
				});
				return { message, user };
			}),
		);

		return result;
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

		// Use upsert to avoid duplicate sessions
		await collections.voiceSessions.updateOne(
			{
				userId: session.userId,
				guildId: session.guildId,
				channelId: session.channelId,
				leftAt: { $exists: false },
			},
			{
				$setOnInsert: {
					...session,
					createdAt: now,
					updatedAt: now,
				},
			},
			{ upsert: true },
		);
	}

	async updateVoiceSession(
		userId: string,
		guildId: string,
		leftAt: Date,
		channelId?: string,
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		// Build filter to find the active session
		const filter: Record<string, unknown> = {
			userId,
			leftAt: { $exists: false },
		};

		// If channelId is provided, filter by it to ensure we update the correct session
		if (channelId) {
			filter.channelId = channelId;
		}

		// First, get the session to calculate proper duration
		const activeSession = await collections.voiceSessions.findOne(filter);
		if (!activeSession) {
			console.warn(
				`🔸 No active voice session found for user ${userId} in guild ${guildId}`,
			);
			return;
		}

		// Calculate duration using the original joinedAt time
		const duration = activeSession.joinedAt
			? Math.floor((leftAt.getTime() - activeSession.joinedAt.getTime()) / 1000)
			: 0;

		await collections.voiceSessions.updateOne(filter, {
			$set: {
				leftAt,
				duration,
				updatedAt: now,
			},
		});
	}

	// ==================== INTERACTION OPERATIONS ====================

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

	// ==================== VOICE DURATION OPERATIONS ====================

	async getActiveVoiceDurations(
		channelId: string,
		guildId: string,
	): Promise<Array<{ userId: string; duration: number }>> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();

			// Get active voice sessions for this channel
			// Only get the most recent active session per user to avoid duplicates
			const activeFilter = {
				channelId,
				$or: [{ leftAt: { $exists: false } }, { leftAt: { $type: "null" } }], // Active session (hasn't left yet)
			};

			// Use aggregation to get only the most recent session per user
			const activeSessions = await collections.voiceSessions
				.aggregate([
					{ $match: activeFilter },
					{ $sort: { joinedAt: -1 } }, // Sort by most recent join time
					{
						$group: {
							_id: "$userId",
							latestSession: { $first: "$$ROOT" },
						},
					},
					{ $replaceRoot: { newRoot: "$latestSession" } },
				])
				.toArray();

			// Calculate durations - FIXED: Use proper duration calculation
			const now = Date.now();
			return activeSessions.map((session) => ({
				userId: session.userId,
				duration: session.joinedAt
					? Math.floor((now - session.joinedAt.getTime()) / 1000)
					: 0, // Convert to seconds
			}));
		}, `getActiveVoiceDurations(${channelId}, ${guildId})`);
	}

	// ==================== ROLE RESTORATION OPERATIONS ====================

	async restoreMemberRoles(
		member: import("discord.js").GuildMember,
	): Promise<{ success: boolean; restoredCount: number; error?: string }> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();

			// Get user data from database
			const userData = await collections.users.findOne({
				discordId: member.id,
			});

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

	// ==================== MODERATION PREFERENCES OPERATIONS ====================

	/**
	 * Get moderation preferences for a user
	 */
	async getModPreferences(userId: string): Promise<ModPreferences | null> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const user = await collections.users.findOne({
				discordId: userId,
			});

			return user?.modPreferences || null;
		}, `getModPreferences(${userId})`);
	}

	/**
	 * Update moderation preferences for a user
	 */
	async updateModPreferences(
		userId: string,
		preferences: Partial<ModPreferences>,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const now = new Date();

			// First, ensure the user exists with default mod preferences
			await collections.users.updateOne(
				{ discordId: userId },
				{
					$setOnInsert: {
						discordId: userId,
						modPreferences: {
							bannedUsers: [],
							mutedUsers: [],
							kickedUsers: [],
							deafenedUsers: [],
							renamedUsers: [],
							lastUpdated: now,
						},
						createdAt: now,
						updatedAt: now,
					},
				},
				{ upsert: true },
			);

			// Update mod preferences
			await collections.users.updateOne(
				{ discordId: userId },
				{
					$set: {
						"modPreferences.lastUpdated": now,
						updatedAt: now,
						...Object.fromEntries(
							Object.entries(preferences).map(([key, value]) => [
								`modPreferences.${key}`,
								value,
							]),
						),
					},
				},
			);
		}, `updateModPreferences(${userId})`);
	}

	/**
	 * Add a user to a moderation list (banned, muted, etc.)
	 */
	async addUserToModerationList(
		ownerId: string,
		guildId: string,
		listType: "bannedUsers" | "mutedUsers" | "kickedUsers" | "deafenedUsers",
		targetUserId: string,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const now = new Date();

			// Ensure user exists with mod preferences
			await collections.users.updateOne(
				{ discordId: ownerId, guildId },
				{
					$setOnInsert: {
						discordId: ownerId,
						modPreferences: {
							bannedUsers: [],
							mutedUsers: [],
							kickedUsers: [],
							deafenedUsers: [],
							renamedUsers: [],
							lastUpdated: now,
						},
						createdAt: now,
						updatedAt: now,
					},
				},
				{ upsert: true },
			);

			// Add user to moderation list
			await collections.users.updateOne(
				{ discordId: ownerId, guildId },
				{
					$addToSet: {
						[`modPreferences.${listType}`]: targetUserId,
					},
					$set: {
						"modPreferences.lastUpdated": now,
						updatedAt: now,
					},
				},
			);
		}, `addUserToModerationList(${ownerId}, ${guildId}, ${listType})`);
	}

	/**
	 * Remove a user from a moderation list
	 */
	async removeUserFromModerationList(
		ownerId: string,
		guildId: string,
		listType: "bannedUsers" | "mutedUsers" | "kickedUsers" | "deafenedUsers",
		targetUserId: string,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const now = new Date();

			await collections.users.updateOne(
				{ discordId: ownerId, guildId },
				{
					$pull: {
						[`modPreferences.${listType}`]: targetUserId,
					},
					$set: {
						"modPreferences.lastUpdated": now,
						updatedAt: now,
					},
				},
			);
		}, `removeUserFromModerationList(${ownerId}, ${guildId}, ${listType})`);
	}

	/**
	 * Add a renamed user to the mod preferences
	 */
	async addRenamedUser(
		ownerId: string,
		guildId: string,
		renamedUser: RenamedUser,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const now = new Date();

			// Ensure user exists with mod preferences
			await collections.users.updateOne(
				{ discordId: ownerId, guildId },
				{
					$setOnInsert: {
						discordId: ownerId,
						modPreferences: {
							bannedUsers: [],
							mutedUsers: [],
							kickedUsers: [],
							deafenedUsers: [],
							renamedUsers: [],
							lastUpdated: now,
						},
						createdAt: now,
						updatedAt: now,
					},
				},
				{ upsert: true },
			);

			// Remove any existing rename for this user
			await collections.users.updateOne(
				{ discordId: ownerId, guildId },
				{
					$pull: {
						"modPreferences.renamedUsers": {
							userId: renamedUser.userId,
						},
					},
				},
			);

			// Add the new rename
			await collections.users.updateOne(
				{ discordId: ownerId, guildId },
				{
					$push: {
						"modPreferences.renamedUsers": renamedUser,
					},
					$set: {
						"modPreferences.lastUpdated": now,
						updatedAt: now,
					},
				},
			);
		}, `addRenamedUser(${ownerId}, ${guildId})`);
	}

	/**
	 * Remove a renamed user from the mod preferences
	 */
	async removeRenamedUser(
		ownerId: string,
		guildId: string,
		targetUserId: string,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const now = new Date();

			await collections.users.updateOne(
				{ discordId: ownerId, guildId },
				{
					$pull: {
						"modPreferences.renamedUsers": {
							userId: targetUserId,
						},
					},
					$set: {
						"modPreferences.lastUpdated": now,
						updatedAt: now,
					},
				},
			);
		}, `removeRenamedUser(${ownerId}, ${guildId})`);
	}

	/**
	 * Check if a user is in a moderation list
	 */
	async isUserInModerationList(
		ownerId: string,
		guildId: string,
		listType: "bannedUsers" | "mutedUsers" | "kickedUsers" | "deafenedUsers",
		targetUserId: string,
	): Promise<boolean> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const user = await collections.users.findOne({
				discordId: ownerId,
				[`modPreferences.${listType}`]: targetUserId,
			});

			return !!user;
		}, `isUserInModerationList(${ownerId}, ${guildId}, ${listType})`);
	}

	/**
	 * Get all users in a moderation list
	 */
	async getUsersInModerationList(
		ownerId: string,
		guildId: string,
		listType: "bannedUsers" | "mutedUsers" | "kickedUsers" | "deafenedUsers",
	): Promise<string[]> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const user = await collections.users.findOne({
				discordId: ownerId,
			});

			return user?.modPreferences?.[listType] || [];
		}, `getUsersInModerationList(${ownerId}, ${guildId}, ${listType})`);
	}

	// ==================== AVATAR AND STATUS TRACKING ====================

	/**
	 * Track avatar changes for a user
	 */
	async trackAvatarChange(
		userId: string,
		newAvatarUrl: string,
		avatarHash?: string,
	): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const now = new Date();

			// Ensure user exists
			await collections.users.updateOne(
				{ discordId: userId },
				{
					$setOnInsert: {
						discordId: userId,
						avatarHistory: [],
						statusHistory: [],
						modPreferences: {
							bannedUsers: [],
							mutedUsers: [],
							kickedUsers: [],
							deafenedUsers: [],
							renamedUsers: [],
							lastUpdated: now,
						},
						createdAt: now,
						updatedAt: now,
					},
				},
				{ upsert: true },
			);

			// Try to update existing avatar first (more efficient than separate check)
			const updateResult = await collections.users.updateOne(
				{
					discordId: userId,
					"avatarHistory.avatarUrl": newAvatarUrl,
				},
				{
					$set: {
						"avatarHistory.$.lastSeen": now,
						avatar: newAvatarUrl,
						updatedAt: now,
					},
				},
			);

			// If no existing avatar was updated, add new one
			if (updateResult.matchedCount === 0) {
				// Download and store image data
				let imageData: string | undefined;
				let contentType: string | undefined;
				let fileSize: number | undefined;

				try {
					const response = await fetch(newAvatarUrl);
					if (response.ok) {
						const buffer = await response.arrayBuffer();
						imageData = Buffer.from(buffer).toString("base64");
						contentType = response.headers.get("content-type") || undefined;
						fileSize = buffer.byteLength;
					}
				} catch (error) {
					console.warn(
						`🔸 Failed to download avatar for user ${userId}:`,
						error,
					);
				}

				// Add new avatar to history
				const newAvatarEntry: AvatarHistory = {
					avatarUrl: newAvatarUrl,
					avatarHash,
					imageData,
					contentType,
					fileSize,
					firstSeen: now,
					lastSeen: now,
				};

				await collections.users.updateOne(
					{ discordId: userId },
					{
						$push: { avatarHistory: newAvatarEntry },
						$set: {
							avatar: newAvatarUrl,
							updatedAt: now,
						},
					},
				);
			}
		}, `trackAvatarChange(${userId})`);
	}

	/**
	 * Track status changes for a user (text status only)
	 */
	async trackStatusChange(userId: string, newStatus: string): Promise<void> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const now = new Date();

			// Ensure user exists
			await collections.users.updateOne(
				{ discordId: userId },
				{
					$setOnInsert: {
						discordId: userId,
						avatarHistory: [],
						statusHistory: [],
						modPreferences: {
							bannedUsers: [],
							mutedUsers: [],
							kickedUsers: [],
							deafenedUsers: [],
							renamedUsers: [],
							lastUpdated: now,
						},
						createdAt: now,
						updatedAt: now,
					},
				},
				{ upsert: true },
			);

			// Try to update existing status first (more efficient than separate check)
			const updateResult = await collections.users.updateOne(
				{
					discordId: userId,
					"statusHistory.status": newStatus,
				},
				{
					$set: {
						"statusHistory.$.lastSeen": now,
						status: newStatus,
						updatedAt: now,
					},
				},
			);

			// If no existing status was updated, add new one
			if (updateResult.matchedCount === 0) {
				// Add new status to history
				const newStatusEntry: UserStatus = {
					status: newStatus,
					firstSeen: now,
					lastSeen: now,
				};

				await collections.users.updateOne(
					{ discordId: userId },
					{
						$push: { statusHistory: newStatusEntry },
						$set: {
							status: newStatus,
							updatedAt: now,
						},
					},
				);
			}
		}, `trackStatusChange(${userId})`);
	}

	/**
	 * Get avatar history for a user
	 */
	async getAvatarHistory(userId: string): Promise<AvatarHistory[]> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const user = await collections.users.findOne({
				discordId: userId,
			});

			return user?.avatarHistory || [];
		}, `getAvatarHistory(${userId})`);
	}

	/**
	 * Get status history for a user
	 */
	async getStatusHistory(userId: string): Promise<UserStatus[]> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const user = await collections.users.findOne({
				discordId: userId,
			});

			return user?.statusHistory || [];
		}, `getStatusHistory(${userId})`);
	}

	/**
	 * Get current status for a user
	 */
	async getCurrentStatus(userId: string): Promise<string | null> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const user = await collections.users.findOne({
				discordId: userId,
			});

			return user?.status || null;
		}, `getCurrentStatus(${userId})`);
	}

	/**
	 * Clean up old avatar and status history (keep only last 50 entries each)
	 */
	async cleanupUserHistory(
		userId: string,
	): Promise<{ avatarsRemoved: number; statusesRemoved: number }> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const now = new Date();

			// Get current user data
			const user = await collections.users.findOne({
				discordId: userId,
			});

			if (!user) {
				return { avatarsRemoved: 0, statusesRemoved: 0 };
			}

			let avatarsRemoved = 0;
			let statusesRemoved = 0;

			// Clean up avatar history (keep last 50)
			if (user.avatarHistory && user.avatarHistory.length > 50) {
				const avatarsToKeep = user.avatarHistory
					.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
					.slice(0, 50);

				const avatarsToRemove = user.avatarHistory.slice(50);

				// Note: No need to delete local files since images are stored in DB

				avatarsRemoved = user.avatarHistory.length - avatarsToKeep.length;

				await collections.users.updateOne(
					{ discordId: userId },
					{
						$set: {
							avatarHistory: avatarsToKeep,
							updatedAt: now,
						},
					},
				);
			}

			// Clean up status history (keep last 50)
			if (user.statusHistory && user.statusHistory.length > 50) {
				const statusesToKeep = user.statusHistory
					.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
					.slice(0, 50);

				statusesRemoved = user.statusHistory.length - statusesToKeep.length;

				await collections.users.updateOne(
					{ discordId: userId },
					{
						$set: {
							statusHistory: statusesToKeep,
							updatedAt: now,
						},
					},
				);
			}

			return { avatarsRemoved, statusesRemoved };
		}, `cleanupUserHistory(${userId})`);
	}

	/**
	 * Get avatar image as base64 for embedding
	 */
	async getAvatarAsBase64(
		userId: string,
		avatarIndex = 0,
	): Promise<string | null> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();
			const user = await collections.users.findOne({
				discordId: userId,
			});

			if (!user?.avatarHistory || user.avatarHistory.length === 0) {
				return null;
			}

			const avatar = user.avatarHistory[avatarIndex];
			if (!avatar?.imageData) {
				return null;
			}

			return avatar.imageData;
		}, `getAvatarAsBase64(${userId}, ${avatarIndex})`);
	}

	/**
	 * Get storage statistics
	 */
	async getStorageStats(): Promise<{
		totalImages: number;
		totalSize: number;
		averageSize: number;
	}> {
		return this.withPerformanceTracking(async () => {
			const collections = this.getCollections();

			// Count total avatars with local paths
			const usersWithAvatars = await collections.users
				.find({
					"avatarHistory.imageData": { $exists: true },
				})
				.toArray();

			let totalImages = 0;
			let totalSize = 0;

			for (const user of usersWithAvatars) {
				for (const avatar of user.avatarHistory) {
					if (avatar.imageData && avatar.fileSize) {
						totalImages++;
						totalSize += avatar.fileSize;
					}
				}
			}

			return {
				totalImages,
				totalSize,
				averageSize: totalImages > 0 ? Math.round(totalSize / totalImages) : 0,
			};
		}, "getStorageStats()");
	}

	/**
	 * Clean up orphaned image files (files not referenced in database)
	 */
	async cleanupOrphanedImages(): Promise<{
		orphanedFiles: number;
		freedSpace: number;
	}> {
		return this.withPerformanceTracking(async () => {
			// Since images are stored in DB, no orphaned files to clean up
			return { orphanedFiles: 0, freedSpace: 0 };
		}, "cleanupOrphanedImages()");
	}

	// ==================== VOICE SESSION CLEANUP ====================

	async cleanupStaleVoiceSessions(): Promise<{
		cleaned: number;
		errors: string[];
	}> {
		const errors: string[] = [];
		let cleaned = 0;

		try {
			const collections = this.getCollections();

			// Find and remove duplicate active sessions (multiple sessions for same user without leftAt)
			const duplicateSessions = await collections.voiceSessions
				.aggregate([
					{
						$match: {
							$or: [
								{ leftAt: { $exists: false } },
								{ leftAt: { $type: "null" } },
							],
						},
					},
					{
						$group: {
							_id: {
								userId: "$userId",
								guildId: "$guildId",
								channelId: "$channelId",
							},
							sessions: { $push: "$$ROOT" },
							count: { $sum: 1 },
						},
					},
					{
						$match: { count: { $gt: 1 } },
					},
				])
				.toArray();

			// Keep only the most recent session for each user/channel combination
			for (const duplicate of duplicateSessions) {
				const sessions = duplicate.sessions.sort(
					(a: VoiceSession, b: VoiceSession) =>
						new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime(),
				);

				// Keep the first (most recent) session, delete the rest
				const toDelete = sessions.slice(1);

				for (const session of toDelete) {
					try {
						await collections.voiceSessions.deleteOne({ _id: session._id });
						cleaned++;
					} catch (error) {
						errors.push(
							`Failed to delete duplicate session ${session._id}: ${error}`,
						);
					}
				}
			}

			// Clean up very old sessions (older than 7 days) that are still marked as active
			const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
			const oldActiveSessions = await collections.voiceSessions
				.find({
					joinedAt: { $lt: sevenDaysAgo },
					$or: [{ leftAt: { $exists: false } }, { leftAt: { $type: "null" } }],
				})
				.toArray();

			for (const session of oldActiveSessions) {
				try {
					// Mark as left with the join time + 1 hour as a reasonable estimate
					const estimatedLeftAt = new Date(
						session.joinedAt.getTime() + 60 * 60 * 1000,
					);
					await collections.voiceSessions.updateOne(
						{ _id: session._id },
						{
							$set: {
								leftAt: estimatedLeftAt,
								duration: 3600, // 1 hour
								updatedAt: new Date(),
							},
						},
					);
					cleaned++;
				} catch (error) {
					errors.push(`Failed to cleanup old session ${session._id}: ${error}`);
				}
			}

			console.log(
				`🔧 Voice session cleanup completed: ${cleaned} sessions cleaned, ${errors.length} errors`,
			);
		} catch (error) {
			errors.push(`Voice session cleanup failed: ${error}`);
			console.error("🔸 Error during voice session cleanup:", error);
		}

		return { cleaned, errors };
	}

	// ==================== MAINTENANCE ====================

	async wipeDatabase(): Promise<void> {
		const collections = this.getCollections();

		// Drop all collections
		await Promise.all([
			collections.users
				.drop()
				.catch(() => {}), // Ignore if collection doesn't exist
			collections.roles.drop().catch(() => {}),
			collections.messages.drop().catch(() => {}),
			collections.voiceSessions.drop().catch(() => {}),
			collections.guildSyncs.drop().catch(() => {}),
		]);

		// Recreate indexes
		await this.createIndexes();
	}
}
