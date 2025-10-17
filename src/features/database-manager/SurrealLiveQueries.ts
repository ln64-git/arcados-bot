import type { Surreal } from "surrealdb.js";
import { getSurrealConnection } from "./SurrealConnection";

export class SurrealLiveQueries {
	private surreal: Surreal | null = null;
	private liveQueries: Map<string, string> = new Map(); // query ID -> live query ID
	private callbacks: Map<string, (data: unknown) => void> = new Map();

	async initialize(): Promise<void> {
		this.surreal = await getSurrealConnection();
		console.log("🔹 SurrealDB Live Queries initialized");
	}

	// ==================== VOICE SESSION LIVE QUERIES ====================

	/**
	 * Subscribe to voice session changes for a specific channel
	 */
	async subscribeToChannelVoiceSessions(
		channelId: string,
		callback: (sessions: unknown[]) => void,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const query = `
			LIVE SELECT * FROM voice_channel_sessions 
			WHERE channel_id = $channel_id AND is_active = true
		`;

		const liveQueryId = await this.surreal.live(query, {
			channel_id: channelId,
		});
		const queryKey = `channel_voice_sessions_${channelId}`;

		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log(`🔹 Subscribed to voice sessions for channel ${channelId}`);
		return liveQueryId;
	}

	/**
	 * Subscribe to all active voice sessions across all channels
	 */
	async subscribeToAllVoiceSessions(
		callback: (sessions: unknown[]) => void,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const query = `
			LIVE SELECT * FROM voice_channel_sessions 
			WHERE is_active = true
		`;

		const liveQueryId = await this.surreal.live(query, {});
		const queryKey = "all_voice_sessions";

		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log("🔹 Subscribed to all active voice sessions");
		return liveQueryId;
	}

	/**
	 * Subscribe to voice session changes for a specific user
	 */
	async subscribeToUserVoiceSessions(
		userId: string,
		callback: (sessions: unknown[]) => void,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const query = `
			LIVE SELECT * FROM voice_channel_sessions 
			WHERE user_id = $user_id AND is_active = true
		`;

		const liveQueryId = await this.surreal.live(query, { user_id: userId });
		const queryKey = `user_voice_sessions_${userId}`;

		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log(`🔹 Subscribed to voice sessions for user ${userId}`);
		return liveQueryId;
	}

	// ==================== CHANNEL LIVE QUERIES ====================

	/**
	 * Subscribe to channel member count changes
	 */
	async subscribeToChannelMembers(
		channelId: string,
		callback: (channel: unknown) => void,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const query = `
			LIVE SELECT * FROM channels 
			WHERE discord_id = $discord_id
		`;

		const liveQueryId = await this.surreal.live(query, {
			discord_id: channelId,
		});
		const queryKey = `channel_members_${channelId}`;

		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log(`🔹 Subscribed to channel members for ${channelId}`);
		return liveQueryId;
	}

	/**
	 * Subscribe to all active channels in a guild
	 */
	async subscribeToGuildChannels(
		guildId: string,
		callback: (channels: unknown[]) => void,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const query = `
			LIVE SELECT * FROM channels 
			WHERE guild_id = $guild_id AND is_active = true
		`;

		const liveQueryId = await this.surreal.live(query, { guild_id: guildId });
		const queryKey = `guild_channels_${guildId}`;

		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log(`🔹 Subscribed to channels for guild ${guildId}`);
		return liveQueryId;
	}

	// ==================== USER LIVE QUERIES ====================

	/**
	 * Subscribe to user moderation preferences changes
	 */
	async subscribeToUserModPreferences(
		userId: string,
		guildId: string,
		callback: (preferences: unknown) => void,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const query = `
			LIVE SELECT mod_preferences FROM users 
			WHERE discord_id = $discord_id AND guild_id = $guild_id
		`;

		const liveQueryId = await this.surreal.live(query, {
			discord_id: userId,
			guild_id: guildId,
		});
		const queryKey = `user_mod_preferences_${userId}_${guildId}`;

		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log(`🔹 Subscribed to mod preferences for user ${userId}`);
		return liveQueryId;
	}

	/**
	 * Subscribe to user voice interaction history changes
	 */
	async subscribeToUserVoiceInteractions(
		userId: string,
		guildId: string,
		callback: (interactions: unknown[]) => void,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const query = `
			LIVE SELECT voice_interactions FROM users 
			WHERE discord_id = $discord_id AND guild_id = $guild_id
		`;

		const liveQueryId = await this.surreal.live(query, {
			discord_id: userId,
			guild_id: guildId,
		});
		const queryKey = `user_voice_interactions_${userId}_${guildId}`;

		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log(`🔹 Subscribed to voice interactions for user ${userId}`);
		return liveQueryId;
	}

