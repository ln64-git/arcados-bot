import type { Page } from "puppeteer";
import type { MediaElementInfo, ContentDetectionResult } from "../types.js";
import { STREAM_CONSTANTS } from "../constants.js";

/**
 * Service for detecting and monitoring media content in browser pages
 */
export class ContentDetectionService {
	/**
	 * Detect media element in the page
	 */
	async detectMediaElement(page: Page): Promise<ContentDetectionResult> {
		try {
			const mediaInfo = await page.evaluate(() => {
				// Look for video element
				const video = document.querySelector("video");
				if (video) {
					return {
						found: true,
						elementType: "video" as const,
						src: video.src || video.currentSrc || undefined,
						duration: video.duration || undefined,
						currentTime: video.currentTime || 0,
						paused: video.paused,
						ended: video.ended,
						readyState: video.readyState,
					};
				}

				// Look for audio element
				const audio = document.querySelector("audio");
				if (audio) {
					return {
						found: true,
						elementType: "audio" as const,
						src: audio.src || audio.currentSrc || undefined,
						duration: audio.duration || undefined,
						currentTime: audio.currentTime || 0,
						paused: audio.paused,
						ended: audio.ended,
						readyState: audio.readyState,
					};
				}

				// Look for iframe (embedded player)
				const iframe = document.querySelector("iframe");
				if (iframe) {
					return {
						found: true,
						elementType: "iframe" as const,
						src: iframe.src || undefined,
						duration: undefined,
						currentTime: undefined,
						paused: false,
						ended: false,
						readyState: 0,
					};
				}

				return {
					found: false,
					elementType: "video" as const,
					paused: true,
					ended: false,
					readyState: 0,
				};
			});

			return {
				found: mediaInfo.found,
				mediaElement: mediaInfo.found ? mediaInfo : undefined,
			};
		} catch (error) {
			return {
				found: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Wait for media element to be ready
	 */
	async waitForMediaReady(
		page: Page,
		timeout: number = STREAM_CONSTANTS.PLAYER_DETECTION_TIMEOUT
	): Promise<MediaElementInfo> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeout) {
			const result = await this.detectMediaElement(page);
			if (result.found && result.mediaElement) {
				const element = result.mediaElement;
				// Check if element is ready (readyState >= 2 means enough data to play)
				if (element.readyState >= 2) {
					return element;
				}
			}

			// Wait a bit before checking again
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		throw new Error("Media element not ready within timeout");
	}

	/**
	 * Monitor content playback and detect when it ends
	 */
	async monitorContentEnd(
		page: Page,
		onEnd: () => void,
		checkInterval: number = STREAM_CONSTANTS.VIDEO_CHECK_INTERVAL
	): Promise<void> {
		let lastPosition = 0;
		let stallCount = 0;

		const checkEnd = async () => {
			try {
				const result = await this.detectMediaElement(page);
				if (!result.found || !result.mediaElement) {
					return;
				}

				const element = result.mediaElement;

				// Check if content has ended
				if (element.ended) {
					onEnd();
					return;
				}

				// Check for stalls (no progress for a while)
				if (element.currentTime !== undefined) {
					if (element.currentTime === lastPosition && !element.paused) {
						stallCount++;
						if (stallCount * checkInterval >= STREAM_CONSTANTS.VIDEO_STALL_THRESHOLD) {
							console.warn("[ContentDetectionService] Content appears stalled");
							onEnd();
							return;
						}
					} else {
						stallCount = 0;
						lastPosition = element.currentTime;
					}
				}

				// Continue monitoring
				setTimeout(checkEnd, checkInterval);
			} catch (error) {
				console.error("[ContentDetectionService] Error monitoring content:", error);
				// Continue monitoring despite errors
				setTimeout(checkEnd, checkInterval);
			}
		};

		// Start monitoring
		checkEnd();
	}

	/**
	 * Inject end detection script into page
	 * This provides more reliable end detection
	 */
	async injectEndDetectionScript(page: Page): Promise<void> {
		await page.evaluate(() => {
			// Create a custom event that fires when content ends
			const video = document.querySelector("video");
			if (video) {
				video.addEventListener("ended", () => {
					window.dispatchEvent(new CustomEvent("streamContentEnded"));
				});

				video.addEventListener("error", (e) => {
					console.error("Video error:", e);
					window.dispatchEvent(new CustomEvent("streamContentError", { detail: e }));
				});
			}

			const audio = document.querySelector("audio");
			if (audio) {
				audio.addEventListener("ended", () => {
					window.dispatchEvent(new CustomEvent("streamContentEnded"));
				});

				audio.addEventListener("error", (e) => {
					console.error("Audio error:", e);
					window.dispatchEvent(new CustomEvent("streamContentError", { detail: e }));
				});
			}
		});
	}

	/**
	 * Wait for content end event
	 */
	async waitForContentEnd(page: Page): Promise<void> {
		return new Promise((resolve) => {
			page.evaluate(() => {
				return new Promise<void>((innerResolve) => {
					const video = document.querySelector("video");
					const audio = document.querySelector("audio");

					const handleEnd = () => {
						innerResolve();
					};

					if (video) {
						video.addEventListener("ended", handleEnd, { once: true });
					}

					if (audio) {
						audio.addEventListener("ended", handleEnd, { once: true });
					}

					// Timeout after 12 hours (max stream duration)
					setTimeout(() => {
						innerResolve();
					}, 43200000);
				});
			}).then(() => resolve());
		});
	}
}

