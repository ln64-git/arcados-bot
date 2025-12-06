import type { PlaybackState } from "../types/playback.js";

/**
 * Format duration in seconds to human-readable string
 * @param seconds Duration in seconds
 * @returns Formatted string like "1h 30m 15s" or "5m 30s"
 */
export function formatDuration(seconds: number): string {
	if (seconds < 0) {
		return "0s";
	}

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	const parts: string[] = [];
	if (hours > 0) {
		parts.push(`${hours}h`);
	}
	if (minutes > 0) {
		parts.push(`${minutes}m`);
	}
	if (secs > 0 || parts.length === 0) {
		parts.push(`${secs}s`);
	}

	return parts.join(" ");
}

/**
 * Format time position (current time / duration)
 * @param currentTime Current time in seconds
 * @param duration Total duration in seconds
 * @returns Formatted string like "5:30 / 1:30:00"
 */
export function formatTimePosition(
	currentTime: number,
	duration: number
): string {
	const formatTime = (seconds: number): string => {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);

		if (hours > 0) {
			return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
		}
		return `${minutes}:${String(secs).padStart(2, "0")}`;
	};

	return `${formatTime(currentTime)} / ${formatTime(duration)}`;
}

/**
 * Format playback state for display
 * @param state Playback state
 * @returns Human-readable status string
 */
export function formatPlaybackState(state: PlaybackState): string {
	const status = state.paused ? "⏸️ Paused" : "▶️ Playing";
	const position = formatTimePosition(state.currentTime, state.duration);
	return `${status} - ${position}`;
}

