import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { MediaTrack } from "../types.js";
import type { User } from "discord.js";

const execAsync = promisify(exec);

/**
 * Service for searching YouTube and extracting audio URLs
 */
export class YouTubeService {
	private static instance: YouTubeService;

	private constructor() {}

	public static getInstance(): YouTubeService {
		if (!YouTubeService.instance) {
			YouTubeService.instance = new YouTubeService();
		}
		return YouTubeService.instance;
	}

	/**
	 * Search YouTube for a query and return the first result
	 */
	async search(query: string): Promise<MediaTrack | null> {
		try {
			// Use yt-dlp to search and get video info
			// Format: yt-dlp "ytsearch1:query" --dump-json
			const searchQuery = `ytsearch1:${query}`;
			const command = `yt-dlp "${searchQuery}" --dump-json --no-playlist --default-search ytsearch`;

			const { stdout } = await execAsync(command, {
				maxBuffer: 10 * 1024 * 1024, // 10MB buffer
			});

			const videoInfo = JSON.parse(stdout);

			if (!videoInfo || !videoInfo.id) {
				return null;
			}

			// Extract audio URL
			const audioUrl = await this.getAudioUrl(videoInfo.id);

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
		} catch (error) {
			console.error("[YouTubeService] Search error:", error);
			return null;
		}
	}

	/**
	 * Get audio stream URL for a YouTube video ID
	 * Returns a URL that can be used with createAudioResource
	 */
	async getAudioUrl(videoId: string): Promise<string> {
		try {
			// Use yt-dlp to get the best audio URL
			// Prefer opus format for Discord compatibility
			const command = `yt-dlp -f "bestaudio[ext=webm][acodec=opus]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio" -g "https://www.youtube.com/watch?v=${videoId}"`;

			const { stdout } = await execAsync(command, {
				maxBuffer: 10 * 1024 * 1024,
			});
			return stdout.trim();
		} catch (error) {
			console.error("[YouTubeService] Get audio URL error:", error);
			throw new Error(`Failed to get audio URL for video ${videoId}`);
		}
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

			const command = `yt-dlp "${videoUrl}" --dump-json --no-playlist`;

			const { stdout } = await execAsync(command, {
				maxBuffer: 10 * 1024 * 1024,
			});

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

