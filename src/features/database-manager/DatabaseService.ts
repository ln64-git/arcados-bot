import type { TextChannel } from "discord.js";
import type { Db } from "mongodb";
import type {
	DatabaseCollections,
	GuildSync,
	Message,
	Role,
	User,
	UserInteraction,
	VoiceSession,
} from "../../types/database";
import { getDatabase } from "../../utils/database";

export class DatabaseService {
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

	getCollections(): DatabaseCollections {
		if (!this.collections) {
			throw new Error("Database not initialized. Call initialize() first.");
		}
		return this.collections;
	}

	// User operations
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

	async getUser(discordId: string, guildId: string): Promise<User | null> {
		const collections = this.getCollections();
		return await collections.users.findOne({ discordId, guildId });
	}

	async getUsersByGuild(guildId: string): Promise<User[]> {
		const collections = this.getCollections();
		return await collections.users.find({ guildId }).toArray();
	}

	// Role operations
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

	async getRolesByGuild(guildId: string): Promise<Role[]> {
		const collections = this.getCollections();
		return await collections.roles.find({ guildId }).toArray();
	}

	// Message operations
	async upsertMessage(
		message: Omit<Message, "_id" | "createdAt" | "updatedAt">,
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

	async getMessagesByGuild(
		guildId: string,
		limit: number = 100,
	): Promise<Message[]> {
		const collections = this.getCollections();
		return await collections.messages
			.find({ guildId })
			.sort({ timestamp: -1 })
			.limit(limit)
			.toArray();
	}

	async getMessagesByChannel(
		guildId: string,
		channelName: string,
		limit: number = 100,
	): Promise<Message[]> {
		const collections = this.getCollections();
		return await collections.messages
			.find({ guildId, channelId: channelName })
			.sort({ timestamp: -1 })
			.limit(limit)
			.toArray();
	}

	async getLastMessageId(guildId: string): Promise<string | null> {
		const collections = this.getCollections();
		const lastMessage = await collections.messages.findOne(
			{ guildId },
			{ sort: { timestamp: -1 } },
		);
		return lastMessage?.discordId || null;
	}

	async getOldestMessages(
		guildId: string,
		limit: number = 10,
	): Promise<Message[]> {
		const collections = this.getCollections();
		return await collections.messages
			.find({ guildId })
			.sort({ timestamp: 1 }) // Sort by timestamp ascending for oldest
			.limit(limit)
			.toArray();
	}

	async getOldestMessagesWithUsers(
		guildId: string,
		limit: number = 20,
	): Promise<
		{
			message: Message;
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
			messages.map(async (message: Message) => {
				const user = await collections.users.findOne({
					discordId: message.authorId,
					guildId: message.guildId,
				});
				return { message, user };
			}),
		);

		return result;
	}

	async getRecentMessagesWithUsers(
		guildId: string,
		limit: number = 20,
	): Promise<
		{
			message: Message;
			user: User | null;
		}[]
	> {
		const collections = this.getCollections();

		// Get most recent messages
		const messages = await collections.messages
			.find({ guildId })
			.sort({ timestamp: -1 }) // Sort by timestamp descending for most recent
			.limit(limit)
			.toArray();

		// Get user data for each message author
		const result = await Promise.all(
			messages.map(async (message: Message) => {
				const user = await collections.users.findOne({
					discordId: message.authorId,
					guildId: message.guildId,
				});
				return { message, user };
			}),
		);

		return result;
	}

	// Batch insert messages for better performance
	async batchInsertMessages(
		messages: Omit<Message, "_id" | "createdAt" | "updatedAt">[],
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		const documents = messages.map((message) => ({
			...message,
			createdAt: now,
			updatedAt: now,
		}));

		await collections.messages.insertMany(documents, { ordered: false });
	}

	// Voice session operations
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

		const session = await collections.voiceSessions.findOne({
			userId,
			guildId,
			leftAt: { $exists: false },
		});

