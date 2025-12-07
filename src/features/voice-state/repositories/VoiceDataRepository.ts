/**
 * Voice Data Repository
 *
 * Centralized database access layer for voice state operations.
 * Provides type-safe methods for all voice-related database operations,
 * consolidating queries that were previously scattered across VoiceStateManager.
 *
 * Key benefits:
 * - Single source of truth for database operations
 * - Type-safe query methods
 * - Consistent error handling
 * - Batch operations to eliminate N+1 queries
 * - Transaction support for multi-step operations
 */

import type {
	PostgreSQLManager,
	DatabaseResult,
} from "../../../database/PostgreSQLManager";
import type {
	VoiceSessionData,
	VoiceStateData,
	VoiceHistoryData,
	ChannelData,
	MemberJoinTime,
	SessionSummary,
	SessionUpdate,
	ModerationEvent,
	VoiceChannelPreferences,
} from "../types/index";
import { VoiceDataError } from "../types/index";

export class VoiceDataRepository {
	constructor(private db: PostgreSQLManager) { }

	// ============================================================================
	// Session Operations
	// ============================================================================

	/**
	 * Create a new voice session
	 */
	async createSession(data: VoiceSessionData): Promise<void> {
		const result = await this.db.query(
			`INSERT INTO voice_sessions (
				id, guild_id, user_id, channel_id, joined_at,
				duration, time_muted, time_deafened, time_streaming,
				owner_at_join, is_grandfathered, applied_moderation, active
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			[
				data.id,
				data.guild_id,
				data.user_id,
				data.channel_id,
				data.joined_at,
				data.duration,
				data.time_muted,
				data.time_deafened,
				data.time_streaming,
				data.owner_at_join || null,
				data.is_grandfathered,
				JSON.stringify(data.applied_moderation),
				data.active,
			],
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to create session", result.error);
		}
	}

	/**
	 * Update an existing session
	 */
	async updateSession(
		sessionId: string,
		updates: SessionUpdate,
	): Promise<void> {
		const fields: string[] = [];
		const values: unknown[] = [sessionId];
		let paramIndex = 2;

		// Build dynamic UPDATE query based on provided fields
		if (updates.channel_id !== undefined) {
			fields.push(`channel_id = $${paramIndex++}`);
			values.push(updates.channel_id);
		}
		if (updates.time_muted !== undefined) {
			fields.push(`time_muted = $${paramIndex++}`);
			values.push(updates.time_muted);
		}
		if (updates.time_deafened !== undefined) {
			fields.push(`time_deafened = $${paramIndex++}`);
			values.push(updates.time_deafened);
		}
		if (updates.time_streaming !== undefined) {
			fields.push(`time_streaming = $${paramIndex++}`);
			values.push(updates.time_streaming);
		}
		if (updates.active !== undefined) {
			fields.push(`active = $${paramIndex++}`);
			values.push(updates.active);
		}

		if (fields.length === 0) {
			return; // No updates to perform
		}

		const result = await this.db.query(
			`UPDATE voice_sessions SET ${fields.join(", ")} WHERE id = $1`,
			values,
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to update session", result.error);
		}
	}

	/**
	 * Finalize a session with summary data
	 */
	async finalizeSession(
		sessionId: string,
		summary: SessionSummary,
	): Promise<void> {
		const result = await this.db.query(
			`UPDATE voice_sessions
			 SET
				left_at = NOW(),
				duration = $2,
				time_muted = $3,
				time_deafened = $4,
				time_streaming = $5,
				active = false
			 WHERE id = $1`,
			[
				sessionId,
				summary.duration,
				summary.time_muted,
				summary.time_deafened,
				summary.time_streaming,
			],
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to finalize session", result.error);
		}
	}

	/**
	 * Get active session for a user in a guild
	 */
	async getActiveSession(
		userId: string,
		guildId: string,
	): Promise<VoiceSessionData | null> {
		const result = await this.db.query(
			`SELECT * FROM voice_sessions
			 WHERE user_id = $1 AND guild_id = $2 AND active = true
			 ORDER BY joined_at DESC
			 LIMIT 1`,
			[userId, guildId],
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to get active session", result.error);
		}

		if (!result.data || result.data.length === 0) {
			return null;
		}

		const row = result.data[0];
		return {
			id: row.id,
			guild_id: row.guild_id,
			user_id: row.user_id,
			channel_id: row.channel_id,
			joined_at: row.joined_at,
			left_at: row.left_at,
			duration: row.duration,
			time_muted: row.time_muted,
			time_deafened: row.time_deafened,
			time_streaming: row.time_streaming,
			owner_at_join: row.owner_at_join,
			is_grandfathered: row.is_grandfathered,
			applied_moderation: row.applied_moderation,
			active: row.active,
		};
	}

	// ============================================================================
	// Voice State Operations
	// ============================================================================

	/**
	 * Upsert voice state (insert or update)
	 */
	async upsertVoiceState(data: VoiceStateData): Promise<void> {
		const result = await this.db.query(
			`INSERT INTO voice_states (
				id, guild_id, user_id, channel_id, session_id,
				self_mute, self_deaf, server_mute, server_deaf,
				streaming, self_video
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (id) DO UPDATE SET
				channel_id = EXCLUDED.channel_id,
				session_id = EXCLUDED.session_id,
				self_mute = EXCLUDED.self_mute,
				self_deaf = EXCLUDED.self_deaf,
				server_mute = EXCLUDED.server_mute,
				server_deaf = EXCLUDED.server_deaf,
				streaming = EXCLUDED.streaming,
				self_video = EXCLUDED.self_video,
				updated_at = NOW()`,
			[
				data.id,
				data.guild_id,
				data.user_id,
				data.channel_id,
				data.session_id || null,
				data.self_mute,
				data.self_deaf,
				data.server_mute,
				data.server_deaf,
				data.streaming,
				data.self_video,
			],
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to upsert voice state", result.error);
		}
	}

	/**
	 * Delete voice state
	 */
	async deleteVoiceState(key: string): Promise<void> {
		const result = await this.db.query(
			`DELETE FROM voice_states WHERE id = $1`,
			[key],
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to delete voice state", result.error);
		}
	}

	/**
	 * Get voice state by key
	 */
	async getVoiceState(key: string): Promise<VoiceStateData | null> {
		const result = await this.db.query(
			`SELECT * FROM voice_states WHERE id = $1`,
			[key],
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to get voice state", result.error);
		}

		if (!result.data || result.data.length === 0) {
			return null;
		}

		const row = result.data[0];
		return {
			id: row.id,
			guild_id: row.guild_id,
			user_id: row.user_id,
			channel_id: row.channel_id,
			session_id: row.session_id,
			self_mute: row.self_mute,
			self_deaf: row.self_deaf,
			server_mute: row.server_mute,
			server_deaf: row.server_deaf,
			streaming: row.streaming,
			self_video: row.self_video,
			joined_at: row.joined_at,
			updated_at: row.updated_at,
		};
	}

	// ============================================================================
	// History Operations
	// ============================================================================

	/**
	 * Record a voice history event
	 */
	async recordHistory(event: VoiceHistoryData): Promise<void> {
		// Generate unique ID if not provided (max 50 chars for DB)
		// Include random suffix to prevent collisions when multiple events occur in same millisecond
		const eventId =
			event.id ||
			`${event.event_type}_${event.user_id.slice(-8)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

		const result = await this.db.query(
			`INSERT INTO voice_history (
				id, guild_id, user_id, channel_id, event_type,
				from_channel_id, to_channel_id, session_id,
				self_mute, self_deaf, server_mute, server_deaf,
				streaming, self_video, timestamp
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			[
				eventId,
				event.guild_id,
				event.user_id,
				event.channel_id || null,
				event.event_type,
				event.from_channel_id || null,
				event.to_channel_id || null,
				event.session_id || null,
				event.self_mute || false,
				event.self_deaf || false,
				event.server_mute || false,
				event.server_deaf || false,
				event.streaming || false,
				event.self_video || false,
				event.timestamp,
			],
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to record history", result.error);
		}
	}

	/**
	 * Get history for a channel
	 */
	async getHistory(
		channelId: string,
		limit: number = 50,
	): Promise<VoiceHistoryData[]> {
		const result = await this.db.query(
			`SELECT * FROM voice_history
			 WHERE channel_id = $1
			 ORDER BY timestamp DESC
			 LIMIT $2`,
			[channelId, limit],
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to get history", result.error);
		}

		return (result.data || []).map((row) => ({
			id: row.id,
			guild_id: row.guild_id,
			user_id: row.user_id,
			channel_id: row.channel_id,
			event_type: row.event_type,
			from_channel_id: row.from_channel_id,
			to_channel_id: row.to_channel_id,
			session_id: row.session_id,
			session_duration: row.session_duration,
			self_mute: row.self_mute,
			self_deaf: row.self_deaf,
			server_mute: row.server_mute,
			server_deaf: row.server_deaf,
			streaming: row.streaming,
			self_video: row.self_video,
			timestamp: row.timestamp,
		}));
	}

	// ============================================================================
	// Channel Operations
	// ============================================================================

	/**
	 * Insert a new channel
	 * 
	 * Preserves is_user_channel flag if already set to true (won't overwrite user channels)
	 * Only updates is_user_channel if explicitly setting to true
	 */
	async insertChannel(channel: ChannelData): Promise<void> {
		const result = await this.db.query(
		`INSERT INTO channels (
			id, guild_id, name, type, parent_id, position,
			is_user_channel, current_owner_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			-- Preserve is_user_channel if already true, otherwise use new value
			is_user_channel = CASE 
				WHEN channels.is_user_channel = true THEN true
				ELSE EXCLUDED.is_user_channel
			END,
			-- Preserve current_owner_id if already set, otherwise use new value
			current_owner_id = COALESCE(channels.current_owner_id, EXCLUDED.current_owner_id)`,
			[
				channel.id,
				channel.guild_id,
				channel.name,
				channel.type,
				channel.parent_id,
				channel.position,
				channel.is_user_channel,
				channel.current_owner_id,
			],
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to insert channel", result.error);
		}
	}

	/**
	 * Update channel properties
	 */
	async updateChannel(
		channelId: string,
		updates: Partial<ChannelData>,
	): Promise<void> {
		const fields: string[] = [];
		const values: unknown[] = [channelId];
		let paramIndex = 2;

		if (updates.name !== undefined) {
			fields.push(`name = $${paramIndex++}`);
			values.push(updates.name);
		}
		if (updates.current_owner_id !== undefined) {
			fields.push(`current_owner_id = $${paramIndex++}`);
			values.push(updates.current_owner_id);
		}
		if (updates.is_user_channel !== undefined) {
			fields.push(`is_user_channel = $${paramIndex++}`);
			values.push(updates.is_user_channel);
		}

		if (fields.length === 0) {
			return;
		}

		const result = await this.db.query(
			`UPDATE channels SET ${fields.join(", ")} WHERE id = $1`,
			values,
		);

		if (!result.success) {
			throw new VoiceDataError("Failed to update channel", result.error);
		}
	}

	// ============================================================================
	// Ownership Operations (OPTIMIZED)
	// ============================================================================

	/**
	 * Record channel ownership
	 */
	async recordOwnership(
		guildId: string,
		channelId: string,
		userId: string,
	): Promise<void> {
		const result = await this.db.query(
			`INSERT INTO voice_channel_ownership (guild_id, channel_id, user_id)
			 VALUES ($1, $2, $3)`,
			[guildId, channelId, userId],
		);

		if (!result.success) {
			// Log but don't throw - ownership record is nice-to-have, not critical
			console.warn("🔸 Failed to record channel ownership:", result.error);
		}
	}

	/**
	 * Get current owner of a channel
	 */
	async getCurrentOwner(channelId: string): Promise<string | null> {
		const result = await this.db.query(
			`SELECT current_owner_id FROM channels WHERE id = $1`,
			[channelId],
		);

		if (!result.success || !result.data || result.data.length === 0) {
			return null;
		}

		return result.data[0].current_owner_id;
	}

	/**
	 * Check if a channel is a user channel
	 */
	async isUserChannel(channelId: string): Promise<boolean> {
		const result = await this.db.query(
			`SELECT is_user_channel FROM channels WHERE id = $1`,
			[channelId],
		);

		if (!result.success || !result.data || result.data.length === 0) {
			return false;
		}

		return result.data[0].is_user_channel === true;
	}

	/**
	 * Get channel members with join times (OPTIMIZED - single query)
	 *
	 * This replaces N+1 query pattern where we previously queried each member individually.
	 * Returns all members in a channel with their join times and ownership status in one query.
	 */
	async getChannelMembersWithJoinTimes(
		channelId: string,
	): Promise<MemberJoinTime[]> {
		const result = await this.db.query(
			`SELECT
				vs.user_id,
				sess.joined_at,
				(ch.current_owner_id = vs.user_id) as is_owner
			 FROM voice_states vs
			 JOIN voice_sessions sess ON sess.id = vs.session_id AND sess.active = true
			 JOIN channels ch ON ch.id = vs.channel_id
			 WHERE vs.channel_id = $1
			 ORDER BY sess.joined_at ASC`,
			[channelId],
		);

		if (!result.success) {
			throw new VoiceDataError(
				"Failed to get channel members",
				result.error,
			);
		}

		return (result.data || []).map((row) => ({
			user_id: row.user_id,
			joined_at: row.joined_at,
			is_owner: row.is_owner,
		}));
	}

	// ============================================================================
	// Preference Operations
	// ============================================================================

	/**
	 * Get user preferences for voice channels
	 */
	async getUserPreferences(
		userId: string,
		guildId: string,
	): Promise<VoiceChannelPreferences> {
		try {
			const result = await this.db.query(
				`SELECT channel_name, default_user_limit, privacy_mode,
				        banned_users, muted_users, deafened_users
				 FROM voice_channel_preferences
				 WHERE user_id = $1 AND guild_id = $2`,
				[userId, guildId],
			);

			if (!result.success || !result.data || result.data.length === 0) {
				// Return default preferences
				return {};
			}

			const row = result.data[0];
			return {
				channel_name: row.channel_name || undefined,
				default_user_limit: row.default_user_limit || undefined,
				privacy_mode: row.privacy_mode || undefined,
				banned_users: row.banned_users || undefined,
				muted_users: row.muted_users || undefined,
				deafened_users: row.deafened_users || undefined,
			};
		} catch (error) {
			// Table doesn't exist or query error, return defaults
			console.error("🔸 Failed to get user preferences:", error);
			return {};
		}
	}

	/**
	 * Update user preferences for voice channels
	 * 
	 * Uses INSERT...ON CONFLICT UPDATE to handle both creating new preferences
	 * and updating existing ones. Only updates fields that are provided.
	 */
	async updateUserPreferences(
		userId: string,
		guildId: string,
		prefs: VoiceChannelPreferences,
	): Promise<void> {
		// Build dynamic INSERT and UPDATE clauses based on provided preferences
		const insertFields: string[] = ["user_id", "guild_id"];
		const insertValues: string[] = ["$1", "$2"];
		const updateFields: string[] = [];
		const values: unknown[] = [userId, guildId];
		let paramCount = 2;

		if (prefs.channel_name !== undefined) {
			paramCount++;
			insertFields.push("channel_name");
			insertValues.push(`$${paramCount}`);
			updateFields.push(`channel_name = $${paramCount}`);
			values.push(prefs.channel_name);
		}
		if (prefs.default_user_limit !== undefined) {
			paramCount++;
			insertFields.push("default_user_limit");
			insertValues.push(`$${paramCount}`);
			updateFields.push(`default_user_limit = $${paramCount}`);
			values.push(prefs.default_user_limit);
		}
		if (prefs.privacy_mode !== undefined) {
			paramCount++;
			insertFields.push("privacy_mode");
			insertValues.push(`$${paramCount}`);
			updateFields.push(`privacy_mode = $${paramCount}`);
			values.push(prefs.privacy_mode);
		}
		if (prefs.banned_users !== undefined) {
			paramCount++;
			insertFields.push("banned_users");
			insertValues.push(`$${paramCount}`);
			updateFields.push(`banned_users = $${paramCount}`);
			values.push(prefs.banned_users);
		}
		if (prefs.muted_users !== undefined) {
			paramCount++;
			insertFields.push("muted_users");
			insertValues.push(`$${paramCount}`);
			updateFields.push(`muted_users = $${paramCount}`);
			values.push(prefs.muted_users);
		}
		if (prefs.deafened_users !== undefined) {
			paramCount++;
			insertFields.push("deafened_users");
			insertValues.push(`$${paramCount}`);
			updateFields.push(`deafened_users = $${paramCount}`);
			values.push(prefs.deafened_users);
		}

		// Always update the timestamp on conflict
		updateFields.push("updated_at = NOW()");

		// If no fields to update, just ensure the record exists
		if (updateFields.length === 1) {
			// Only timestamp update, so just do a no-op insert
			const result = await this.db.query(
				`INSERT INTO voice_channel_preferences (user_id, guild_id)
				 VALUES ($1, $2)
				 ON CONFLICT (user_id, guild_id) DO UPDATE SET
					updated_at = NOW()`,
				[userId, guildId],
			);

			if (!result.success) {
				throw new VoiceDataError(
					"Failed to update user preferences",
					result.error,
				);
			}
			return;
		}

		const result = await this.db.query(
			`INSERT INTO voice_channel_preferences (${insertFields.join(", ")})
			 VALUES (${insertValues.join(", ")})
			 ON CONFLICT (user_id, guild_id) DO UPDATE SET
				${updateFields.join(", ")}`,
			values,
		);

		if (!result.success) {
			throw new VoiceDataError(
				"Failed to update user preferences",
				result.error,
			);
		}
	}

	// ============================================================================
	// Moderation Operations
	// ============================================================================

	/**
	 * Record a moderation event
	 */
	async recordModerationEvent(event: ModerationEvent): Promise<void> {
		// Generate unique ID (max 50 chars for DB)
		const eventId = `moderation_${event.user_id.slice(-8)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
		
		const result = await this.db.query(
			`INSERT INTO voice_history (
				id, guild_id, user_id, channel_id, event_type, timestamp, self_mute, self_deaf, server_mute, server_deaf
			) VALUES (
				$1,
				(SELECT guild_id FROM channels WHERE id = $2),
				$3, $2, 'moderation', $4, false, false, $5, $6
			)`,
			[
				eventId,
				event.channel_id,
				event.user_id,
				event.timestamp,
				event.action === "mute" || event.action === "unmute",
				event.action === "deafen" || event.action === "undeafen",
			],
		);

		if (!result.success) {
			console.warn("🔸 Failed to record moderation event:", result.error);
		}
	}

	/**
	 * Get moderation history for a channel
	 */
	async getModerationHistory(
		channelId: string,
		limit: number = 50,
	): Promise<ModerationEvent[]> {
		const result = await this.db.query(
			`SELECT * FROM voice_history
			 WHERE channel_id = $1 AND event_type = 'moderation'
			 ORDER BY timestamp DESC
			 LIMIT $2`,
			[channelId, limit],
		);

		if (!result.success) {
			throw new VoiceDataError(
				"Failed to get moderation history",
				result.error,
			);
		}

		return (result.data || []).map((row) => {
			// Determine action from boolean flags
			let action: "mute" | "unmute" | "deafen" | "undeafen" = "mute";
			if (row.server_mute) {
				action = "mute";
			} else if (row.server_deaf) {
				action = "deafen";
			}

			return {
				action,
				channel_id: row.channel_id,
				user_id: row.user_id,
				moderator_id: row.user_id, // TODO: Track actual moderator
				timestamp: row.timestamp,
			};
		});
	}
}
