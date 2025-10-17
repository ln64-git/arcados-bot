import type {
	CallState,
	CoupSession,
	RateLimit,
	RollData,
	StarboardEntry,
	UserModerationPreferences,
	VoiceChannelConfig,
	VoiceChannelOwner,
} from "../../types";
import { SurrealCore } from "../database-manager/SurrealCore";
import { RedisCache, getRedisClient } from "./RedisManager";

export class DiscordDataCache {
	private redisCache: RedisCache | null = null;
	private redisAvailable = false;
	private initializationPromise: Promise<void> | null = null;

	constructor() {
		this.initializationPromise = this.initializeRedis();
	}

	private async initializeRedis() {
		try {
			const redisClient = await getRedisClient();
			this.redisCache = new RedisCache(redisClient);
			this.redisAvailable = true;
			console.log("🔹 Discord data cache initialized with Redis");
		} catch (error) {
			console.warn(`🔸 Redis not available, using fallback: ${error}`);
			this.redisAvailable = false;
		}
	}

	// Ensure Redis is initialized before operations
	private async ensureInitialized(): Promise<void> {
		if (this.initializationPromise) {
			await this.initializationPromise;
			this.initializationPromise = null;
		}
	}

	// Channel Ownership Methods (Redis only - no DB persistence)
	async getChannelOwnershipCache(channelId: string): Promise<{
		userId: string;
		ownedSince: Date;
		previousOwnerId?: string;
	} | null> {
		if (this.redisAvailable && this.redisCache) {
			try {
				const cached = await this.redisCache.get(`channel_owner:${channelId}`);
				if (cached) {
					// Handle corrupted cache data
					if (
						cached === "[object Object]" ||
						cached === "null" ||
						cached === "undefined"
					) {
						console.warn(
							`🔸 Corrupted cache data for channel_owner:${channelId}, removing...`,
						);
						await this.redisCache.del(`channel_owner:${channelId}`);
						return null;
					}

					const parsed = JSON.parse(cached);
					// Convert ownedSince back to Date object
					if (parsed.ownedSince) {
						parsed.ownedSince = new Date(parsed.ownedSince);
					}
					return parsed;
				}
			} catch (error) {
				console.warn(
					`🔸 Error parsing channel ownership cache for ${channelId}:`,
					error,
				);
				// Remove corrupted cache entry
				try {
					await this.redisCache.del(`channel_owner:${channelId}`);
				} catch (delError) {
					console.warn("🔸 Error removing corrupted cache entry:", delError);
				}
				return null;
			}
		}
		return null;
	}

	async setChannelOwnershipCache(
		channelId: string,
		data: {
			userId: string;
			ownedSince: Date;
			previousOwnerId?: string;
		},
	): Promise<void> {
		if (this.redisAvailable && this.redisCache) {
			try {
				// Validate data before storing
				if (!data.userId || !data.ownedSince) {
					console.warn(
						`🔸 Invalid channel ownership data for ${channelId}:`,
						data,
					);
					return;
				}

				// Ensure ownedSince is a valid Date
				const ownedSince =
					data.ownedSince instanceof Date
						? data.ownedSince
						: new Date(data.ownedSince);

				const dataToStore = {
					userId: data.userId,
					ownedSince: ownedSince.toISOString(),
					previousOwnerId: data.previousOwnerId,
				};

				await this.redisCache.set(
					`channel_owner:${channelId}`,
					JSON.stringify(dataToStore),
					3600, // 1 hour TTL
				);
			} catch (error) {
				console.warn(
					`🔸 Error setting channel ownership cache for ${channelId}:`,
					error,
				);
			}
		}
	}

