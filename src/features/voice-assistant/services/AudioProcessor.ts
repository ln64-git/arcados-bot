import type { AudioChunk } from "../types.js";
import { AUDIO_CONSTANTS } from "../constants.js";

/**
 * Processes raw Discord audio streams into chunks for transcription
 * Handles buffering, silence detection, and chunk assembly
 */
interface BufferState {
	chunks: Buffer[];
	totalBytes: number;
	softThrottleActive?: boolean;
	lastSoftWarning?: number;
	throttledUntil?: number;
	flushTimestamps: number[];
}

export class AudioProcessor {
	private static instance: AudioProcessor;
	private readonly logger = console;

	// Audio configuration (from centralized constants)
	private readonly SAMPLE_RATE = AUDIO_CONSTANTS.SAMPLE_RATE;
	private readonly CHANNELS = AUDIO_CONSTANTS.CHANNELS;
	private readonly CHUNK_DURATION_MS = AUDIO_CONSTANTS.CHUNK_DURATION_MS;
	private readonly SILENCE_DURATION_MS = AUDIO_CONSTANTS.SILENCE_DURATION_MS;
	private readonly MAX_BUFFER_DURATION_MS = AUDIO_CONSTANTS.MAX_BUFFER_DURATION_MS;
	private readonly MAX_BUFFER_SIZE_BYTES = AUDIO_CONSTANTS.MAX_BUFFER_SIZE_BYTES;

	// Buffers per session
	private bufferStates: Map<string, BufferState> = new Map();
	private lastAudioTime: Map<string, number> = new Map();

	private constructor() {}

	public static getInstance(): AudioProcessor {
		if (!AudioProcessor.instance) {
			AudioProcessor.instance = new AudioProcessor();
		}
		return AudioProcessor.instance;
	}

	/**
	 * Process incoming audio data from Discord
	 *
	 * @param sessionId Voice session ID
	 * @param audioData Raw PCM audio data from Discord
	 * @returns Audio chunk if ready for transcription, null otherwise
	 */
	public processAudio(sessionId: string, audioData: Buffer): AudioChunk | null {
		const state = this.getOrCreateState(sessionId);
		const now = Date.now();

		// Respect temporary throttling if we hit repeated flushes
		if (state.throttledUntil && now < state.throttledUntil) {
			return null;
		}

		state.chunks.push(audioData);
		state.totalBytes += audioData.length;

		// Update last audio time
		this.lastAudioTime.set(sessionId, now);

		// Apply soft backpressure before we hit the hard limits
		this.applySoftBackpressure(sessionId, state);

		// Calculate total buffered duration
		const durationMs = this.bytesToDuration(state.totalBytes);

		// Check duration limit
		if (durationMs >= this.MAX_BUFFER_DURATION_MS) {
			return this.forceFlush(sessionId, state, "duration");
		}

		// Check buffer size limit
		if (state.totalBytes >= this.MAX_BUFFER_SIZE_BYTES) {
			return this.forceFlush(sessionId, state, "size");
		}

		const effectiveChunkDuration = this.getEffectiveChunkDuration(durationMs);

		// Check if we have enough audio for a chunk
		if (durationMs >= effectiveChunkDuration) {
			this.logger?.debug?.(
				`[AudioProcessor] Creating chunk for session ${sessionId} (duration ${durationMs.toFixed(
					0
				)}ms, bytes ${state.totalBytes})`
			);
			return this.sliceChunk(sessionId, state, effectiveChunkDuration);
		}

		return null;
	}

	/**
	 * Check if silence has been detected (end of utterance)
	 *
	 * @param sessionId Voice session ID
	 * @returns True if silence detected
	 */
	public isSilenceDetected(sessionId: string): boolean {
		const lastTime = this.lastAudioTime.get(sessionId);
		if (!lastTime) {
			return false;
		}

		const state = this.bufferStates.get(sessionId);
		const silenceDuration = Date.now() - lastTime;
		const silenceThreshold = state?.softThrottleActive
			? Math.max(500, this.SILENCE_DURATION_MS * 0.5)
			: this.SILENCE_DURATION_MS;

		return silenceDuration >= silenceThreshold;
	}

