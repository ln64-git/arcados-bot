/**
 * Streaming TTS Queue
 * Manages paragraph-based chunking and playback timing for low-latency voice responses
 */

import { SentenceDetector } from "./utils/SentenceDetector";
import type { TTSManager } from "../voice-assistant/services/TTSManager";
import type { TTSChunk } from "../voice-assistant/types";

export interface StreamingQueueConfig {
	/** Target buffer time before next chunk needed (ms, default: 200) */
	targetBufferTime: number;
	/** Use paragraph-based chunking (default: true) */
	useParagraphChunking: boolean;
}

interface QueuedChunk {
	text: string;
	isParagraph: boolean;
	estimatedDuration: number;
	synthesisPromise?: Promise<TTSChunk | null>;
	audio?: Buffer;
	synthesisStartTime?: number;
	synthesisEndTime?: number;
}

export class StreamingTTSQueue {
	private ttsManager: TTSManager;
	private config: StreamingQueueConfig;

	// State management
	private tokenBuffer = "";
	private paragraphQueue: string[] = [];
	private synthesisQueue: QueuedChunk[] = [];
	private playbackQueue: QueuedChunk[] = [];

	// Timing metrics
	private headerSent = false;
	private currentPlaybackStartTime?: number;
	private currentPlaybackChunk?: QueuedChunk;
	private averageTokenGenerationRate = 0; // tokens per second
	private tokenGenerationSamples: number[] = [];
	private lastTokenTime?: number;

	// Statistics for adaptive optimization
	private synthesisTimeSamples: number[] = [];
	private avgSynthesisTimePerParagraph = 2500; // default 2.5s per paragraph

	constructor(ttsManager: TTSManager, config?: Partial<StreamingQueueConfig>) {
		this.ttsManager = ttsManager;
		this.config = {
			targetBufferTime: 200,
			useParagraphChunking: true,
			...config,
		};
	}

	/**
	 * Add streaming token to the queue
	 */
	public addToken(token: string): void {
		const now = Date.now();

		// Track token generation rate
		if (this.lastTokenTime) {
			const timeDelta = (now - this.lastTokenTime) / 1000;
			if (timeDelta > 0) {
				const rate = token.length / timeDelta;
				this.tokenGenerationSamples.push(rate);
				if (this.tokenGenerationSamples.length > 20) {
					this.tokenGenerationSamples.shift();
				}
				this.averageTokenGenerationRate =
					this.tokenGenerationSamples.reduce((a, b) => a + b, 0) /
					this.tokenGenerationSamples.length;
			}
		}
		this.lastTokenTime = now;

		// Add to buffer
		this.tokenBuffer += token;

		// Try to extract sentences
		this.processBuffer();
	}

	/**
	 * Signal that token stream is complete
	 */
	public finalize(): void {
		// Process any remaining text as a final paragraph
		if (this.tokenBuffer.trim().length > 0) {
			this.paragraphQueue.push(this.tokenBuffer.trim());
			this.tokenBuffer = "";
		}

		// Queue any remaining paragraphs
		this.processBuffer();
		
		// If we still have paragraphs in queue but no chunks created, create them now
		// This handles cases where the response has no newlines (single paragraph)
		while (this.paragraphQueue.length > 0) {
			if (!this.headerSent) {
				this.createHeaderChunk();
			} else {
				this.createParagraphChunk();
			}
		}
	}

	/**
	 * Check if audio is ready for playback
	 */
	public hasReadyAudio(): boolean {
		const firstChunk = this.playbackQueue[0];
		return this.playbackQueue.length > 0 && firstChunk !== undefined && firstChunk.audio !== undefined;
	}

	/**
	 * Get next audio chunk for playback
	 * Call this when ready to play next chunk
	 */
	public getNextChunk(): Buffer | null {
		const chunk = this.playbackQueue.shift();
		if (!chunk || !chunk.audio) {
			return null;
		}

		// Track playback timing
		this.currentPlaybackChunk = chunk;
		this.currentPlaybackStartTime = Date.now();

		return chunk.audio;
	}

	/**
	 * Notify queue that current chunk playback has finished
	 */
	public notifyPlaybackComplete(): void {
		this.currentPlaybackChunk = undefined;
		this.currentPlaybackStartTime = undefined;
	}

	/**
	 * Get estimated time remaining until current playback finishes
	 */
	private getPlaybackTimeRemaining(): number {
		if (!this.currentPlaybackChunk || !this.currentPlaybackStartTime) {
			return 0;
		}

		const elapsed = Date.now() - this.currentPlaybackStartTime;
		const remaining = this.currentPlaybackChunk.estimatedDuration - elapsed;

		return Math.max(0, remaining);
	}

