import { BaseProvider } from "./BaseProvider.js";
import type { Page } from "puppeteer";
import type { SearchResult } from "../types.js";
import { STREAM_CONSTANTS } from "../constants.js";
import { config } from "../../../config/index.js";

/**
 * Provider for Jellyfin streaming
 * Uses Jellyfin REST API for search and web player for playback
 */
export class JellyfinProvider extends BaseProvider {
	private serverUrl: string;
	private apiKey: string;
	private userId?: string;

	constructor() {
		// Normalize server URL (remove trailing slash)
		const serverUrl = (config.jellyfinServerUrl || "").replace(/\/+$/, "");
		super("jellyfin", serverUrl, ["movie", "tv"]);

		if (!config.jellyfinServerUrl || !config.jellyfinApiKey) {
			console.warn(
				"[JellyfinProvider] Jellyfin server URL or API key not configured. Set JELLYFIN_SERVER_URL and JELLYFIN_API_KEY in .env"
			);
		}

		this.serverUrl = serverUrl;
		this.apiKey = config.jellyfinApiKey || "";
		this.userId = config.jellyfinUserId;
	}

	/**
	 * Search for content on Jellyfin using REST API
	 */
	async searchContent(query: string, page: Page): Promise<SearchResult[]> {
		try {
			if (!this.serverUrl || !this.apiKey) {
				throw new Error(
					"Jellyfin server URL and API key must be configured. Set JELLYFIN_SERVER_URL and JELLYFIN_API_KEY in .env"
				);
			}

			// Build API URL
			const apiUrl = `${this.serverUrl}/Items`;
			const searchParams = new URLSearchParams({
				searchTerm: query,
				IncludeItemTypes: "Movie,Series",
				Recursive: "true",
				Limit: "20",
				Fields: "PrimaryImageAspectRatio,BasicSyncInfo,CanDelete,PrimaryImageAspectRatio,ProductionYear,Status,EndDate",
			});

			const url = `${apiUrl}?${searchParams.toString()}`;

			// Make API request
			const response = await fetch(url, {
				method: "GET",
				headers: {
					"X-Emby-Authorization": `MediaBrowser Client="ArcadosBot", Device="Discord Bot", DeviceId="arcados-bot", Version="1.0.0", Token="${this.apiKey}"`,
					"Content-Type": "application/json",
				},
			});

			if (!response.ok) {
				throw new Error(
					`Jellyfin API request failed: ${response.status} ${response.statusText}`
				);
			}

			const data = await response.json();
			const items = data.Items || [];

			// Convert Jellyfin items to SearchResult format
			const results: SearchResult[] = items.map((item: any) => {
				// Determine type
				let type: "movie" | "tv" | "unknown" = "unknown";
				if (item.Type === "Movie") {
					type = "movie";
				} else if (item.Type === "Series") {
					type = "tv";
				}

				// Build thumbnail URL
				let thumbnailUrl: string | undefined;
				if (item.ImageTags?.Primary) {
					thumbnailUrl = `${this.serverUrl}/Items/${item.Id}/Images/Primary?maxHeight=300&tag=${item.ImageTags.Primary}`;
				}

				// Build web player URL
				const webUrl = `${this.serverUrl}/web/index.html#!/details?id=${item.Id}`;

				// Extract year
				const year = item.ProductionYear || item.PremiereDate
					? new Date(item.PremiereDate || item.ProductionYear).getFullYear()
					: undefined;

				// Build description
				const descriptionParts: string[] = [];
				if (item.Overview) {
					descriptionParts.push(item.Overview.substring(0, 100));
				}
				if (item.ProductionYear) {
					descriptionParts.push(`Year: ${item.ProductionYear}`);
				}

				return {
					title: item.Name || "Unknown",
					year,
					type,
					url: webUrl,
					thumbnailUrl,
					description:
						descriptionParts.length > 0
							? descriptionParts.join(" • ")
							: undefined,
					// Store Jellyfin item ID for navigation
					...(item.Id && { itemId: item.Id }),
				} as SearchResult & { itemId?: string };
			});

			if (results.length === 0) {
				console.warn(
					`[JellyfinProvider] No search results found for query: ${query}`
				);
			}

			return results;
		} catch (error) {
			console.error(
				`[JellyfinProvider] Search failed for query "${query}":`,
				error
			);
			throw error;
		}
	}

