import type { Page } from "puppeteer";
import type { SearchResult, MediaType } from "../types.js";

/**
 * Abstract base class for streaming providers
 * Each provider implements site-specific scraping logic
 */
export abstract class BaseProvider {
	protected name: string;
	protected baseUrl: string;
	protected supportedTypes: MediaType[];

	constructor(name: string, baseUrl: string, supportedTypes: MediaType[] = ["movie", "tv"]) {
		this.name = name;
		this.baseUrl = baseUrl;
		this.supportedTypes = supportedTypes;
	}

	/**
	 * Get provider name
	 */
	getName(): string {
		return this.name;
	}

	/**
	 * Get base URL
	 */
	getBaseUrl(): string {
		return this.baseUrl;
	}

	/**
	 * Get supported media types
	 */
	getSupportedTypes(): MediaType[] {
		return this.supportedTypes;
	}

	/**
	 * Search for content on the provider's site
	 * @param query Search query
	 * @param page Puppeteer page instance
	 * @returns Array of search results
	 */
	abstract searchContent(query: string, page: Page): Promise<SearchResult[]>;

	/**
	 * Navigate to a specific content page
	 * @param result Search result to navigate to
	 * @param page Puppeteer page instance
	 * @returns Updated page after navigation
	 */
	abstract navigateToContent(result: SearchResult, page: Page): Promise<Page>;

	/**
	 * Wait for the video player to be ready
	 * @param page Puppeteer page instance
	 */
	abstract waitForPlayer(page: Page): Promise<void>;

	/**
	 * Click the play button to start playback
	 * @param page Puppeteer page instance
	 */
	abstract clickPlay(page: Page): Promise<void>;

	/**
	 * Enter fullscreen mode
	 * @param page Puppeteer page instance
	 */
	abstract enterFullscreen(page: Page): Promise<void>;

	/**
	 * Close any popups or ads that might be blocking the player
	 * @param page Puppeteer page instance
	 */
	abstract closePopups(page: Page): Promise<void>;

	/**
	 * Check if content has ended
	 * @param page Puppeteer page instance
	 * @returns True if content has ended
	 */
	abstract isContentEnded(page: Page): Promise<boolean>;

	/**
	 * Get current playback position (0-1)
	 * @param page Puppeteer page instance
	 * @returns Current position as a ratio (0 = start, 1 = end)
	 */
	abstract getPlaybackPosition(page: Page): Promise<number>;
}