		if (session) {
			const duration = Math.floor(
				(leftAt.getTime() - session.joinedAt.getTime()) / 1000,
			);
			await collections.voiceSessions.updateOne(
				{ _id: session._id },
				{
					$set: {
						leftAt,
						duration,
						updatedAt: now,
					},
				},
			);
		}
	}

	async getVoiceSessionsByUser(
		userId: string,
		guildId: string,
	): Promise<VoiceSession[]> {
		const collections = this.getCollections();
		return await collections.voiceSessions
			.find({ userId, guildId })
			.sort({ joinedAt: -1 })
			.toArray();
	}

	async getVoiceSessionsByGuild(guildId: string): Promise<VoiceSession[]> {
		const collections = this.getCollections();
		return await collections.voiceSessions
			.find({ guildId })
			.sort({ joinedAt: -1 })
			.toArray();
	}

	// Guild sync operations
	async getGuildSync(guildId: string): Promise<GuildSync | null> {
		const collections = this.getCollections();
		return await collections.guildSyncs.findOne({ guildId });
	}

	async updateGuildSync(
		sync: Omit<GuildSync, "_id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		const collections = this.getCollections();
		const now = new Date();

		await collections.guildSyncs.updateOne(
			{ guildId: sync.guildId },
			{
				$set: {
					...sync,
					updatedAt: now,
				},
				$setOnInsert: {
					createdAt: now,
				},
			},
			{ upsert: true },
		);
	}

	// User interaction operations
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
		const collections = this.getCollections();
		return await collections.userInteractions
			.find({ fromUserId, toUserId, guildId })
			.sort({ timestamp: -1 })
			.toArray();
	}

	// Statistics
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

	/**
	 * Sync Sapphire VC logs with database
	 * Simple function to import legacy VC data from Sapphire bot messages
	 */
	async syncSapphireVCLogs(): Promise<{
		success: boolean;
		sessionsCreated: number;
		errors: string[];
	}> {
		const { Client, GatewayIntentBits } = await import("discord.js");
		const { config } = await import("../../config");

		const client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
			],
		});

		const errors: string[] = [];
		let sessionsCreated = 0;

		try {
			console.log("🔹 Connecting to Discord to sync Sapphire VC logs...");
			await client.login(config.botToken);

			// Wait for guilds to load
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Get the guild
			let guild = client.guilds.cache.get(config.guildId || "");
			if (!guild) {
				guild = client.guilds.cache.find((g) => g.name === "Arcados");
				if (!guild) {
					guild = client.guilds.cache.first();
				}
			}

			if (!guild) {
				throw new Error("No guild found");
			}

			console.log(`🔹 Found guild: ${guild.name}`);

			// Find vc-logs channel
			const vcLogsChannel = guild.channels.cache.find(
				(channel) =>
					channel.isTextBased() &&
					channel.name.toLowerCase().includes("vc") &&
					channel.name.toLowerCase().includes("log"),
			) as TextChannel; // Type assertion for text channel

			if (!vcLogsChannel) {
				throw new Error("vc-logs channel not found");
			}

			console.log(`🔹 Found vc-logs channel: ${vcLogsChannel.name}`);

			// Fetch messages in batches
			const messages = new Map<string, import("discord.js").Message>();
			let lastMessageId: string | undefined;
			let totalFetched = 0;
			const maxMessages = 5000; // Increased limit for more historical data

			while (totalFetched < maxMessages) {
				const batchSize = Math.min(100, maxMessages - totalFetched);
				const batch = await vcLogsChannel.messages.fetch({
					limit: batchSize,
					before: lastMessageId,
				});

				if (batch.size === 0) break;

				batch.forEach((msg, id) => {
					messages.set(id, msg);
				});
				totalFetched += batch.size;
				lastMessageId = batch.last()?.id;

				console.log(`🔹 Fetched ${totalFetched} messages...`);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			console.log(`🔹 Found ${messages.size} messages in vc-logs channel`);

			// Process Sapphire bot messages
			const sapphireMessages = Array.from(messages.values()).filter(
				(msg: import("discord.js").Message) =>
					msg.author.bot &&
					msg.author.id === "1254709276715388958" && // Sapphire bot ID
					msg.embeds.length > 0,
			);

			console.log(
				`🔹 Found ${sapphireMessages.length} Sapphire bot messages with embeds`,
			);

			const vcEvents: Array<{
				type: "joined" | "left";
				user: string;
				userId: string;
				channelId: string;
				channelName: string;
				userCount: number;
				timestamp: Date;
				guildId: string;
			}> = [];
			const channelIds = new Set<string>();

			// Parse all embeds
			for (const message of sapphireMessages) {
				for (const embed of message.embeds) {
					const event = this.parseSapphireEmbed(
						embed,
						message.createdAt,
						guild.id,
					);
					if (event) {
						vcEvents.push(event);
						channelIds.add(event.channelId);
					}
				}
			}

			console.log(`🔹 Parsed ${vcEvents.length} VC events`);

			// Fetch channel names
			const channelNames = new Map<string, string>();
			for (const channelId of channelIds) {
				const channel = guild.channels.cache.get(channelId);
				if (channel) {
					channelNames.set(channelId, channel.name);
				}
			}

			// Update events with channel names
			vcEvents.forEach((event) => {
				const channelName = channelNames.get(event.channelId);
				if (channelName) {
					event.channelName = channelName;
				}
			});

			// Create voice sessions from events
			vcEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

			const activeSessions = new Map<
				string,
				{
					userId: string;
					channelId: string;
					channelName: string;
					joinedAt: Date;
				}
			>();

			for (const event of vcEvents) {
				// Skip tracking for bots - check if user is a bot
				try {
					const user = await guild.members.fetch(event.userId);
					if (user.user.bot) {
						continue; // Skip this event if it's a bot
					}
				} catch {
					// If we can't fetch the user, skip this event to be safe
					continue;
				}

				// Skip tracking for AFK channels
				if (this.isAFKChannel(event.channelName, event.channelId)) {
					continue;
				}

				const sessionKey = `${event.userId}-${event.channelId}`;

				if (event.type === "joined") {
					const session = {
						userId: event.userId,
						channelId: event.channelId,
						channelName: event.channelName,
						joinedAt: event.timestamp,
					};
					activeSessions.set(sessionKey, session);
				} else if (event.type === "left") {
					const session = activeSessions.get(sessionKey);
					if (session) {
						const leftAt = event.timestamp;
						const duration = Math.floor(
							(leftAt.getTime() - session.joinedAt.getTime()) / 1000,
						);

						// Skip sessions longer than 12 hours (likely corrupted data)
						if (duration > 43200) {
							console.log(
								`🔸 Skipping corrupted session: ${event.user} in ${event.channelName} (${Math.round(duration / 3600)} hours)`,
							);
							activeSessions.delete(sessionKey);
							continue;
						}

						const completedSession = {
							...session,
							guildId: guild.id,
							channelName: session.channelName || "Unknown Channel",
							leftAt,
							duration,
							updatedAt: new Date(),
						};

						try {
							await this.createVoiceSession(completedSession);
							sessionsCreated++;
						} catch (error) {
							errors.push(
								`Failed to create session for ${event.user}: ${error}`,
							);
						}

						activeSessions.delete(sessionKey);
					}
				}
			}

			// Close remaining active sessions
			for (const [, session] of activeSessions) {
				const now = new Date();
				const duration = Math.floor(
					(now.getTime() - session.joinedAt.getTime()) / 1000,
				);

				// Skip sessions longer than 12 hours (likely corrupted data)
				if (duration > 43200) {
					console.log(
						`🔸 Skipping corrupted active session: ${session.userId} in ${session.channelName} (${Math.round(duration / 3600)} hours)`,
					);
					continue;
				}

				const completedSession = {
					...session,
					guildId: guild.id,
					channelName: session.channelName || "Unknown Channel",
					leftAt: now,
					duration,
					updatedAt: now,
				};

				try {
					await this.createVoiceSession(completedSession);
					sessionsCreated++;
				} catch (error) {
					errors.push(
						`Failed to close session for ${session.userId}: ${error}`,
					);
				}
			}

			console.log(
				`🔹 Created ${sessionsCreated} voice sessions from Sapphire bot data`,
			);
		} catch (error) {
			console.error("🔸 Error syncing Sapphire VC logs:", error);
			errors.push(`Sync failed: ${error}`);
		} finally {
			await client.destroy();
		}

		return {
			success: errors.length === 0,
			sessionsCreated,
			errors,
		};
	}

	/**
	 * Parse a Sapphire embed to extract VC event data
	 */
	private parseSapphireEmbed(
		embed: import("discord.js").Embed,
		timestamp: Date,
		guildId: string,
	): {
		type: "joined" | "left";
		user: string;
		userId: string;
		channelId: string;
		channelName: string;
		userCount: number;
		timestamp: Date;
		guildId: string;
	} | null {
		try {
			if (
				!embed.title ||
				(!embed.title.includes("User joined channel") &&
					!embed.title.includes("User left channel"))
			) {
				return null;
			}

			const type = embed.title.includes("joined") ? "joined" : "left";
			const description = embed.description || "";

			const userMatch = description.match(
				/\*\*User:\*\*\s*@?([^<]+)\s*\(<@(\d+)>\)/,
			);
			const channelMatch = description.match(/\*\*Channel:\*\*\s*<#(\d+)>/);
			const usersMatch = description.match(/\*\*Users:\*\*\s*(\d+)/);

			if (!userMatch || !channelMatch || !usersMatch) {
				return null;
			}

			const user = userMatch[1].trim();
			const userId = userMatch[2].trim();
			const channelId = channelMatch[1].trim();
			const userCount = parseInt(usersMatch[1], 10);

			return {
				type,
				user,
				userId,
				channelId,
				channelName: `Channel ${channelId}`, // Will be updated with real name
				userCount,
				timestamp,
				guildId,
			};
		} catch (error) {
			console.error("🔸 Error parsing Sapphire embed:", error);
			return null;
		}
	}

	private isAFKChannel(channelName: string, channelId: string): boolean {
		const name = (channelName || "").toLowerCase();
		return (
			name.includes("afk") ||
			name.includes("away") ||
			name.includes("idle") ||
			channelId === "1357869633155371019"
		); // Known AFK channel ID
	}

	async close(): Promise<void> {
		if (this.db) {
			await this.db.client.close();
			this.db = null;
			this.collections = null;
		}
	}
}
