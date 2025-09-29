import type {
	CallState,
	CoupSession,
	RateLimit,
	UserModerationPreferences,
	VoiceChannelConfig,
	VoiceChannelOwner,
} from "../types";
import { getDatabase } from "./database";
import { getRedisClient, RedisCache } from "./redis";

export class HybridCacheManager {
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
			console.log("🔹 Hybrid cache manager initialized with Redis");
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
				console.log("🔹 Redis cache flushed");
			} catch (error) {
				console.warn(`🔸 Failed to flush Redis cache: ${error}`);
			}
		}
	}
}

// Singleton instance
let cacheManager: HybridCacheManager | null = null;

export function getCacheManager(): HybridCacheManager {
	if (!cacheManager) {
		cacheManager = new HybridCacheManager();
	}
	return cacheManager;
}