	// ==================== MESSAGE LIVE QUERIES ====================

	/**
	 * Subscribe to new messages in a channel
	 */
	async subscribeToChannelMessages(
		channelId: string,
		callback: (messages: unknown[]) => void,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const query = `
			LIVE SELECT * FROM messages 
			WHERE channel_id = $channel_id
			ORDER BY timestamp DESC
			LIMIT 50
		`;

		const liveQueryId = await this.surreal.live(query, {
			channel_id: channelId,
		});
		const queryKey = `channel_messages_${channelId}`;

		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log(`🔹 Subscribed to messages for channel ${channelId}`);
		return liveQueryId;
	}

	/**
	 * Subscribe to new messages in a guild
	 */
	async subscribeToGuildMessages(
		guildId: string,
		callback: (messages: unknown[]) => void,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const query = `
			LIVE SELECT * FROM messages 
			WHERE guild_id = $guild_id
			ORDER BY timestamp DESC
			LIMIT 100
		`;

		const liveQueryId = await this.surreal.live(query, { guild_id: guildId });
		const queryKey = `guild_messages_${guildId}`;

		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log(`🔹 Subscribed to messages for guild ${guildId}`);
		return liveQueryId;
	}

	// ==================== RELATIONSHIP LIVE QUERIES ====================

	/**
	 * Subscribe to relationship changes between users
	 */
	async subscribeToUserRelationships(
		userId: string,
		guildId: string,
		callback: (relationships: unknown[]) => void,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const query = `
			LIVE SELECT * FROM relationships 
			WHERE (user_id1 = $user_id OR user_id2 = $user_id) AND guild_id = $guild_id
		`;

		const liveQueryId = await this.surreal.live(query, {
			user_id: userId,
			guild_id: guildId,
		});
		const queryKey = `user_relationships_${userId}_${guildId}`;

		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log(`🔹 Subscribed to relationships for user ${userId}`);
		return liveQueryId;
	}

	// ==================== QUERY MANAGEMENT ====================

	/**
	 * Unsubscribe from a live query
	 */
	async unsubscribe(queryKey: string): Promise<void> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const liveQueryId = this.liveQueries.get(queryKey);
		if (liveQueryId) {
			await this.surreal.kill(liveQueryId);
			this.liveQueries.delete(queryKey);
			this.callbacks.delete(queryKey);
			console.log(`🔹 Unsubscribed from live query: ${queryKey}`);
		}
	}

	/**
	 * Unsubscribe from all live queries
	 */
	async unsubscribeAll(): Promise<void> {
		if (!this.surreal) {
			return;
		}

		for (const [queryKey, liveQueryId] of this.liveQueries) {
			try {
				await this.surreal.kill(liveQueryId);
				console.log(`🔹 Unsubscribed from live query: ${queryKey}`);
			} catch (error) {
				console.warn(`🔸 Failed to unsubscribe from ${queryKey}:`, error);
			}
		}

		this.liveQueries.clear();
		this.callbacks.clear();
		console.log("🔹 Unsubscribed from all live queries");
	}

	/**
	 * Get list of active live queries
	 */
	getActiveQueries(): string[] {
		return Array.from(this.liveQueries.keys());
	}

	/**
	 * Handle live query notifications
	 * This should be called when SurrealDB sends live query updates
	 */
	handleLiveQueryUpdate(queryId: string, data: unknown): void {
		// Find the query key by live query ID
		for (const [queryKey, liveQueryId] of this.liveQueries) {
			if (liveQueryId === queryId) {
				const callback = this.callbacks.get(queryKey);
				if (callback) {
					try {
						callback(data);
					} catch (error) {
						console.error(
							`🔸 Error in live query callback for ${queryKey}:`,
							error,
						);
					}
				}
				break;
			}
		}
	}

	// ==================== UTILITY METHODS ====================

	/**
	 * Create a custom live query
	 */
	async createCustomLiveQuery(
		query: string,
		params: Record<string, unknown>,
		callback: (data: unknown) => void,
		queryKey: string,
	): Promise<string> {
		if (!this.surreal) {
			throw new Error("SurrealDB connection not initialized");
		}

		const liveQueryId = await this.surreal.live(query, params);
		this.liveQueries.set(queryKey, liveQueryId);
		this.callbacks.set(queryKey, callback);

		console.log(`🔹 Created custom live query: ${queryKey}`);
		return liveQueryId;
	}

	/**
	 * Cleanup resources
	 */
	async cleanup(): Promise<void> {
		await this.unsubscribeAll();
		this.surreal = null;
		console.log("🔹 SurrealDB Live Queries cleaned up");
	}
}