	/**
	 * Navigate to Jellyfin web player page
	 */
	async navigateToContent(result: SearchResult, page: Page): Promise<Page> {
		try {
			// Extract item ID from URL or result
			const itemId =
				(result as any).itemId ||
				result.url.match(/id=([^&]+)/)?.[1];

			if (!itemId) {
				throw new Error("Could not extract Jellyfin item ID from result");
			}

			// Navigate to web player
			const webUrl = `${this.serverUrl}/web/index.html#!/details?id=${itemId}`;
			await page.goto(webUrl, {
				waitUntil: "networkidle2",
				timeout: STREAM_CONSTANTS.NAVIGATION_TIMEOUT,
			});

			// Wait for Jellyfin web app to load
			await new Promise((resolve) => setTimeout(resolve, 3000));

			// Close any popups
			await this.closePopups(page);

			// Wait a bit more for page to fully load
			await new Promise((resolve) => setTimeout(resolve, 2000));

			return page;
		} catch (error) {
			console.error(
				`[JellyfinProvider] Failed to navigate to ${result.url}:`,
				error
			);
			throw error;
		}
	}

	/**
	 * Wait for video player to be ready
	 */
	async waitForPlayer(page: Page): Promise<void> {
		try {
			console.log("[JellyfinProvider] Waiting for video player to appear...");

			// Wait for Jellyfin player to load
			await new Promise((resolve) => setTimeout(resolve, 3000));

			// Wait for video element or Jellyfin player container
			await page
				.waitForSelector("video, [class*='videoPlayer'], [class*='player']", {
					timeout: STREAM_CONSTANTS.PLAYER_DETECTION_TIMEOUT,
				})
				.catch(() => {
					console.warn(
						"[JellyfinProvider] Video player element not found with standard selectors"
					);
				});

			// Wait a bit more for any dynamic content to load
			await new Promise((resolve) => setTimeout(resolve, 2000));
		} catch (error) {
			console.error("[JellyfinProvider] Failed to wait for player:", error);
			// Don't throw - continue anyway, clickPlay will try to find and play video
		}
	}

	/**
	 * Click play button or video element to start playback
	 * Simple play logic (no aggressive retries like MoviesProvider)
	 */
	async clickPlay(page: Page): Promise<void> {
		try {
			console.log("[JellyfinProvider] Attempting to start video playback...");

			// Close popups first
			await this.closePopups(page);

			// Wait a bit for page to settle
			await new Promise((resolve) => setTimeout(resolve, 1500));

			// Try to find and click the play button or video element
			const playResult = await page.evaluate(() => {
				// First, try to find the main video element
				const video = document.querySelector("video") as HTMLVideoElement;

				if (video) {
					// Try clicking the video element first
					video.click();

					// Also try programmatic play
					video.play().catch(() => {
						video.click();
					});

					return { success: true, method: "video-click", isPlaying: !video.paused };
				}

				// Try to find play buttons
				const playSelectors = [
					"button[aria-label*='play' i]",
					".play-button",
					"[class*='play'][class*='button']",
					"[id*='play']",
					"button:has-text('Play')",
				];

				for (const selector of playSelectors) {
					try {
						const element = document.querySelector(selector) as HTMLElement;
						if (element && element.offsetParent !== null) {
							element.click();
							return { success: true, method: `button-${selector}`, isPlaying: false };
						}
					} catch (e) {
						continue;
					}
				}

				// Try clicking center of page (where video players usually are)
				const centerX = window.innerWidth / 2;
				const centerY = window.innerHeight / 2;
				const elementAtCenter = document.elementFromPoint(centerX, centerY);
				if (elementAtCenter) {
					(elementAtCenter as HTMLElement).click();
					return { success: true, method: "center-click", isPlaying: false };
				}

				return { success: false, method: "none", isPlaying: false };
			});

			console.log(`[JellyfinProvider] Play attempt result:`, playResult);

			// Wait a bit for playback to start
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Verify video is actually playing
			const isPlaying = await page.evaluate(() => {
				const video = document.querySelector("video") as HTMLVideoElement;
				if (video) {
					return !video.paused && video.readyState >= 2 && video.currentTime > 0;
				}
				return false;
			});

			if (isPlaying) {
				console.log("[JellyfinProvider] ✅ Video is playing successfully!");
			} else {
				console.warn(
					"[JellyfinProvider] ⚠️ Could not confirm video playback, but continuing..."
				);
			}
		} catch (error) {
			console.error("[JellyfinProvider] Failed to click play:", error);
			// Don't throw - continue anyway, streaming might still work
		}
	}

