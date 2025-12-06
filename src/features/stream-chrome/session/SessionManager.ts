import type { Snowflake } from "discord.js";
import type { Page } from "puppeteer";
import type { StreamSession, StreamState, SearchResult } from "../types.js";
import type { PlaybackState } from "../types/playback.js";

/**
 * Manager for stream session state and lifecycle
 * Enhanced with playback state tracking and search result caching
 */
export class SessionManager {
	private activeSessions: Map<Snowflake, StreamSession> = new Map();

	/**
	 * Create a new session
	 */
	public createSession(
		guildId: Snowflake,
		voiceChannelId: Snowflake,
		query: string,
		provider: string
	): StreamSession {
		const session: StreamSession = {
			guildId,
			voiceChannelId,
			query,
			state: "initializing",
			startTime: new Date(),
			provider,
			// Enhanced fields
			playbackState: undefined,
			searchResults: undefined,
		};

		this.activeSessions.set(guildId, session);
		return session;
	}

	/**
	 * Get active session for a guild
	 */
	public getSession(guildId: Snowflake): StreamSession | null {
		return this.activeSessions.get(guildId) || null;
	}

	/**
	 * Update session state
	 */
	public updateState(
		guildId: Snowflake,
		state: StreamState
	): void {
		const session = this.activeSessions.get(guildId);
		if (session) {
			session.state = state;
		}
	}

	/**
	 * Update session search result
	 */
	public setSearchResult(
		guildId: Snowflake,
		result: SearchResult
	): void {
		const session = this.activeSessions.get(guildId);
		if (session) {
			session.searchResult = result;
		}
	}

	/**
	 * Cache search results for fuzzy selection
	 */
	public setSearchResults(
		guildId: Snowflake,
		results: SearchResult[]
	): void {
		const session = this.activeSessions.get(guildId);
		if (session) {
			(session as any).searchResults = results;
		}
	}

	/**
	 * Get cached search results
	 */
	public getSearchResults(guildId: Snowflake): SearchResult[] | undefined {
		const session = this.activeSessions.get(guildId);
		return (session as any)?.searchResults;
	}

	/**
	 * Update playback state
	 */
	public updatePlaybackState(
		guildId: Snowflake,
		playbackState: PlaybackState
	): void {
		const session = this.activeSessions.get(guildId);
		if (session) {
			(session as any).playbackState = playbackState;
		}
	}

	/**
	 * Get playback state
	 */
	public getPlaybackState(guildId: Snowflake): PlaybackState | undefined {
		const session = this.activeSessions.get(guildId);
		return (session as any)?.playbackState;
	}

	/**
	 * Set session page
	 */
	public setPage(guildId: Snowflake, page: Page): void {
		const session = this.activeSessions.get(guildId);
		if (session) {
			session.page = page;
		}
	}

	/**
	 * Set session error
	 */
	public setError(guildId: Snowflake, error: string): void {
		const session = this.activeSessions.get(guildId);
		if (session) {
			session.error = error;
			session.state = "error";
		}
	}

	/**
	 * Remove session
	 */
	public removeSession(guildId: Snowflake): void {
		this.activeSessions.delete(guildId);
	}

	/**
	 * Check if a session exists
	 */
	public hasSession(guildId: Snowflake): boolean {
		return this.activeSessions.has(guildId);
	}

	/**
	 * Get all active sessions
	 */
	public getAllSessions(): StreamSession[] {
		return Array.from(this.activeSessions.values());
	}
}

