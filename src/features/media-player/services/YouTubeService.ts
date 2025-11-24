import { spawn } from "node:child_process";
import type { MediaTrack } from "../types.js";
import type { User } from "discord.js";

/**
 * Execute yt-dlp command safely using spawn with array arguments
 * This prevents shell injection attacks
 */
function execYtDlp(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const process = spawn("yt-dlp", args);
		let stdout = "";
		let stderr = "";

		process.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		process.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		process.on("error", (error) => {
			reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
		});

		process.on("close", (code) => {
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(
					new Error(`yt-dlp exited with code ${code}: ${stderr || "Unknown error"}`),
				);
			}
		});

		// Add 30 second timeout
		const timeout = setTimeout(() => {
			process.kill("SIGKILL");
			reject(new Error("yt-dlp command timed out after 30 seconds"));
		}, 30000);

		process.on("close", () => {
			clearTimeout(timeout);
		});
	});
}

/**
 * Service for searching YouTube and extracting audio URLs
 */
export class YouTubeService {
	private static instance: YouTubeService;
	private readonly maxRetries = 3;
	private readonly retryDelayMs = 1000;

	private constructor() {}

	public static getInstance(): YouTubeService {
		if (!YouTubeService.instance) {
			YouTubeService.instance = new YouTubeService();
		}
		return YouTubeService.instance;
	}

	/**
	 * Retry helper with exponential backoff
	 */
	private async retry<T>(
		operation: () => Promise<T>,
		operationName: string,
	): Promise<T> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error as Error;

				if (attempt === this.maxRetries) {
					break; // Don't wait after last attempt
				}

				// Exponential backoff: 1s, 2s, 4s
				const delayMs = this.retryDelayMs * Math.pow(2, attempt - 1);
				console.warn(
					`[YouTubeService] ${operationName} failed (attempt ${attempt}/${this.maxRetries}), retrying in ${delayMs}ms...`,
				);
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
		}

		throw lastError;
	}

	/**
	 * Search YouTube for a query and return the first result
	 */
	async search(query: string): Promise<MediaTrack | null> {
		try {
			return await this.retry(async () => {
				// Use yt-dlp to search and get video info
				// Using array arguments to prevent shell injection
				const searchQuery = `ytsearch1:${query}`;
				const stdout = await execYtDlp([
					searchQuery,
					"--dump-json",
					"--no-playlist",
					"--default-search",
					"ytsearch",
				]);

				const videoInfo = JSON.parse(stdout);

				if (!videoInfo || !videoInfo.id) {
					return null;
				}

				// Extract audio URL (without retry, since the whole operation will retry)
				const audioUrl = await this.getAudioUrlInternal(videoInfo.id);

				return {
					id: videoInfo.id,
					title: videoInfo.title || "Unknown Title",
					url: `https://www.youtube.com/watch?v=${videoInfo.id}`,
					thumbnail:
						videoInfo.thumbnail ||
						`https://img.youtube.com/vi/${videoInfo.id}/maxresdefault.jpg`,
					duration: videoInfo.duration || 0,
					durationFormatted: this.formatDuration(videoInfo.duration || 0),
					channel: videoInfo.channel || videoInfo.uploader || "Unknown Channel",
					queuedBy: null as any, // Will be set by caller
					queuedAt: new Date(),
				};
			}, `Search for "${query}"`);
		} catch (error) {
			console.error("[YouTubeService] Search error after retries:", error);
			return null;
		}
	}

	/**
	 * Get audio stream URL for a YouTube video ID (with retry)
	 * Returns a URL that can be used with createAudioResource
	 */
	async getAudioUrl(videoId: string): Promise<string> {
		try {
			return await this.retry(
				async () => this.getAudioUrlInternal(videoId),
				`Get audio URL for ${videoId}`,
			);
		} catch (error) {
			console.error("[YouTubeService] Get audio URL error after retries:", error);
			throw new Error(`Failed to get audio URL for video ${videoId}`);
		}
	}

	/**
	 * Internal method to get audio URL (without retry)
	 */
	private async getAudioUrlInternal(videoId: string): Promise<string> {
		// Use yt-dlp to get the best audio URL
		// Prefer opus format for Discord compatibility
		const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
		const stdout = await execYtDlp([
			"-f",
			"bestaudio[ext=webm][acodec=opus]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
			"-g",
			videoUrl,
		]);
		return stdout.trim();
	}

	/**
	 * Get video info from URL or ID
	 */
	async getVideoInfo(urlOrId: string): Promise<MediaTrack | null> {
		try {
			// Normalize URL
			let videoUrl = urlOrId;
			if (!urlOrId.includes("youtube.com") && !urlOrId.includes("youtu.be")) {
				videoUrl = `https://www.youtube.com/watch?v=${urlOrId}`;
			}

			const stdout = await execYtDlp([videoUrl, "--dump-json", "--no-playlist"]);

			const videoInfo = JSON.parse(stdout);

			if (!videoInfo || !videoInfo.id) {
				return null;
			}

			const audioUrl = await this.getAudioUrl(videoInfo.id);

			return {
				id: videoInfo.id,
				title: videoInfo.title || "Unknown Title",
				url: videoUrl,
				thumbnail:
					videoInfo.thumbnail ||
					`https://img.youtube.com/vi/${videoInfo.id}/maxresdefault.jpg`,
				duration: videoInfo.duration || 0,
				durationFormatted: this.formatDuration(videoInfo.duration || 0),
				channel: videoInfo.channel || videoInfo.uploader || "Unknown Channel",
				queuedBy: null as any,
				queuedAt: new Date(),
			};
		} catch (error) {
			console.error("[YouTubeService] Get video info error:", error);
			return null;
		}
	}

	/**
	 * Format duration in seconds to MM:SS or HH:MM:SS
	 */
	private formatDuration(seconds: number): string {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
				.toString()
				.padStart(2, "0")}`;
		}

		return `${minutes}:${secs.toString().padStart(2, "0")}`;
	}
}

