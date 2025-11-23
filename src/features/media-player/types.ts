import type { Snowflake, User } from "discord.js";

/**
 * Represents a track in the media player queue
 */
export interface MediaTrack {
	/** Unique track ID */
	id: string;

	/** Video title */
	title: string;

	/** YouTube video URL */
	url: string;

	/** Video thumbnail URL */
	thumbnail: string;

	/** Duration in seconds */
	duration: number;

	/** Formatted duration string (e.g., "3:45") */
	durationFormatted: string;

	/** Channel/artist name */
	channel: string;

	/** User who queued this track */
	queuedBy: User;

	/** Timestamp when queued */
	queuedAt: Date;
}

/**
 * Playback state
 */
export enum PlaybackState {
	IDLE = "idle",
	PLAYING = "playing",
	PAUSED = "paused",
	STOPPED = "stopped",
}

/**
 * Media player state for a guild
 */
export interface MediaPlayerState {
	/** Current playback state */
	state: PlaybackState;

	/** Current track being played */
	currentTrack: MediaTrack | null;

	/** Current position in track (seconds) */
	position: number;

	/** Volume (0-100) */
	volume: number;

	/** Whether audio is muted */
	muted: boolean;

	/** Previous volume before muting (for unmute) */
	previousVolume: number;

	/** Whether queue is looping */
	loop: boolean;

	/** Whether queue is shuffled */
	shuffle: boolean;

	/** Text channel where embed is displayed */
	embedChannelId: Snowflake | null;

	/** Message ID of the embed */
	embedMessageId: Snowflake | null;
}

