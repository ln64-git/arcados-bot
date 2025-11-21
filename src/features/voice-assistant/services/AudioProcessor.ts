import type { AudioChunk } from "../types.js";

/**
 * Processes raw Discord audio streams into chunks for transcription
 * Handles buffering, silence detection, and chunk assembly
 */
export class AudioProcessor {
	private static instance: AudioProcessor;

	// Audio configuration
	private readonly SAMPLE_RATE = 48000; // Discord voice uses 48kHz
	private readonly CHANNELS = 2; // Stereo
	private readonly CHUNK_DURATION_MS = 2000; // 2 second chunks
	private readonly SILENCE_THRESHOLD = 500; // Amplitude threshold for silence
	private readonly SILENCE_DURATION_MS = 1000; // 1 second of silence = end of utterance

	// Buffers per session
	private buffers: Map<string, Buffer[]> = new Map();
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
		// Initialize buffer for this session if needed
		if (!this.buffers.has(sessionId)) {
			this.buffers.set(sessionId, []);
		}

		const buffer = this.buffers.get(sessionId)!;
		buffer.push(audioData);

		// Update last audio time
		this.lastAudioTime.set(sessionId, Date.now());

		// Calculate total buffered duration
		const totalSamples = buffer.reduce((sum, buf) => sum + buf.length, 0) / 2; // 16-bit samples
		const durationMs = (totalSamples / this.SAMPLE_RATE) * 1000;

		// Check if we have enough audio for a chunk
		if (durationMs >= this.CHUNK_DURATION_MS) {
			return this.createChunk(sessionId);
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

		const silenceDuration = Date.now() - lastTime;
		return silenceDuration >= this.SILENCE_DURATION_MS;
	}

	/**
	 * Flush buffered audio and create final chunk
	 * Used when silence is detected or session ends
	 *
	 * @param sessionId Voice session ID
	 * @returns Audio chunk with all buffered data, or null if buffer is empty
	 */
	public flushBuffer(sessionId: string): AudioChunk | null {
		const buffer = this.buffers.get(sessionId);

		if (!buffer || buffer.length === 0) {
			return null;
		}

		const chunk = this.createChunk(sessionId);

		// Clear the buffer
		this.buffers.delete(sessionId);
		this.lastAudioTime.delete(sessionId);

		return chunk;
	}

	/**
	 * Create an audio chunk from buffered data
	 *
	 * @param sessionId Voice session ID
	 * @returns Audio chunk ready for transcription
	 */
	private createChunk(sessionId: string): AudioChunk | null {
		const buffer = this.buffers.get(sessionId);

		if (!buffer || buffer.length === 0) {
			return null;
		}

		// Combine all buffered audio
		const combinedBuffer = Buffer.concat(buffer);

		// Clear the buffer for next chunk
		this.buffers.set(sessionId, []);

		// Calculate duration
		const samples = combinedBuffer.length / 2; // 16-bit samples
		const durationMs = (samples / this.SAMPLE_RATE) * 1000;

		return {
			data: combinedBuffer,
			timestamp: new Date(),
			duration: durationMs,
			sampleRate: this.SAMPLE_RATE,
			channels: this.CHANNELS,
		};
	}

	/**
	 * Detect if audio buffer contains mostly silence
	 *
	 * @param audioData PCM audio data
	 * @returns True if mostly silent
	 */
	private isSilent(audioData: Buffer): boolean {
		// Sample every 10th sample to check amplitude
		let silentSamples = 0;
		let totalSamples = 0;

		for (let i = 0; i < audioData.length - 1; i += 20) {
			const sample = audioData.readInt16LE(i);
			const amplitude = Math.abs(sample);

			totalSamples++;

			if (amplitude < this.SILENCE_THRESHOLD) {
				silentSamples++;
			}
		}

		// Consider silent if >90% of samples are below threshold
		return silentSamples / totalSamples > 0.9;
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
		this.buffers.delete(sessionId);
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
		const buffer = this.buffers.get(sessionId);

		if (!buffer) {
			return { bufferCount: 0, totalBytes: 0, durationMs: 0 };
		}

		const totalBytes = buffer.reduce((sum, buf) => sum + buf.length, 0);
		const samples = totalBytes / 2;
		const durationMs = (samples / this.SAMPLE_RATE) * 1000;

		return {
			bufferCount: buffer.length,
			totalBytes,
			durationMs,
		};
	}
}
