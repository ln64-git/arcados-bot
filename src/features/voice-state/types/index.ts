/**
 * Type definitions for voice state management
 *
 * Consolidated from legacy types.ts and extended for refactored architecture.
 * These types support the service layer, repository, and coordinator.
 */

// ============================================================================
// Core Database Models
// ============================================================================

/**
 * Voice session data model
 * Represents a single user's voice session from join to leave
 */
export interface VoiceSessionData {
	id: string;
	guild_id: string;
	user_id: string;
	channel_id: string;
	joined_at: Date;
	left_at?: Date;
	duration: number;
	time_muted: number;
	time_deafened: number;
	time_streaming: number;
	owner_at_join?: string;
	is_grandfathered: boolean;
	applied_moderation: Record<string, unknown>;
	active: boolean;
}

/**
 * Voice state data model
 * Represents current voice state for a user in a guild
 */
export interface VoiceStateData {
	id: string;
	guild_id: string;
	user_id: string;
	channel_id: string | null;
	session_id?: string;
	self_mute: boolean;
	self_deaf: boolean;
	server_mute: boolean;
	server_deaf: boolean;
	streaming: boolean;
	self_video: boolean;
	joined_at?: Date;
	updated_at?: Date;
}

/**
 * Voice history data model
 * Represents historical voice events for auditing and analytics
 */
export interface VoiceHistoryData {
	id?: string;
	guild_id: string;
	user_id: string;
	channel_id?: string | null;
	event_type: "join" | "leave" | "switch" | "state_change" | "moderation";
	from_channel_id?: string | null;
	to_channel_id?: string | null;
	session_id?: string | null;
	session_duration?: number;
	self_mute?: boolean;
	self_deaf?: boolean;
	server_mute?: boolean;
	server_deaf?: boolean;
	streaming?: boolean;
	self_video?: boolean;
	timestamp: Date;
}

/**
 * Channel data model
 * Represents Discord voice channel metadata
 */
export interface ChannelData {
	id: string;
	guild_id: string;
	name: string;
	type: number;
	parent_id: string | null;
	position: number;
	is_user_channel: boolean;
	current_owner_id: string | null;
}

/**
 * User channel preferences
 * Customization settings for user-created channels
 */
export interface VoiceChannelPreferences {
	channel_name?: string;
	default_user_limit?: number;
	privacy_mode?: "public" | "friends_only" | "private";
	banned_users?: string[];
	muted_users?: string[];
	deafened_users?: string[];
	blocked_users?: string[];
}

// ============================================================================
// Service Layer Types
// ============================================================================

/**
 * Member join time data
 * Used for ownership succession calculations
 */
export interface MemberJoinTime {
	user_id: string;
	joined_at: Date;
	is_owner: boolean;
	session_id: string;
}

/**
 * Session summary
 * Aggregated analytics for a completed session
 */
export interface SessionSummary {
	duration: number;
	time_muted: number;
	time_deafened: number;
	time_streaming: number;
	channels_visited: string[];
}

/**
 * Session update payload
 * Partial updates allowed for active sessions
 */
export interface SessionUpdate {
	channel_id?: string;
	time_muted?: number;
	time_deafened?: number;
	time_streaming?: number;
	active?: boolean;
	is_grandfathered?: boolean;
}

/**
 * State change event
 * Represents a change in user's voice state (mute, deaf, streaming, etc.)
 */
export interface StateChangeEvent {
	guild_id: string;
	user_id: string;
	channel_id: string;
	self_mute: boolean;
	self_deaf: boolean;
	server_mute: boolean;
	server_deaf: boolean;
	streaming: boolean;
	self_video: boolean;
	timestamp: Date;
}

/**
 * Moderation event
 * Represents a moderation action applied to a user
 */
export interface ModerationEvent {
	action: "mute" | "unmute" | "deafen" | "undeafen";
	channel_id: string;
	user_id: string;
	moderator_id: string;
	timestamp: Date;
	reason?: string;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error for voice state operations
 */
export class VoiceStateError extends Error {
	constructor(message: string, public override cause?: unknown) {
		super(message);
		this.name = "VoiceStateError";
	}
}

/**
 * Database operation error
 */
export class VoiceDataError extends Error {
	constructor(message: string, public override cause?: unknown) {
		super(message);
		this.name = "VoiceDataError";
	}
}

/**
 * Moderation operation error
 */
export class ModerationError extends Error {
	constructor(message: string, public override cause?: unknown) {
		super(message);
		this.name = "ModerationError";
	}
}

/**
 * Ownership operation error
 */
export class OwnershipError extends Error {
	constructor(message: string, public override cause?: unknown) {
		super(message);
		this.name = "OwnershipError";
	}
}

/**
 * Spawn channel operation error
 */
export class SpawnChannelError extends Error {
	constructor(message: string, public override cause?: unknown) {
		super(message);
		this.name = "SpawnChannelError";
	}
}
