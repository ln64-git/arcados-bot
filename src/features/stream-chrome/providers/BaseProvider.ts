import type { Page } from "puppeteer";
import type { SearchResult, MediaType } from "../types.js";
import type {
	ProviderCapabilities,
	PlaybackResult,
	PlaybackState,
} from "../types/playback.js";

/**
 * Abstract base class for streaming providers
 * Each provider implements site-specific scraping logic
 */
export abstract class BaseProvider {
	protected name: string;
	protected baseUrl: string;
	protected supportedTypes: MediaType[];
	protected capabilities: ProviderCapabilities;

	constructor(
		name: string,
		baseUrl: string,
		supportedTypes: MediaType[] = ["movie", "tv"]
	) {
		this.name = name;
		this.baseUrl = baseUrl;
		this.supportedTypes = supportedTypes;
		// Default capabilities - providers should override
		this.capabilities = {
			pause: false,
			resume: false,
			seek: false,
			skip: false,
			restart: false,
			nextEpisode: false,
		};
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

	/**
	 * Get provider capabilities
	 * @returns Provider capabilities for playback operations
	 */
	getCapabilities(): ProviderCapabilities {
		return { ...this.capabilities };
	}

	/**
	 * Generic helper to control HTML5 video elements
	 * Works for all providers that use standard video elements
	 */
	protected async controlVideoElement(
		page: Page,
		action: "pause" | "play" | "seek",
		params?: { position?: number }
	): Promise<PlaybackResult> {
		try {
			const result = await page.evaluate(
				({ action, params }) => {
					const video = document.querySelector("video") as HTMLVideoElement;
					if (!video) {
						return {
							success: false,
							error: "No video element found",
						};
					}

					switch (action) {
						case "pause":
							video.pause();
							return {
								success: true,
								state: {
									paused: true,
									time: video.currentTime,
									duration: video.duration || 0,
									volume: video.volume,
								},
							};
						case "play":
							video.play();
							return {
								success: true,
								state: {
									paused: false,
									time: video.currentTime,
									duration: video.duration || 0,
									volume: video.volume,
								},
							};
						case "seek":
							if (params?.position !== undefined) {
								video.currentTime = params.position;
								return {
									success: true,
									state: {
										paused: video.paused,
										time: video.currentTime,
										duration: video.duration || 0,
										volume: video.volume,
									},
								};
							}
							return {
								success: false,
								error: "Seek position not provided",
							};
						default:
							return {
								success: false,
								error: `Unknown action: ${action}`,
							};
					}
				},
				{ action, params }
			);

			return result as PlaybackResult;
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to control video element",
			};
		}
	}

	/**
	 * Execute pause action
	 * Override in provider if custom logic needed
	 */
	protected async executePause(page: Page): Promise<PlaybackResult> {
		return await this.controlVideoElement(page, "pause");
	}

	/**
	 * Execute resume/play action
	 * Override in provider if custom logic needed
	 */
	protected async executeResume(page: Page): Promise<PlaybackResult> {
		return await this.controlVideoElement(page, "play");
	}

	/**
	 * Execute seek action
	 * @param page Puppeteer page instance
	 * @param position Position in seconds
	 */
	protected async executeSeek(
		page: Page,
		position: number
	): Promise<PlaybackResult> {
		return await this.controlVideoElement(page, "seek", { position });
	}

	/**
	 * Execute skip forward action
	 * @param page Puppeteer page instance
	 * @param seconds Number of seconds to skip forward
	 */
	protected async executeSkipForward(
		page: Page,
		seconds: number
	): Promise<PlaybackResult> {
		try {
			const result = await page.evaluate((seconds) => {
				const video = document.querySelector("video") as HTMLVideoElement;
				if (!video) {
					return {
						success: false,
						error: "No video element found",
					};
				}

				video.currentTime = Math.min(
					video.currentTime + seconds,
					video.duration || 0
				);

				return {
					success: true,
					state: {
						paused: video.paused,
						time: video.currentTime,
						duration: video.duration || 0,
						volume: video.volume,
					},
				};
			}, seconds);

			return result as PlaybackResult;
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to skip forward",
			};
		}
	}

	/**
	 * Execute skip backward action
	 * @param page Puppeteer page instance
	 * @param seconds Number of seconds to skip backward
	 */
	protected async executeSkipBackward(
		page: Page,
		seconds: number
	): Promise<PlaybackResult> {
		try {
			const result = await page.evaluate((seconds) => {
				const video = document.querySelector("video") as HTMLVideoElement;
				if (!video) {
					return {
						success: false,
						error: "No video element found",
					};
				}

				video.currentTime = Math.max(video.currentTime - seconds, 0);

				return {
					success: true,
					state: {
						paused: video.paused,
						time: video.currentTime,
						duration: video.duration || 0,
						volume: video.volume,
					},
				};
			}, seconds);

			return result as PlaybackResult;
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to skip backward",
			};
		}
	}

	/**
	 * Execute restart action (seek to beginning)
	 * Override in provider if custom logic needed
	 */
	protected async executeRestart(page: Page): Promise<PlaybackResult> {
		return await this.executeSeek(page, 0);
	}

	/**
	 * Execute next episode action
	 * Override in provider if supported
	 */
	protected async executeNextEpisode(page: Page): Promise<PlaybackResult> {
		return {
			success: false,
			error: "Next episode not supported by this provider",
		};
	}
}

