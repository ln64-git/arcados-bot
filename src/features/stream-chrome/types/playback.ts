import type { Page } from "puppeteer";

/**
 * Playback actions that can be performed on a stream
 */
export enum PlaybackAction {
	PAUSE = "pause",
	RESUME = "resume",
	SEEK = "seek",
	SKIP_FORWARD = "skip_forward",
	SKIP_BACKWARD = "skip_backward",
	RESTART = "restart",
	NEXT_EPISODE = "next_episode",
}

/**
 * Current playback state of a stream
 */
export interface PlaybackState {
	paused: boolean;
	currentTime: number;
	duration: number;
	volume: number;
}

/**
 * Result of a playback control operation
 */
export interface PlaybackResult {
	success: boolean;
	message?: string;
	error?: string;
	state?: PlaybackState;
	fallback?: string; // Suggested alternative if operation not supported
}

/**
 * Provider capabilities for playback operations
 */
export interface ProviderCapabilities {
	pause: boolean;
	resume: boolean;
	seek: boolean;
	skip: boolean;
	restart: boolean;
	nextEpisode: boolean;
}