	/**
	 * Flush buffered audio and create final chunk
	 * Used when silence is detected or session ends
	 *
	 * @param sessionId Voice session ID
	 * @returns Audio chunk with all buffered data, or null if buffer is empty
	 */
	public flushBuffer(sessionId: string): AudioChunk | null {
		const state = this.bufferStates.get(sessionId);
		if (!state || state.totalBytes === 0) {
			return null;
		}

		const chunk = this.takeBytes(sessionId, state, state.totalBytes);
		this.bufferStates.delete(sessionId);
		this.lastAudioTime.delete(sessionId);

		return chunk;
	}

	/**
	 * Create an audio chunk from buffered data
	 *
	 * @param sessionId Voice session ID
	 * @returns Audio chunk ready for transcription
	 */
	private sliceChunk(
		sessionId: string,
		state: BufferState,
		targetDurationMs: number
	): AudioChunk | null {
		const bytesNeeded = Math.min(
			this.msToBytes(targetDurationMs),
			state.totalBytes
		);

		if (bytesNeeded <= 0) {
			return null;
		}

		return this.takeBytes(sessionId, state, bytesNeeded);
	}

	/**
	 * Convert stereo to mono audio
	 * Useful for transcription services that prefer mono
	 *
	 * @param stereoData Stereo PCM data (2 channels interleaved)
	 * @returns Mono PCM data (1 channel)
	 */
	public stereoToMono(stereoData: Buffer): Buffer {
		const monoData = Buffer.alloc(stereoData.length / 2);

		for (let i = 0; i < stereoData.length - 3; i += 4) {
			// Read left and right samples (16-bit)
			const left = stereoData.readInt16LE(i);
			const right = stereoData.readInt16LE(i + 2);

			// Average the channels
			const mono = Math.floor((left + right) / 2);

			// Write mono sample
			monoData.writeInt16LE(mono, i / 2);
		}

		return monoData;
	}

	/**
	 * Resample audio to a different sample rate
	 * Simple linear interpolation (for basic resampling)
	 *
	 * @param audioData PCM audio data
	 * @param fromRate Current sample rate
	 * @param toRate Target sample rate
	 * @returns Resampled audio data
	 */
	public resample(
		audioData: Buffer,
		fromRate: number,
		toRate: number
	): Buffer {
		if (fromRate === toRate) {
			return audioData;
		}

		const ratio = toRate / fromRate;
		const samples = audioData.length / 2; // 16-bit samples
		const newSamples = Math.floor(samples * ratio);
		const resampled = Buffer.alloc(newSamples * 2);

		for (let i = 0; i < newSamples; i++) {
			const srcIndex = i / ratio;
			const srcIndexFloor = Math.floor(srcIndex);
			const srcIndexCeil = Math.min(srcIndexFloor + 1, samples - 1);

			// Linear interpolation
			const sample1 = audioData.readInt16LE(srcIndexFloor * 2);
			const sample2 = audioData.readInt16LE(srcIndexCeil * 2);
			const fraction = srcIndex - srcIndexFloor;

			const interpolated = Math.floor(
				sample1 + (sample2 - sample1) * fraction
			);

			resampled.writeInt16LE(interpolated, i * 2);
		}

		return resampled;
	}

	/**
	 * Clean up session buffers
	 *
	 * @param sessionId Voice session ID
	 */
	public cleanup(sessionId: string): void {
		this.bufferStates.delete(sessionId);
		this.lastAudioTime.delete(sessionId);
	}

	/**
	 * Get buffer status for debugging
	 *
	 * @param sessionId Voice session ID
	 * @returns Buffer information
	 */
	public getBufferStatus(sessionId: string): {
		bufferCount: number;
		totalBytes: number;
		durationMs: number;
	} {
		const state = this.bufferStates.get(sessionId);

		if (!state) {
			return { bufferCount: 0, totalBytes: 0, durationMs: 0 };
		}

		return {
			bufferCount: state.chunks.length,
			totalBytes: state.totalBytes,
			durationMs: this.bytesToDuration(state.totalBytes),
		};
	}

	private getOrCreateState(sessionId: string): BufferState {
		let state = this.bufferStates.get(sessionId);
		if (!state) {
			state = {
				chunks: [],
				totalBytes: 0,
				flushTimestamps: [],
			};
			this.bufferStates.set(sessionId, state);
		}
		return state;
	}

