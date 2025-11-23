import {
	createAudioResource,
	AudioPlayerStatus,
	type AudioPlayer,
	StreamType,
} from "@discordjs/voice";
import { spawn } from "node:child_process";
import type { MediaTrack } from "./types.js";
import { PlaybackState } from "./types.js";

/**
 * Controls audio playback for media player
 */
export class PlaybackController {
	private player: AudioPlayer;
	private currentTrack: MediaTrack | null = null;
	private state: PlaybackState = PlaybackState.IDLE;
	private volume: number = 100;
	private position: number = 0;
	private positionUpdateInterval?: NodeJS.Timeout;
	private onTrackEndCallback?: () => void;

	constructor(player: AudioPlayer) {
		this.player = player;

		// Listen for player state changes
		this.player.on("stateChange", (oldState, newState) => {
			if (newState.status === AudioPlayerStatus.Idle && oldState.status === AudioPlayerStatus.Playing) {
				this.state = PlaybackState.IDLE;
				this.stopPositionTracking();
				// Track ended
				if (this.onTrackEndCallback) {
					this.onTrackEndCallback();
				}
			} else if (newState.status === AudioPlayerStatus.Playing) {
				this.state = PlaybackState.PLAYING;
				this.startPositionTracking();
			} else if (newState.status === AudioPlayerStatus.Paused) {
				this.state = PlaybackState.PAUSED;
				this.stopPositionTracking();
			}
		});
	}

	/**
	 * Play a track
	 */
	async play(track: MediaTrack): Promise<void> {
		try {
			this.currentTrack = track;
			this.position = 0;

			const videoUrl = `https://www.youtube.com/watch?v=${track.id}`;

			// Use yt-dlp to get audio and pipe through ffmpeg to convert to Opus
			// Spawn yt-dlp process
			const ytdlpProcess = spawn("yt-dlp", [
				"-f",
				"bestaudio",
				"-o",
				"-",
				videoUrl,
			]);

			// Spawn ffmpeg to convert to PCM format (s16le - signed 16-bit little-endian)
			// Discord.js voice works best with raw PCM at 48kHz stereo
			const ffmpegProcess = spawn("ffmpeg", [
				"-i",
				"pipe:0", // Input from stdin
				"-f",
				"s16le", // Output PCM format (signed 16-bit little-endian)
				"-ar",
				"48000", // 48kHz sample rate (Discord requirement)
				"-ac",
				"2", // Stereo
				"pipe:1", // Output to stdout
			]);

			// Pipe yt-dlp output to ffmpeg input
			ytdlpProcess.stdout?.pipe(ffmpegProcess.stdin!);
			ytdlpProcess.stderr?.on("data", () => {
				// Suppress yt-dlp output
			});

			// Handle errors
			ytdlpProcess.on("error", (error) => {
				console.error("[PlaybackController] yt-dlp error:", error);
				this.player.stop();
			});

			ffmpegProcess.on("error", (error) => {
				console.error("[PlaybackController] ffmpeg error:", error);
				this.player.stop();
			});

			// Suppress ffmpeg stderr (info messages)
			ffmpegProcess.stderr?.on("data", () => {
				// Ignore ffmpeg output
			});

			if (!ffmpegProcess.stdout) {
				throw new Error("Failed to get ffmpeg stdout");
			}

			// Create audio resource from the PCM stream
			// Use Raw type for PCM audio (like the voice assistant does)
			const resource = createAudioResource(ffmpegProcess.stdout, {
				inputType: StreamType.Raw,
				inlineVolume: true,
			});

			// Set volume
			resource.volume?.setVolume(this.volume / 100);

			// Cleanup processes when done
			ffmpegProcess.on("close", () => {
				ytdlpProcess.kill();
			});

			// Play
			this.player.play(resource);
			this.state = PlaybackState.PLAYING;

			console.log(`[PlaybackController] Started playing: ${track.title}`);
		} catch (error) {
			console.error("[PlaybackController] Play error:", error);
			throw error;
		}
	}

	/**
	 * Pause playback
	 */
	pause(): void {
		if (this.state === PlaybackState.PLAYING) {
			this.player.pause();
			this.state = PlaybackState.PAUSED;
		}
	}

	/**
	 * Resume playback
	 */
	resume(): void {
		if (this.state === PlaybackState.PAUSED) {
			this.player.unpause();
			this.state = PlaybackState.PLAYING;
		}
	}

	/**
	 * Stop playback
	 */
	stop(): void {
		this.player.stop();
		this.state = PlaybackState.STOPPED;
		this.currentTrack = null;
		this.position = 0;
		this.stopPositionTracking();
	}

	/**
	 * Set volume (0-100)
	 */
	setVolume(volume: number): void {
		this.volume = Math.max(0, Math.min(100, volume));

		// Update volume on current resource if playing
		if (this.player.state.status === AudioPlayerStatus.Playing) {
			const resource = (this.player.state as any).resource;
			if (resource?.volume) {
				resource.volume.setVolume(this.volume / 100);
			}
		}
	}

	/**
	 * Get current volume
	 */
	getVolume(): number {
		return this.volume;
	}

	/**
	 * Get current track
	 */
	getCurrentTrack(): MediaTrack | null {
		return this.currentTrack;
	}

	/**
	 * Get current position in seconds
	 */
	getPosition(): number {
		return this.position;
	}

	/**
	 * Get playback state
	 */
	getState(): PlaybackState {
		return this.state;
	}

	/**
	 * Start tracking playback position
	 */
	private startPositionTracking(): void {
		this.stopPositionTracking();
		this.positionUpdateInterval = setInterval(() => {
			if (this.state === PlaybackState.PLAYING) {
				this.position += 1;
			}
		}, 1000);
	}

	/**
	 * Stop tracking playback position
	 */
	private stopPositionTracking(): void {
		if (this.positionUpdateInterval) {
			clearInterval(this.positionUpdateInterval);
			this.positionUpdateInterval = undefined;
		}
	}

	/**
	 * Set callback for when track ends
	 */
	setOnTrackEnd(callback: () => void): void {
		this.onTrackEndCallback = callback;
	}

	/**
	 * Get the underlying audio player
	 */
	getPlayer(): AudioPlayer {
		return this.player;
	}

	/**
	 * Cleanup
	 */
	cleanup(): void {
		this.stopPositionTracking();
		this.stop();
	}
}

