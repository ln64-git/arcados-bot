import type { Page, Browser } from "puppeteer";
import type { Snowflake, VoiceChannel } from "discord.js";

/**
 * Search result from a streaming provider
 */
export interface SearchResult {
	title: string;
	year?: number;
	type: "movie" | "tv" | "unknown";
	url: string;
	thumbnailUrl?: string;
	description?: string;
	// For TV shows
	season?: number;
	episode?: number;
	totalSeasons?: number;
	totalEpisodes?: number;
}

/**
 * Media type classification
 */
export type MediaType = "movie" | "tv" | "unknown";

/**
 * Stream session state
 */
export type StreamState =
	| "initializing"
	| "searching"
	| "loading"
	| "playing"
	| "ended"
	| "error"
	| "stopped";

/**
 * Active streaming session
 */
export interface StreamSession {
	guildId: Snowflake;
	voiceChannelId: Snowflake;
	query: string;
	state: StreamState;
	searchResult?: SearchResult;
	page?: Page;
	startTime: Date;
	error?: string;
	provider?: string; // Provider name used for this session
	// Discord streaming connection
	streamConnection?: any; // Will be typed based on Discord Go Live implementation
	// Enhanced fields for new architecture
	playbackState?: import("./types/playback.js").PlaybackState;
	searchResults?: SearchResult[]; // Cached for fuzzy selection
}

/**
 * Result of a stream operation
 */
export interface StreamResult {
	success: boolean;
	message: string;
	session?: StreamSession;
	error?: string;
	// When multiple search results are found, present them for selection
	searchResults?: SearchResult[];
	requiresSelection?: boolean;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
	name: string;
	baseUrl: string;
	searchEndpoint?: string;
	supportedTypes: MediaType[];
	requiresAuth: boolean;
}

/**
 * Media element information detected in page
 */
export interface MediaElementInfo {
	elementType: "video" | "audio" | "iframe";
	src?: string;
	duration?: number;
	currentTime?: number;
	paused: boolean;
	ended: boolean;
	readyState: number;
}

/**
 * Stream player statistics
 */
export interface StreamStats {
	totalStreams: number;
	activeStreams: number;
	averageDuration: number;
	errors: number;
}

/**
 * Content detection result
 */
export interface ContentDetectionResult {
	found: boolean;
	mediaElement?: MediaElementInfo;
	error?: string;
}

/**
 * Options for stream request
 */
export interface StreamOptions {
	guildId: Snowflake;
	voiceChannelId: Snowflake;
	query: string;
	// Optional overrides
	provider?: string;
	preferredQuality?: "low" | "medium" | "high";
	// For TV shows
	season?: number;
	episode?: number;
	random?: boolean; // Pick random episode
}