	/**
	 * Process token buffer and extract complete paragraphs
	 * Uses SINGLE newline as paragraph boundary
	 */
	private processBuffer(): void {
		if (this.config.useParagraphChunking) {
			// Look for paragraph boundaries (SINGLE newline)
			const paragraphs = this.tokenBuffer.split(/\n/);

			// If we have more than one paragraph, all but the last are complete
			if (paragraphs.length > 1) {
				// Add complete paragraphs to queue
				for (let i = 0; i < paragraphs.length - 1; i++) {
					const paragraph = paragraphs[i]?.trim();
					if (paragraph && paragraph.length > 0) {
						this.paragraphQueue.push(paragraph);
					}
				}

				// Keep the last paragraph in buffer (might be incomplete)
				const lastParagraph = paragraphs[paragraphs.length - 1];
				this.tokenBuffer = lastParagraph !== undefined ? lastParagraph : "";

				// Try to create chunks
				this.createChunks();
			}
		} else {
			// Fallback to sentence-based chunking
			const result = SentenceDetector.extractSentences(this.tokenBuffer);

			if (result.completeSentences.length > 0) {
				// Combine sentences into paragraphs
				this.paragraphQueue.push(result.completeSentences.join(" "));
				this.tokenBuffer = result.remainder;

				// Try to create chunks
				this.createChunks();
			}
		}
	}

	/**
	 * Create TTS chunks from paragraph queue
	 */
	private createChunks(): void {
		if (this.paragraphQueue.length === 0) {
			return;
		}

		// If header not sent yet, create header chunk immediately
		if (!this.headerSent) {
			this.createHeaderChunk();
			return;
		}

		// For subsequent chunks, process one paragraph at a time
		// Each paragraph contains a complete thought with emotional context
		this.createParagraphChunk();
	}

	/**
	 * Create the initial header chunk (first paragraph)
	 * This is played immediately for instant feedback
	 */
	private createHeaderChunk(): void {
		if (this.paragraphQueue.length === 0) {
			return;
		}

		// Take the first paragraph as the header
		const text = this.paragraphQueue.shift()!;

		this.queueChunkForSynthesis(text, true);
		this.headerSent = true;
	}

	/**
	 * Create chunk from next paragraph with smart sentence batching
	 * Batches multiple sentences based on available time
	 */
	private createParagraphChunk(): void {
		if (this.paragraphQueue.length === 0) {
			return;
		}

		// Get time remaining until we need the next chunk
		const playbackTimeRemaining = this.getPlaybackTimeRemaining();
		const timeAvailable = playbackTimeRemaining - this.config.targetBufferTime;

		// If no playback happening yet, process first paragraph immediately
		if (playbackTimeRemaining === 0) {
			const text = this.paragraphQueue.shift()!;
			this.queueChunkForSynthesis(text, false);
			return;
		}

		// Smart sentence batching: combine multiple paragraphs if we have time
		const batchedParagraphs: string[] = [];
		let estimatedBatchTime = 0;

		while (this.paragraphQueue.length > 0) {
			const nextParagraph = this.paragraphQueue[0]!;

			// Extract sentences from this paragraph to estimate synthesis time
			const sentences = SentenceDetector.extractSentences(nextParagraph + ".").completeSentences;
			const sentenceCount = Math.max(1, sentences.length);

			// Estimate synthesis time for this paragraph (roughly 1.5s per sentence)
			const estimatedSynthesisTime = sentenceCount * 1500;

			// Check if we have time to add this paragraph to the batch
			if (
				batchedParagraphs.length > 0 &&
				estimatedBatchTime + estimatedSynthesisTime > timeAvailable
			) {
				// No more time, process current batch
				break;
			}

			// Add this paragraph to the batch
			batchedParagraphs.push(this.paragraphQueue.shift()!);
			estimatedBatchTime += estimatedSynthesisTime;

			// If we've filled up the available time, stop batching
			if (estimatedBatchTime >= timeAvailable * 0.8) {
				break;
			}
		}

		// If we didn't batch anything, wait a bit longer
		if (batchedParagraphs.length === 0) {
			return;
		}

		// Combine batched paragraphs with space separator
		const text = batchedParagraphs.join(" ");

		// Log batching info
		if (batchedParagraphs.length > 1) {
			console.log(
				`[StreamingTTSQueue] Batched ${batchedParagraphs.length} paragraphs (${text.length} chars, est. ${estimatedBatchTime}ms synthesis)`,
			);
		}

		this.queueChunkForSynthesis(text, false);
	}