	/**
	 * Enter fullscreen mode
	 */
	async enterFullscreen(page: Page): Promise<void> {
		try {
			await page.evaluate(() => {
				const video = document.querySelector("video") as HTMLVideoElement;
				if (video && video.requestFullscreen) {
					video.requestFullscreen().catch((err) => {
						console.warn("Failed to enter fullscreen:", err);
					});
				}
			});
		} catch (error) {
			console.warn("[JellyfinProvider] Failed to enter fullscreen:", error);
			// Not critical, continue anyway
		}
	}

	/**
	 * Close popups and modals
	 */
	async closePopups(page: Page): Promise<void> {
		try {
			// Wait a bit for popups to appear
			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Try to close popups
			await page.evaluate(() => {
				// Close buttons
				const closeSelectors = [
					"button[aria-label*='close' i]",
					".close",
					".modal-close",
					"[class*='close']",
					"[class*='popup-close']",
					"[id*='close']",
					"[aria-label*='close' i]",
					"button:has-text('Close')",
					"button:has-text('×')",
					"button:has-text('X')",
					"[class*='dismiss']",
				];

				// Close all close buttons
				for (const selector of closeSelectors) {
					try {
						const elements = document.querySelectorAll(selector);
						for (const element of Array.from(elements)) {
							const el = element as HTMLElement;
							if (el.offsetParent !== null) {
								el.click();
							}
						}
					} catch (e) {
						continue;
					}
				}

				// Press Escape key to close any open dialogs
				document.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true })
				);
				document.dispatchEvent(
					new KeyboardEvent("keyup", { key: "Escape", keyCode: 27, bubbles: true })
				);
			});

			// Also try pressing Escape key via Puppeteer
			await page.keyboard.press("Escape");

			console.log("[JellyfinProvider] Popup closing attempt completed");
		} catch (error) {
			console.warn("[JellyfinProvider] Error closing popups:", error);
			// Not critical, continue anyway
		}
	}

	/**
	 * Check if content has ended
	 */
	async isContentEnded(page: Page): Promise<boolean> {
		try {
			return await page.evaluate(() => {
				const video = document.querySelector("video") as HTMLVideoElement;
				if (video) {
					return video.ended;
				}

				const audio = document.querySelector("audio") as HTMLAudioElement;
				if (audio) {
					return audio.ended;
				}

				return false;
			});
		} catch (error) {
			console.error("[JellyfinProvider] Error checking if content ended:", error);
			return false;
		}
	}

	/**
	 * Get current playback position (0-1)
	 */
	async getPlaybackPosition(page: Page): Promise<number> {
		try {
			return await page.evaluate(() => {
				const video = document.querySelector("video") as HTMLVideoElement;
				if (video && video.duration > 0) {
					return video.currentTime / video.duration;
				}

				const audio = document.querySelector("audio") as HTMLAudioElement;
				if (audio && audio.duration > 0) {
					return audio.currentTime / audio.duration;
				}

				return 0;
			});
		} catch (error) {
			console.error("[JellyfinProvider] Error getting playback position:", error);
			return 0;
		}
	}
}