	private applySoftBackpressure(sessionId: string, state: BufferState): void {
		const now = Date.now();
		const durationMs = this.bytesToDuration(state.totalBytes);
		const softDuration = this.MAX_BUFFER_DURATION_MS * 0.7;
		const softBytes = this.MAX_BUFFER_SIZE_BYTES * 0.7;

		if (
			state.totalBytes >= softBytes ||
			durationMs >= softDuration
		) {
			if (!state.softThrottleActive) {
				state.softThrottleActive = true;
				state.lastSoftWarning = now;
				this.logBufferStats(
					sessionId,
					state,
					"Soft backpressure engaged"
				);
			} else if (
				state.lastSoftWarning &&
				now - state.lastSoftWarning > 2000
			) {
				state.lastSoftWarning = now;
				this.logBufferStats(
					sessionId,
					state,
					"Soft backpressure still active"
				);
			}

			// Drop oldest chunks until we're back to ~60% capacity
			const targetBytes = this.MAX_BUFFER_SIZE_BYTES * 0.6;
			while (state.totalBytes > targetBytes && state.chunks.length > 1) {
				const removed = state.chunks.shift();
				if (!removed) {
					break;
				}
				state.totalBytes -= removed.length;
			}
		} else if (state.softThrottleActive && durationMs < softDuration * 0.5) {
			state.softThrottleActive = false;
			this.logBufferStats(
				sessionId,
				state,
				"Soft backpressure released"
			);
		}
	}

	private forceFlush(
		sessionId: string,
		state: BufferState,
		reason: "duration" | "size"
	): AudioChunk | null {
		this.logBufferStats(
			sessionId,
			state,
			reason === "duration"
				? "Duration limit reached — forcing flush"
				: "Size limit reached — forcing flush"
		);

		const chunk = this.takeBytes(sessionId, state, state.totalBytes);
		if (!chunk) {
			return null;
		}

		chunk.forced = true;
		chunk.flushReason = reason;

		state.flushTimestamps.push(Date.now());
		state.flushTimestamps = state.flushTimestamps.filter(
			(ts) => Date.now() - ts <= 10000
		);

		if (state.flushTimestamps.length >= 3) {
			state.throttledUntil = Date.now() + 1000;
			this.logBufferStats(
				sessionId,
				state,
				"Multiple flushes detected — temporarily throttling intake"
			);
		}

		return chunk;
	}

	private takeBytes(
		sessionId: string,
		state: BufferState,
		bytesNeeded: number
	): AudioChunk | null {
		if (bytesNeeded <= 0 || state.totalBytes === 0) {
			return null;
		}

		const chunkParts: Buffer[] = [];
		let remaining = Math.min(bytesNeeded, state.totalBytes);

		while (remaining > 0 && state.chunks.length > 0) {
			const current = state.chunks[0];
			if (current.length <= remaining) {
				chunkParts.push(current);
				state.chunks.shift();
				state.totalBytes -= current.length;
				remaining -= current.length;
			} else {
				chunkParts.push(current.subarray(0, remaining));
				state.chunks[0] = current.subarray(remaining);
				state.totalBytes -= remaining;
				remaining = 0;
			}
		}

		const combinedBuffer = Buffer.concat(chunkParts);
		const durationMs = this.bytesToDuration(combinedBuffer.length);

		return {
			data: combinedBuffer,
			timestamp: new Date(),
			duration: durationMs,
			sampleRate: this.SAMPLE_RATE,
			channels: this.CHANNELS,
		};
	}

	private bytesToDuration(bytes: number): number {
		if (bytes <= 0) {
			return 0;
		}

		const frames = bytes / (this.CHANNELS * 2);
		return (frames / this.SAMPLE_RATE) * 1000;
	}

	private msToBytes(durationMs: number): number {
		if (durationMs <= 0) {
			return 0;
		}

		const frames = (durationMs / 1000) * this.SAMPLE_RATE;
		return Math.floor(frames * this.CHANNELS * 2);
	}

	private getEffectiveChunkDuration(bufferDuration: number): number {
		if (bufferDuration >= this.MAX_BUFFER_DURATION_MS * 0.5) {
			return Math.max(500, Math.floor(this.CHUNK_DURATION_MS / 2));
		}
		return this.CHUNK_DURATION_MS;
	}

	private logBufferStats(
		sessionId: string,
		state: BufferState,
		message: string
	): void {
		const duration = this.bytesToDuration(state.totalBytes);
		const percent =
			((state.totalBytes / this.MAX_BUFFER_SIZE_BYTES) * 100).toFixed(1);

		console.warn(
			`[AudioProcessor] ${message} — session: ${sessionId}, ` +
				`chunks: ${state.chunks.length}, bytes: ${
					state.totalBytes
				} (${percent}%), duration: ${duration.toFixed(0)}ms`
		);
	}
}