	/**
	 * Queue a text chunk for TTS synthesis
	 * @param text Text to synthesize
	 * @param isParagraph Whether this is a paragraph chunk
	 */
	private queueChunkForSynthesis(text: string, isParagraph: boolean): void {
		const estimatedDuration = SentenceDetector.estimateSpeakingDuration(text);

		const chunk: QueuedChunk = {
			text,
			isParagraph,
			estimatedDuration,
			synthesisStartTime: Date.now(),
		};

		// Start synthesis immediately
		chunk.synthesisPromise = this.synthesizeChunk(chunk);

		this.synthesisQueue.push(chunk);

		// Handle synthesis completion
		chunk.synthesisPromise
			.then((result) => {
				if (result && result.audio) {
					chunk.audio = result.audio;
					chunk.synthesisEndTime = Date.now();

					// Update synthesis time statistics (paragraph-based)
					if (chunk.synthesisStartTime && chunk.isParagraph) {
						const synthesisTime = chunk.synthesisEndTime - chunk.synthesisStartTime;
						this.synthesisTimeSamples.push(synthesisTime);

						if (this.synthesisTimeSamples.length > 10) {
							this.synthesisTimeSamples.shift();
						}

						this.avgSynthesisTimePerParagraph =
							this.synthesisTimeSamples.reduce((a, b) => a + b, 0) /
							this.synthesisTimeSamples.length;
					}

					// Move to playback queue
					console.log(`[StreamingTTSQueue] Chunk ready for playback: "${chunk.text.substring(0, 50)}..." (${chunk.audio.length} bytes)`);
					this.playbackQueue.push(chunk);

					// Remove from synthesis queue
					const index = this.synthesisQueue.indexOf(chunk);
					if (index !== -1) {
						this.synthesisQueue.splice(index, 1);
					}
				} else {
					console.error(`[StreamingTTSQueue] Synthesis returned null/empty for chunk: "${chunk.text.substring(0, 50)}..."`);
					// Remove from synthesis queue even on failure
					const index = this.synthesisQueue.indexOf(chunk);
					if (index !== -1) {
						this.synthesisQueue.splice(index, 1);
					}
				}
			})
			.catch((error) => {
				console.error(`[StreamingTTSQueue] Synthesis error for chunk: "${chunk.text.substring(0, 50)}..."`, error);
				console.error(`[StreamingTTSQueue] Error details:`, error instanceof Error ? error.message : String(error));
				console.error(`[StreamingTTSQueue] Error stack:`, error instanceof Error ? error.stack : "No stack");
				// Remove from synthesis queue on error
				const index = this.synthesisQueue.indexOf(chunk);
				if (index !== -1) {
					this.synthesisQueue.splice(index, 1);
				}
			});
	}

	/**
	 * Synthesize a chunk using TTS manager
	 */
	private async synthesizeChunk(chunk: QueuedChunk): Promise<TTSChunk | null> {
		try {
			console.log(`[StreamingTTSQueue] Synthesizing chunk: "${chunk.text.substring(0, 50)}..."`);
			const startTime = Date.now();
			
			// Add timeout to prevent hanging (30 seconds max)
			const synthesisPromise = this.ttsManager.synthesize(chunk.text);
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(new Error(`TTS synthesis timeout after 30 seconds for: "${chunk.text.substring(0, 50)}..."`));
				}, 30000);
			});
			
			const audio = await Promise.race([synthesisPromise, timeoutPromise]);
			const duration = Date.now() - startTime;
			console.log(`[StreamingTTSQueue] Synthesis complete in ${duration}ms, audio size: ${audio.length} bytes`);
			
			if (!audio || audio.length === 0) {
				console.error(`[StreamingTTSQueue] Synthesis returned empty audio buffer`);
				return null;
			}
			
			return {
				audio,
				text: chunk.text,
				sequence: 0,
				isFinal: false, // Will be determined by the queue
			};
		} catch (error) {
			console.error("[StreamingTTSQueue] Error synthesizing chunk:", error);
			console.error("[StreamingTTSQueue] Error details:", error instanceof Error ? error.message : String(error));
			console.error("[StreamingTTSQueue] Error stack:", error instanceof Error ? error.stack : "No stack");
			return null;
		}
	}

	/**
	 * Get queue statistics for debugging
	 */
	public getStats() {
		return {
			tokenBuffer: this.tokenBuffer.length,
			paragraphQueue: this.paragraphQueue.length,
			synthesisQueue: this.synthesisQueue.length,
			playbackQueue: this.playbackQueue.length,
			headerSent: this.headerSent,
			avgTokenRate: this.averageTokenGenerationRate.toFixed(2),
			avgSynthesisTime: this.avgSynthesisTimePerParagraph.toFixed(0),
			playbackTimeRemaining: this.getPlaybackTimeRemaining(),
		};
	}

	/**
	 * Check if queue is idle (nothing to process)
	 */
	public isIdle(): boolean {
		return (
			this.tokenBuffer.length === 0 &&
			this.paragraphQueue.length === 0 &&
			this.synthesisQueue.length === 0 &&
			this.playbackQueue.length === 0
		);
	}

	/**
	 * Force process next paragraph chunk (for manual control)
	 */
	public processNextParagraph(): void {
		if (this.paragraphQueue.length > 0) {
			const text = this.paragraphQueue.shift()!;
			this.queueChunkForSynthesis(text, true);
		}
	}
}
