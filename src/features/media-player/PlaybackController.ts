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
	private activeProcesses: {
		ytdlp?: ReturnType<typeof spawn>;
		ffmpeg?: ReturnType<typeof spawn>;
		timeout?: NodeJS.Timeout;
	} = {};

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
			// Clean up any existing processes first
			this.killActiveProcesses();

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

			// Store active processes for cleanup
			this.activeProcesses.ytdlp = ytdlpProcess;
			this.activeProcesses.ffmpeg = ffmpegProcess;

			// Unified cleanup function
			const cleanup = (reason?: string) => {
				if (reason) {
					console.error(`[PlaybackController] Cleaning up processes: ${reason}`);
				}
				this.killActiveProcesses();
			};

			// Set 30-second timeout for startup
			this.activeProcesses.timeout = setTimeout(() => {
				cleanup("30-second timeout exceeded");
				this.player.stop();
			}, 30000);

			// Pipe yt-dlp output to ffmpeg input
			ytdlpProcess.stdout?.pipe(ffmpegProcess.stdin!);
			ytdlpProcess.stderr?.on("data", () => {
				// Suppress yt-dlp output
			});

			// Handle errors
			ytdlpProcess.on("error", (error) => {
				const errorMsg = error.message.toLowerCase();
				if (errorMsg.includes("enoent") || errorMsg.includes("not found")) {
					console.error("[PlaybackController] yt-dlp not found - please install yt-dlp");
				} else if (errorMsg.includes("econnrefused") || errorMsg.includes("network")) {
					console.error("[PlaybackController] Network error while downloading audio");
				} else {
					console.error("[PlaybackController] yt-dlp error:", error);
				}
				cleanup("yt-dlp error");
				this.player.stop();
			});

			ffmpegProcess.on("error", (error) => {
				const errorMsg = error.message.toLowerCase();
				if (errorMsg.includes("enoent") || errorMsg.includes("not found")) {
					console.error("[PlaybackController] ffmpeg not found - please install ffmpeg");
				} else {
					console.error("[PlaybackController] ffmpeg error:", error);
				}
				cleanup("ffmpeg error");
				this.player.stop();
			});

			// Handle unexpected exits
			ytdlpProcess.on("exit", (code) => {
				if (code !== 0 && code !== null) {
					console.error(`[PlaybackController] yt-dlp exited with code ${code}`);
					cleanup("yt-dlp unexpected exit");
					this.player.stop();
				}
			});

			ffmpegProcess.on("exit", (code) => {
				if (code !== 0 && code !== null && this.state === PlaybackState.PLAYING) {
					console.error(`[PlaybackController] ffmpeg exited with code ${code}`);
					cleanup("ffmpeg unexpected exit");
					this.player.stop();
				}
			});

			// Suppress ffmpeg stderr (info messages)
			ffmpegProcess.stderr?.on("data", () => {
				// Ignore ffmpeg output
			});

			if (!ffmpegProcess.stdout) {
				throw new Error("Failed to get ffmpeg stdout");
			}

			// Create audio resource from the PCM stream
			const resource = createAudioResource(ffmpegProcess.stdout, {
				inputType: StreamType.Raw,
				inlineVolume: true,
			});

			// Set volume
			resource.volume?.setVolume(this.volume / 100);

			// Cleanup processes when done normally
			ffmpegProcess.on("close", () => {
				cleanup();
			});

			// Play
			this.player.play(resource);
			this.state = PlaybackState.PLAYING;

			console.log(`[PlaybackController] Started playing: ${track.title}`);
		} catch (error) {
			console.error("[PlaybackController] Play error:", error);
			this.killActiveProcesses();
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
	 * Seek to a specific position in the current track (in seconds)
	 * This restarts playback from the specified position
	 */
	async seek(positionSeconds: number): Promise<void> {
		if (!this.currentTrack) {
			throw new Error("No track is currently playing");
		}

		// Clamp position to valid range
		const clampedPosition = Math.max(
			0,
			Math.min(positionSeconds, this.currentTrack.duration),
		);

		try {
			// Clean up existing processes
			this.killActiveProcesses();

			const videoUrl = `https://www.youtube.com/watch?v=${this.currentTrack.id}`;

			// Use yt-dlp with ffmpeg seeking
			// Note: -ss before -i is faster (input seeking) but less accurate
			// -ss after -i is slower but more accurate
			const ytdlpProcess = spawn("yt-dlp", ["-f", "bestaudio", "-o", "-", videoUrl]);

			// Use ffmpeg with -ss to seek to position and convert to Opus
			const ffmpegProcess = spawn("ffmpeg", [
				"-ss",
				clampedPosition.toString(), // Seek to this position
				"-i",
				"pipe:0",
				"-loglevel",
				"error",
				"-af",
				"aresample=async=1:min_hard_comp=0.100000:first_pts=0",
				"-ar",
				"48000",
				"-ac",
				"2",
				"-f",
				"opus",
				"-b:a",
				"128k",
				"-vbr",
				"off",
				"-compression_level",
				"10",
				"-frame_duration",
				"20",
				"-application",
				"audio",
				"-packet_loss",
				"3",
				"-bufsize",
				"512k",
				"pipe:1",
			]);

			// Store active processes
			this.activeProcesses.ytdlp = ytdlpProcess;
			this.activeProcesses.ffmpeg = ffmpegProcess;

			// Unified cleanup
			const cleanup = (reason?: string) => {
				if (reason) {
					console.error(`[PlaybackController] Cleaning up seek processes: ${reason}`);
				}
				this.killActiveProcesses();
			};

			// Set timeout
			this.activeProcesses.timeout = setTimeout(() => {
				cleanup("30-second timeout exceeded during seek");
				this.player.stop();
			}, 30000);

			// Pipe streams
			ytdlpProcess.stdout?.pipe(ffmpegProcess.stdin!);
			ytdlpProcess.stderr?.on("data", () => {});

			// Error handlers
			ytdlpProcess.on("error", (error) => {
				console.error("[PlaybackController] yt-dlp seek error:", error);
				cleanup("yt-dlp error");
				this.player.stop();
			});

			ffmpegProcess.on("error", (error) => {
				console.error("[PlaybackController] ffmpeg seek error:", error);
				cleanup("ffmpeg error");
				this.player.stop();
			});

			ytdlpProcess.on("exit", (code) => {
				if (code !== 0 && code !== null) {
					console.error(`[PlaybackController] yt-dlp exited with code ${code}`);
					cleanup("yt-dlp unexpected exit");
					this.player.stop();
				}
			});

			ffmpegProcess.on("exit", (code) => {
				if (code !== 0 && code !== null && this.state === PlaybackState.PLAYING) {
					console.error(`[PlaybackController] ffmpeg exited with code ${code}`);
					cleanup("ffmpeg unexpected exit");
					this.player.stop();
				}
			});

			ffmpegProcess.stderr?.on("data", () => {});

			if (!ffmpegProcess.stdout) {
				throw new Error("Failed to get ffmpeg stdout");
			}

			// Create audio resource from PCM stream
			const resource = createAudioResource(ffmpegProcess.stdout, {
				inputType: StreamType.Raw,
				inlineVolume: true,
			});

			resource.volume?.setVolume(this.volume / 100);

			// Normal cleanup
			ffmpegProcess.on("close", () => {
				cleanup();
			});

			// Update position and play
			this.position = clampedPosition;
			this.player.play(resource);
			this.state = PlaybackState.PLAYING;

			console.log(
				`[PlaybackController] Seeked to ${clampedPosition}s in: ${this.currentTrack.title}`,
			);
		} catch (error) {
			console.error("[PlaybackController] Seek error:", error);
			this.killActiveProcesses();
			throw error;
		}
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
	 * Kill all active processes (yt-dlp, ffmpeg, timeout)
	 */
	private killActiveProcesses(): void {
		// Clear timeout
		if (this.activeProcesses.timeout) {
			clearTimeout(this.activeProcesses.timeout);
			this.activeProcesses.timeout = undefined;
		}

		// Kill yt-dlp process
		if (this.activeProcesses.ytdlp) {
			try {
				this.activeProcesses.ytdlp.kill("SIGKILL");
			} catch (error) {
				// Process might already be dead
			}
			this.activeProcesses.ytdlp = undefined;
		}

		// Kill ffmpeg process
		if (this.activeProcesses.ffmpeg) {
			try {
				this.activeProcesses.ffmpeg.kill("SIGKILL");
			} catch (error) {
				// Process might already be dead
			}
			this.activeProcesses.ffmpeg = undefined;
		}
	}

	/**
	 * Cleanup
	 */
	cleanup(): void {
		this.killActiveProcesses();
		this.stopPositionTracking();
		this.stop();
	}
}

