import { createClient, type RedisClientType } from "redis";
import { config } from "../config";
import type {
	CallState,
	CoupSession,
	RateLimit,
	UserModerationPreferences,
	VoiceChannelConfig,
	VoiceChannelOwner,
} from "../types";

let client: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
	if (client?.isOpen) {
		return client;
	}

	if (!config.redisUrl) {
		throw new Error(
			"🔸 Redis URL is not configured. Please set REDIS_URL in your .env file.",
		);
	}

	try {
		client = createClient({
			url: config.redisUrl,
			socket: {
				reconnectStrategy: (retries) => {
					if (retries > 10) {
						console.warn("🔸 Redis reconnection failed after 10 attempts");
						return new Error("Redis reconnection failed");
					}
					return Math.min(retries * 100, 3000);
				},
			},
		});

		client.on("error", (error) => {
			console.warn(`🔸 Redis client error: ${error}`);
		});

		client.on("connect", () => {
			console.log("🔹 Redis client connected");
		});

		client.on("reconnecting", () => {
			console.log("🔹 Redis client reconnecting...");
		});

		await client.connect();

		// Test the connection
		await client.ping();

		return client;
	} catch (error) {
		throw new Error(`🔸 Failed to connect to Redis: ${error}`);
	}
}

export async function closeRedisClient(): Promise<void> {
	if (client?.isOpen) {
		try {
			await client.quit();
		} catch (error) {
			console.warn(`🔸 Error closing Redis client: ${error}`);
		}
		client = null;
	}
}

// Redis cache helper functions
export class RedisCache {
	private client: RedisClientType;
	private defaultTTL: number;

	constructor(client: RedisClientType, defaultTTL: number = 3600) {
		this.client = client;
		this.defaultTTL = defaultTTL;
	}

	async get<T>(key: string): Promise<T | null> {
		try {
			const value = await this.client.get(key);
			return value ? JSON.parse(value) : null;
		} catch (error) {
			console.warn(`🔸 Redis get error for key ${key}: ${error}`);
			return null;
		}
	}

	async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
		try {
			const serialized = JSON.stringify(value);
			const expiration = ttl || this.defaultTTL;
			await this.client.setEx(key, expiration, serialized);
			return true;
		} catch (error) {
			console.warn(`🔸 Redis set error for key ${key}: ${error}`);
			return false;
		}
	}

	async del(key: string): Promise<boolean> {
		try {
			await this.client.del(key);
			return true;
		} catch (error) {
			console.warn(`🔸 Redis delete error for key ${key}: ${error}`);
			return false;
		}
	}

	async exists(key: string): Promise<boolean> {
		try {
			const result = await this.client.exists(key);
			return result === 1;
		} catch (error) {
			console.warn(`🔸 Redis exists error for key ${key}: ${error}`);
			return false;
		}
	}

	async expire(key: string, ttl: number): Promise<boolean> {
		try {
			await this.client.expire(key, ttl);
			return true;
		} catch (error) {
			console.warn(`🔸 Redis expire error for key ${key}: ${error}`);
			return false;
		}
	}

	// Specialized methods for different data types
	async getChannelOwner(channelId: string) {
		return this.get<VoiceChannelOwner>(`channel_owner:${channelId}`);
	}

	async setChannelOwner(
		channelId: string,
		owner: VoiceChannelOwner,
		ttl?: number,
	) {
		return this.set(`channel_owner:${channelId}`, owner, ttl);
	}

	async delChannelOwner(channelId: string) {
		return this.del(`channel_owner:${channelId}`);
	}

	async getUserPreferences(userId: string, guildId: string) {
		return this.get<UserModerationPreferences>(
			`user_prefs:${userId}:${guildId}`,
		);
	}

	async setUserPreferences(
		userId: string,
		guildId: string,
		prefs: UserModerationPreferences,
		ttl?: number,
	) {
		return this.set(`user_prefs:${userId}:${guildId}`, prefs, ttl);
	}

	async getGuildConfig(guildId: string) {
		return this.get<VoiceChannelConfig>(`guild_config:${guildId}`);
	}

	async setGuildConfig(
		guildId: string,
		config: VoiceChannelConfig,
		ttl?: number,
	) {
		return this.set(`guild_config:${guildId}`, config, ttl);
	}

	async getCallState(channelId: string) {
		return this.get<CallState>(`call_state:${channelId}`);
	}

	async setCallState(channelId: string, state: CallState, ttl?: number) {
		return this.set(`call_state:${channelId}`, state, ttl);
	}

	async getCoupSession(channelId: string) {
		return this.get<CoupSession>(`coup_session:${channelId}`);
	}

	async setCoupSession(channelId: string, session: CoupSession, ttl?: number) {
		return this.set(`coup_session:${channelId}`, session, ttl);
	}

	async delCoupSession(channelId: string) {
		return this.del(`coup_session:${channelId}`);
	}

	async getRateLimit(userId: string, action: string) {
		return this.get<RateLimit>(`rate_limit:${userId}:${action}`);
	}

	async setRateLimit(
		userId: string,
		action: string,
		limit: RateLimit,
		ttl?: number,
	) {
		return this.set(`rate_limit:${userId}:${action}`, limit, ttl);
	}
}

// Graceful shutdown
process.on("SIGINT", async () => {
	await closeRedisClient();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	await closeRedisClient();
	process.exit(0);
});
