import type {
	CallState,
	CoupSession,
	RateLimit,
	RollData,
	StarboardEntry,
	UserModerationPreferences,
	UserRoleData,
	VoiceChannelConfig,
	VoiceChannelOwner,
} from "../../types";
import { getDatabase } from "../database-manager/DatabaseConnection";
import { getRedisClient, RedisCache } from "./RedisManager";

export class DiscordDataCache {
	private redisCache: RedisCache | null = null;
	private redisAvailable = false;

	constructor() {
		this.initializeRedis();
	}

	private async initializeRedis() {
		try {
			const redisClient = await getRedisClient();
			this.redisCache = new RedisCache(redisClient);
			this.redisAvailable = true;
			// console.log("🔹 Discord data cache initialized with Redis");
		} catch (error) {
			console.warn(`🔸 Redis not available, using MongoDB fallback: ${error}`);
			this.redisAvailable = false;
		}
	}

	// Channel Ownership Methods
	async getChannelOwner(channelId: string): Promise<VoiceChannelOwner | null> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			const cached = await this.redisCache.getChannelOwner(channelId);
			if (cached) {
				return cached as VoiceChannelOwner;
			}
		}

		// Fallback to MongoDB
		try {
			const db = await getDatabase();
			const owner = await db.collection("channelOwners").findOne({ channelId });
			if (owner) {
				const typedOwner = owner as unknown as VoiceChannelOwner;

				// Cache in Redis for next time
				if (this.redisAvailable && this.redisCache) {
					await this.redisCache.setChannelOwner(channelId, typedOwner);
				}

				return typedOwner;
			}
		} catch (error) {
			console.warn(`🔸 Failed to fetch channel owner from database: ${error}`);
		}

		return null;
	}

	async setChannelOwner(
		channelId: string,
		owner: VoiceChannelOwner,
	): Promise<void> {
		// Update Redis first for immediate availability
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.setChannelOwner(channelId, owner);
		}

		// Persist to MongoDB
		try {
			const db = await getDatabase();
			await db
				.collection("channelOwners")
				.replaceOne({ channelId }, owner, { upsert: true });
		} catch (error) {
			console.warn(`🔸 Failed to persist channel owner to database: ${error}`);
		}
	}

	async removeChannelOwner(channelId: string): Promise<void> {
		// Remove from Redis first
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.delChannelOwner(channelId);
		}

		// Remove from MongoDB
		try {
			const db = await getDatabase();
			await db.collection("channelOwners").deleteOne({ channelId });
		} catch (error) {
			console.warn(`🔸 Failed to remove channel owner from database: ${error}`);
		}
	}

	// User Preferences Methods
	async getUserPreferences(
		userId: string,
		guildId: string,
	): Promise<UserModerationPreferences | null> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			const cached = await this.redisCache.getUserPreferences(userId, guildId);
			if (cached) {
				return cached as UserModerationPreferences;
			}
		}

		// Fallback to MongoDB
		try {
			const db = await getDatabase();
			const preferences = await db.collection("userPreferences").findOne({
				userId,
				guildId,
			});
			if (preferences) {
				const typedPreferences =
					preferences as unknown as UserModerationPreferences;

				// Cache in Redis for next time
				if (this.redisAvailable && this.redisCache) {
					await this.redisCache.setUserPreferences(
						userId,
						guildId,
						typedPreferences,
					);
				}

				return typedPreferences;
			}
		} catch (error) {
			console.warn(
				`🔸 Failed to fetch user preferences from database: ${error}`,
			);
		}

		return null;
	}

	async setUserPreferences(
		preferences: UserModerationPreferences,
	): Promise<void> {
		// Update Redis first for immediate availability
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.setUserPreferences(
				preferences.userId,
				preferences.guildId,
				preferences,
			);
		}

		// Persist to MongoDB
		try {
			const db = await getDatabase();
			await db
				.collection("userPreferences")
				.replaceOne(
					{ userId: preferences.userId, guildId: preferences.guildId },
					preferences,
					{ upsert: true },
				);
		} catch (error) {
			console.warn(
				`🔸 Failed to persist user preferences to database: ${error}`,
			);
		}
	}

	// Guild Config Methods
	async getGuildConfig(guildId: string): Promise<VoiceChannelConfig | null> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			const cached = await this.redisCache.getGuildConfig(guildId);
			if (cached) {
				return cached as VoiceChannelConfig;
			}
		}

		// Fallback to MongoDB
		try {
			const db = await getDatabase();
			const config = await db.collection("guildConfigs").findOne({ guildId });
			if (config) {
				const typedConfig = config as unknown as VoiceChannelConfig;

				// Cache in Redis for next time
				if (this.redisAvailable && this.redisCache) {
					await this.redisCache.setGuildConfig(guildId, typedConfig);
				}

				return typedConfig;
			}
		} catch (error) {
			console.warn(`🔸 Failed to fetch guild config from database: ${error}`);
		}

		return null;
	}

	async setGuildConfig(
		guildId: string,
		config: VoiceChannelConfig,
	): Promise<void> {
		// Update Redis first for immediate availability
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.setGuildConfig(guildId, config);
		}

		// Persist to MongoDB
		try {
			const db = await getDatabase();
			await db
				.collection("guildConfigs")
				.replaceOne({ guildId }, config, { upsert: true });
		} catch (error) {
			console.warn(`🔸 Failed to persist guild config to database: ${error}`);
		}
	}

	// Call State Methods
	async getCallState(channelId: string): Promise<CallState | null> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			const cached = await this.redisCache.getCallState(channelId);
			if (cached) {
				return cached as CallState;
			}
		}

		return null;
	}

	async setCallState(channelId: string, state: CallState): Promise<void> {
		// Update Redis (call states are temporary, no MongoDB persistence needed)
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.setCallState(channelId, state, 1800); // 30 minutes TTL
		}
	}

	// Coup Session Methods
	async getCoupSession(channelId: string): Promise<CoupSession | null> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			const cached = await this.redisCache.getCoupSession(channelId);
			if (cached) {
				return cached as CoupSession;
			}
		}

		return null;
	}

	async setCoupSession(channelId: string, session: CoupSession): Promise<void> {
		// Update Redis (coup sessions are temporary, no MongoDB persistence needed)
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.setCoupSession(channelId, session, 300); // 5 minutes TTL
		}
	}

	async removeCoupSession(channelId: string): Promise<void> {
		// Remove from Redis
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.delCoupSession(channelId);
		}
	}

	// Rate Limit Methods
	async getRateLimit(
		userId: string,
		action: string,
	): Promise<RateLimit | null> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			const cached = await this.redisCache.getRateLimit(userId, action);
			if (cached) {
				return cached as RateLimit;
			}
		}

		return null;
	}

	async setRateLimit(
		userId: string,
		action: string,
		limit: RateLimit,
		ttl: number = 60,
	): Promise<void> {
		// Update Redis (rate limits are temporary, no MongoDB persistence needed)
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.setRateLimit(userId, action, limit, ttl);
		}
	}

	// Utility methods
	isRedisAvailable(): boolean {
		return this.redisAvailable;
	}

	async flushAll(): Promise<void> {
		if (this.redisAvailable && this.redisCache) {
			try {
				const redisClient = await getRedisClient();
				await redisClient.flushAll();
			} catch (error) {
				console.warn(`🔸 Failed to flush Redis cache: ${error}`);
			}
		}
	}

	// User Role Data Methods
	async setUserRoleData(
		userId: string,
		guildId: string,
		userRoleData: UserRoleData,
	): Promise<void> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			try {
				await this.redisCache.setUserRoleData(userId, guildId, userRoleData);
			} catch (error) {
				console.warn(`🔸 Failed to cache user role data in Redis: ${error}`);
			}
		}

		// Always store in MongoDB as fallback
		try {
			const db = await getDatabase();
			await db
				.collection("userRoleData")
				.replaceOne({ userId, guildId }, userRoleData, { upsert: true });
		} catch (error) {
			console.error(`🔸 Failed to store user role data in MongoDB: ${error}`);
		}
	}

	async getUserRoleData(
		userId: string,
		guildId: string,
	): Promise<UserRoleData | null> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			try {
				const cached = await this.redisCache.getUserRoleData(userId, guildId);
				if (cached) {
					return cached as UserRoleData;
				}
			} catch (error) {
				console.warn(`🔸 Failed to get user role data from Redis: ${error}`);
			}
		}

		// Fallback to MongoDB
		try {
			const db = await getDatabase();
			const userRoleData = await db
				.collection("userRoleData")
				.findOne({ userId, guildId });
			if (userRoleData) {
				const typedData = userRoleData as unknown as UserRoleData;

				// Cache in Redis for next time
				if (this.redisAvailable && this.redisCache) {
					try {
						await this.redisCache.setUserRoleData(userId, guildId, typedData);
					} catch (error) {
						console.warn(
							`🔸 Failed to cache user role data in Redis: ${error}`,
						);
					}
				}

				return typedData;
			}
		} catch (error) {
			console.error(`🔸 Failed to get user role data from MongoDB: ${error}`);
		}

		return null;
	}

	async deleteUserRoleData(userId: string, guildId: string): Promise<void> {
		// Delete from Redis
		if (this.redisAvailable && this.redisCache) {
			try {
				await this.redisCache.deleteUserRoleData(userId, guildId);
			} catch (error) {
				console.warn(`🔸 Failed to delete user role data from Redis: ${error}`);
			}
		}

		// Delete from MongoDB
		try {
			const db = await getDatabase();
			await db.collection("userRoleData").deleteOne({ userId, guildId });
		} catch (error) {
			console.error(
				`🔸 Failed to delete user role data from MongoDB: ${error}`,
			);
		}
	}

	async getAllUserRoleData(guildId: string): Promise<UserRoleData[]> {
		try {
			const db = await getDatabase();
			const userRoleData = await db
				.collection("userRoleData")
				.find({ guildId })
				.toArray();
			return userRoleData as unknown as UserRoleData[];
		} catch (error) {
			console.error(
				`🔸 Failed to get all user role data for guild ${guildId}: ${error}`,
			);
			return [];
		}
	}

	// Starboard Entry Methods
	async setStarboardEntry(entry: StarboardEntry): Promise<void> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			try {
				await this.redisCache.setStarboardEntry(entry);
			} catch (error) {
				console.warn(`🔸 Failed to cache starboard entry in Redis: ${error}`);
			}
		}

		// Always store in MongoDB as fallback
		try {
			const db = await getDatabase();
			await db.collection("starboardEntries").replaceOne(
				{
					originalMessageId: entry.originalMessageId,
					guildId: entry.guildId,
				},
				entry,
				{ upsert: true },
			);
		} catch (error) {
			console.error(`🔸 Failed to store starboard entry in MongoDB: ${error}`);
		}
	}

	async getStarboardEntry(
		messageId: string,
		guildId: string,
	): Promise<StarboardEntry | null> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			try {
				const cached = await this.redisCache.getStarboardEntry(
					messageId,
					guildId,
				);
				if (cached) {
					return cached as StarboardEntry;
				}
			} catch (error) {
				console.warn(`🔸 Failed to get starboard entry from Redis: ${error}`);
			}
		}

		// Fallback to MongoDB
		try {
			const db = await getDatabase();
			const entry = await db
				.collection("starboardEntries")
				.findOne({ originalMessageId: messageId, guildId });
			if (entry) {
				const typedEntry = entry as unknown as StarboardEntry;

				// Cache in Redis for next time
				if (this.redisAvailable && this.redisCache) {
					try {
						await this.redisCache.setStarboardEntry(typedEntry);
					} catch (error) {
						console.warn(
							`🔸 Failed to cache starboard entry in Redis: ${error}`,
						);
					}
				}

				return typedEntry;
			}
		} catch (error) {
			console.error(`🔸 Failed to get starboard entry from MongoDB: ${error}`);
		}

		return null;
	}

	async deleteStarboardEntry(
		messageId: string,
		guildId: string,
	): Promise<void> {
		// Delete from Redis
		if (this.redisAvailable && this.redisCache) {
			try {
				await this.redisCache.deleteStarboardEntry(messageId, guildId);
			} catch (error) {
				console.warn(
					`🔸 Failed to delete starboard entry from Redis: ${error}`,
				);
			}
		}

		// Delete from MongoDB
		try {
			const db = await getDatabase();
			await db
				.collection("starboardEntries")
				.deleteOne({ originalMessageId: messageId, guildId });
		} catch (error) {
			console.error(
				`🔸 Failed to delete starboard entry from MongoDB: ${error}`,
			);
		}
	}

	async getAllStarboardEntries(guildId: string): Promise<StarboardEntry[]> {
		try {
			const db = await getDatabase();
			const entries = await db
				.collection("starboardEntries")
				.find({ guildId })
				.sort({ createdAt: -1 })
				.toArray();
			return entries as unknown as StarboardEntry[];
		} catch (error) {
			console.error(
				`🔸 Failed to get all starboard entries for guild ${guildId}: ${error}`,
			);
			return [];
		}
	}

	// Roll Data Methods
	async setRollData(
		userId: string,
		guildId: string,
		rollData: RollData,
	): Promise<void> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			try {
				await this.redisCache.setRollData(userId, guildId, rollData);
			} catch (error) {
				console.warn(`🔸 Failed to cache roll data in Redis: ${error}`);
			}
		}

		// Always store in MongoDB as fallback
		try {
			const db = await getDatabase();
			await db
				.collection("rollData")
				.replaceOne({ userId, guildId }, rollData, { upsert: true });
		} catch (error) {
			console.error(`🔸 Failed to store roll data in MongoDB: ${error}`);
		}
	}

	async getRollData(userId: string, guildId: string): Promise<RollData | null> {
		// Try Redis first
		if (this.redisAvailable && this.redisCache) {
			try {
				const cached = await this.redisCache.getRollData(userId, guildId);
				if (cached) {
					return cached as RollData;
				}
			} catch (error) {
				console.warn(`🔸 Failed to get roll data from Redis: ${error}`);
			}
		}

		// Fallback to MongoDB
		try {
			const db = await getDatabase();
			const rollData = await db
				.collection("rollData")
				.findOne({ userId, guildId });
			if (rollData) {
				const typedData = rollData as unknown as RollData;

				// Cache in Redis for next time
				if (this.redisAvailable && this.redisCache) {
					try {
						await this.redisCache.setRollData(userId, guildId, typedData);
					} catch (error) {
						console.warn(`🔸 Failed to cache roll data in Redis: ${error}`);
					}
				}

				return typedData;
			}
		} catch (error) {
			console.error(`🔸 Failed to get roll data from MongoDB: ${error}`);
		}

		return null;
	}

	async deleteRollData(userId: string, guildId: string): Promise<void> {
		// Delete from Redis
		if (this.redisAvailable && this.redisCache) {
			try {
				await this.redisCache.deleteRollData(userId, guildId);
			} catch (error) {
				console.warn(`🔸 Failed to delete roll data from Redis: ${error}`);
			}
		}

		// Delete from MongoDB
		try {
			const db = await getDatabase();
			await db.collection("rollData").deleteOne({ userId, guildId });
		} catch (error) {
			console.error(`🔸 Failed to delete roll data from MongoDB: ${error}`);
		}
	}
}

// Singleton instance
let cacheManager: DiscordDataCache | null = null;

export function getCacheManager(): DiscordDataCache {
	if (!cacheManager) {
		cacheManager = new DiscordDataCache();
	}
	return cacheManager;
}