	async removeChannelOwnershipCache(channelId: string): Promise<void> {
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.del(`channel_owner:${channelId}`);
		}
	}

	// Active Voice Session Methods (Redis only)
	async getActiveVoiceSession(userId: string): Promise<{
		channelId: string;
		channelName: string;
		guildId: string;
		joinedAt: Date;
	} | null> {
		if (this.redisAvailable && this.redisCache) {
			try {
				const cached = await this.redisCache.get(`active_voice:${userId}`);
				if (cached) {
					// Handle corrupted cache data
					if (
						cached === "[object Object]" ||
						cached === "null" ||
						cached === "undefined"
					) {
						console.warn(
							`🔸 Corrupted cache data for active_voice:${userId}, removing...`,
						);
						await this.redisCache.del(`active_voice:${userId}`);
						return null;
					}

					const data = JSON.parse(cached);
					return {
						...data,
						joinedAt: new Date(data.joinedAt),
					};
				}
			} catch (error) {
				console.warn(
					`🔸 Error parsing active voice session cache for ${userId}:`,
					error,
				);
				// Remove corrupted cache entry
				try {
					await this.redisCache.del(`active_voice:${userId}`);
				} catch (delError) {
					console.warn("🔸 Error removing corrupted cache entry:", delError);
				}
				return null;
			}
		}
		return null;
	}

	async setActiveVoiceSession(
		userId: string,
		session: {
			channelId: string;
			channelName: string;
			guildId: string;
			joinedAt: Date;
		},
	): Promise<void> {
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.set(
				`active_voice:${userId}`,
				JSON.stringify(session),
				3600, // 1 hour TTL
			);
		}
	}

	async removeActiveVoiceSession(userId: string): Promise<void> {
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.del(`active_voice:${userId}`);
		}
	}

	// Channel Members Methods (Redis only)
	async addChannelMember(
		channelId: string,
		userId: string,
		joinedAt: Date,
	): Promise<void> {
		if (this.redisAvailable && this.redisCache) {
			const key = `channel_members:${channelId}`;
			const memberData = { userId, joinedAt: joinedAt.toISOString() };
			await this.redisCache.sadd(key, JSON.stringify(memberData));
			await this.redisCache.expire(key, 3600); // 1 hour TTL
		}
	}

	async removeChannelMember(channelId: string, userId: string): Promise<void> {
		if (this.redisAvailable && this.redisCache) {
			const key = `channel_members:${channelId}`;
			const members = await this.redisCache.smembers(key);
			for (const member of members) {
				const memberData = JSON.parse(member);
				if (memberData.userId === userId) {
					await this.redisCache.srem(key, member);
					break;
				}
			}
		}
	}

	async getChannelMembers(
		channelId: string,
	): Promise<Array<{ userId: string; joinedAt: Date }>> {
		if (this.redisAvailable && this.redisCache) {
			const key = `channel_members:${channelId}`;
			const members = await this.redisCache.smembers(key);
			return members.map((member) => {
				const memberData = JSON.parse(member);
				return {
					userId: memberData.userId,
					joinedAt: new Date(memberData.joinedAt),
				};
			});
		}
		return [];
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

		// Fallback to SurrealDB via SurrealCore
		try {
			const dbCore = SurrealCore.getInstance();
			const user = await dbCore.getUser(userId, guildId);
			if (user?.modPreferences) {
				const typedPreferences =
					user.modPreferences as unknown as UserModerationPreferences;

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

		// Persist to SurrealDB via SurrealCore
		try {
			const dbCore = SurrealCore.getInstance();
			await dbCore.updateModPreferences(preferences.userId, preferences);
		} catch (error) {
			console.warn(
				`🔸 Failed to persist user preferences to database: ${error}`,
			);
		}
	}

	async invalidateUserPreferences(
		userId: string,
		guildId: string,
	): Promise<void> {
		// Invalidate Redis cache
		if (this.redisAvailable && this.redisCache) {
			try {
				await this.redisCache.del(`user_prefs:${userId}:${guildId}`);
			} catch (error) {
				console.warn(
					`🔸 Failed to invalidate user preferences in Redis: ${error}`,
				);
			}
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
		ttl = 60,
	): Promise<void> {
		// Update Redis (rate limits are temporary, no MongoDB persistence needed)
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.setRateLimit(userId, action, limit, ttl);
		}
	}

	// Starboard Entry Methods
	async getStarboardEntry(
		messageId: string,
		guildId: string,
	): Promise<StarboardEntry | null> {
		await this.ensureInitialized();
		if (this.redisAvailable && this.redisCache) {
			const cached = await this.redisCache.getStarboardEntry(
				messageId,
				guildId,
			);
			if (cached) {
				return cached as StarboardEntry;
			}
		}
		return null;
	}

	async setStarboardEntry(entry: StarboardEntry): Promise<void> {
		await this.ensureInitialized();
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.setStarboardEntry(entry);
		}
	}

	async deleteStarboardEntry(
		messageId: string,
		guildId: string,
	): Promise<void> {
		await this.ensureInitialized();
		if (this.redisAvailable && this.redisCache) {
			await this.redisCache.deleteStarboardEntry(messageId, guildId);
		}
	}

	async getAllStarboardEntries(guildId: string): Promise<StarboardEntry[]> {
		await this.ensureInitialized();
		if (this.redisAvailable && this.redisCache) {
			return await this.redisCache.getAllStarboardEntries(guildId);
		}
		return [];
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
}

// Singleton instance
let cacheManager: DiscordDataCache | null = null;

export function getCacheManager(): DiscordDataCache {
	if (!cacheManager) {
		cacheManager = new DiscordDataCache();
	}
	return cacheManager;
}
