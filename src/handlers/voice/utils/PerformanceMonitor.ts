/**
 * Performance monitoring utility for voice assistant
 * Tracks latency, throughput, and error rates
 */

export interface PerformanceMetrics {
	// Timing metrics
	transcriptionLatencyMs: number[];
	ttsLatencyMs: number[];
	aiResponseLatencyMs: number[];
	endToEndLatencyMs: number[];

	// Throughput metrics
	transcriptionsPerMinute: number;
	ttsRequestsPerMinute: number;
	cacheHitRate: number;

	// Error metrics
	transcriptionErrors: number;
	ttsErrors: number;
	aiErrors: number;

	// Resource metrics
	bufferFlushCount: number;
	reconnectionCount: number;
}

export interface TimingResult {
	durationMs: number;
	success: boolean;
	error?: string;
}

/**
 * Simple performance monitor for tracking voice assistant metrics
 */
export class PerformanceMonitor {
	private static instance: PerformanceMonitor;

	// Circular buffers for latency tracking (keep last 100 samples)
	private readonly MAX_SAMPLES = 100;
	private transcriptionLatencies: number[] = [];
	private ttsLatencies: number[] = [];
	private aiLatencies: number[] = [];
	private endToEndLatencies: number[] = [];

	// Counters for throughput (reset every minute)
	private transcriptionCount = 0;
	private ttsRequestCount = 0;
	private cacheHits = 0;
	private cacheRequests = 0;
	private lastResetTime = Date.now();

	// Error counters
	private errors = {
		transcription: 0,
		tts: 0,
		ai: 0,
	};

	// Resource event counters
	private bufferFlushes = 0;
	private reconnections = 0;

	private constructor() {
		// Reset counters every minute
		setInterval(() => this.resetCounters(), 60000);
	}

	public static getInstance(): PerformanceMonitor {
		if (!PerformanceMonitor.instance) {
			PerformanceMonitor.instance = new PerformanceMonitor();
		}
		return PerformanceMonitor.instance;
	}

	/**
	 * Start timing an operation
	 * @returns Function to call when operation completes
	 */
	public startTiming(): () => TimingResult {
		const startTime = Date.now();
		let completed = false;

		return () => {
			if (completed) {
				throw new Error("Timing already completed");
			}
			completed = true;
			return {
				durationMs: Date.now() - startTime,
				success: true,
			};
		};
	}

	/**
	 * Time an async operation
	 * @param operation Operation to time
	 * @returns Result and timing
	 */
	public async time<T>(operation: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
		const startTime = Date.now();
		const result = await operation();
		const durationMs = Date.now() - startTime;
		return { result, durationMs };
	}

	/**
	 * Record transcription latency
	 */
	public recordTranscription(durationMs: number, success: boolean): void {
		if (success) {
			this.addToCircularBuffer(this.transcriptionLatencies, durationMs);
			this.transcriptionCount++;
		} else {
			this.errors.transcription++;
		}
	}

	/**
	 * Record TTS latency
	 */
	public recordTTS(durationMs: number, success: boolean, cacheHit: boolean): void {
		if (success) {
			this.addToCircularBuffer(this.ttsLatencies, durationMs);
			this.ttsRequestCount++;

			if (cacheHit) {
				this.cacheHits++;
			}
			this.cacheRequests++;
		} else {
			this.errors.tts++;
		}
	}

	/**
	 * Record AI response latency
	 */
	public recordAIResponse(durationMs: number, success: boolean): void {
		if (success) {
			this.addToCircularBuffer(this.aiLatencies, durationMs);
		} else {
			this.errors.ai++;
		}
	}

	/**
	 * Record end-to-end latency (trigger to playback)
	 */
	public recordEndToEnd(durationMs: number): void {
		this.addToCircularBuffer(this.endToEndLatencies, durationMs);
	}

	/**
	 * Record a buffer flush event
	 */
	public recordBufferFlush(): void {
		this.bufferFlushes++;
	}

	/**
	 * Record a reconnection event
	 */
	public recordReconnection(): void {
		this.reconnections++;
	}

	/**
	 * Get current metrics
	 */
	public getMetrics(): PerformanceMetrics {
		return {
			transcriptionLatencyMs: [...this.transcriptionLatencies],
			ttsLatencyMs: [...this.ttsLatencies],
			aiResponseLatencyMs: [...this.aiLatencies],
			endToEndLatencyMs: [...this.endToEndLatencies],
			transcriptionsPerMinute: this.transcriptionCount,
			ttsRequestsPerMinute: this.ttsRequestCount,
			cacheHitRate: this.cacheRequests > 0 ? this.cacheHits / this.cacheRequests : 0,
			transcriptionErrors: this.errors.transcription,
			ttsErrors: this.errors.tts,
			aiErrors: this.errors.ai,
			bufferFlushCount: this.bufferFlushes,
			reconnectionCount: this.reconnections,
		};
	}

	/**
	 * Get performance summary
	 */
	public getSummary(): string {
		const metrics = this.getMetrics();

		const avgTranscription =
			this.average(metrics.transcriptionLatencyMs).toFixed(0) || "N/A";
		const avgTTS = this.average(metrics.ttsLatencyMs).toFixed(0) || "N/A";
		const avgAI = this.average(metrics.aiResponseLatencyMs).toFixed(0) || "N/A";
		const avgEndToEnd = this.average(metrics.endToEndLatencyMs).toFixed(0) || "N/A";

		return `Performance Summary:
  Latency:
    Transcription: ${avgTranscription}ms avg (${metrics.transcriptionLatencyMs.length} samples)
    TTS: ${avgTTS}ms avg (${metrics.ttsLatencyMs.length} samples)
    AI Response: ${avgAI}ms avg (${metrics.aiResponseLatencyMs.length} samples)
    End-to-End: ${avgEndToEnd}ms avg (${metrics.endToEndLatencyMs.length} samples)

  Throughput:
    Transcriptions: ${metrics.transcriptionsPerMinute}/min
    TTS Requests: ${metrics.ttsRequestsPerMinute}/min
    Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%

  Errors:
    Transcription: ${metrics.transcriptionErrors}
    TTS: ${metrics.ttsErrors}
    AI: ${metrics.aiErrors}

  Resources:
    Buffer Flushes: ${metrics.bufferFlushCount}
    Reconnections: ${metrics.reconnectionCount}`;
	}

	/**
	 * Reset per-minute counters
	 */
	private resetCounters(): void {
		this.transcriptionCount = 0;
		this.ttsRequestCount = 0;
		this.cacheHits = 0;
		this.cacheRequests = 0;
		this.lastResetTime = Date.now();
	}

	/**
	 * Add value to circular buffer (FIFO, max size)
	 */
	private addToCircularBuffer(buffer: number[], value: number): void {
		buffer.push(value);
		if (buffer.length > this.MAX_SAMPLES) {
			buffer.shift();
		}
	}

	/**
	 * Calculate average of array
	 */
	private average(arr: number[]): number {
		if (arr.length === 0) return 0;
		return arr.reduce((sum, val) => sum + val, 0) / arr.length;
	}

	/**
	 * Clear all metrics
	 */
	public reset(): void {
		this.transcriptionLatencies = [];
		this.ttsLatencies = [];
		this.aiLatencies = [];
		this.endToEndLatencies = [];
		this.transcriptionCount = 0;
		this.ttsRequestCount = 0;
		this.cacheHits = 0;
		this.cacheRequests = 0;
		this.errors = { transcription: 0, tts: 0, ai: 0 };
		this.bufferFlushes = 0;
		this.reconnections = 0;
	}
}
