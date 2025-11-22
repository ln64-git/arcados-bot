import { config } from "../../../config/index.js";
import type { TTSChunk } from "../types.js";
import { TTS_CONSTANTS } from "../constants.js";

/**
 * Simple LRU cache for TTS audio
 */
class LRUCache<K, V> {
	private cache = new Map<K, V>();
	private maxSize: number;

	constructor(maxSize: number) {
		this.maxSize = maxSize;
	}

	get(key: K): V | undefined {
		const value = this.cache.get(key);
		if (value !== undefined) {
			// Move to end (most recent)
			this.cache.delete(key);
			this.cache.set(key, value);
		}
		return value;
	}

	set(key: K, value: V): void {
		// Delete if exists to update position
		if (this.cache.has(key)) {
			this.cache.delete(key);
		}

		// Add new entry
		this.cache.set(key, value);

		// Evict oldest if over capacity
		if (this.cache.size > this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
			}
		}
	}

	has(key: K): boolean {
		return this.cache.has(key);
	}

	clear(): void {
		this.cache.clear();
	}

	get size(): number {
		return this.cache.size;
	}
}

/**
 * Rate limiter using token bucket algorithm
 */
class RateLimiter {
	private queue: Array<() => void> = [];
	private activeRequests = 0;
	private readonly maxConcurrent: number;

	constructor(maxConcurrent: number) {
		this.maxConcurrent = maxConcurrent;
	}

	async limit<T>(fn: () => Promise<T>): Promise<T> {
		// Wait until we have capacity
		await this.waitForCapacity();

		this.activeRequests++;

		try {
			return await fn();
		} finally {
			this.activeRequests--;
			this.processQueue();
		}
	}

	private waitForCapacity(): Promise<void> {
		if (this.activeRequests < this.maxConcurrent) {
			return Promise.resolve();
		}

		return new Promise((resolve) => {
			this.queue.push(resolve);
		});
	}

	private processQueue(): void {
		if (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
			const resolve = this.queue.shift();
			if (resolve) {
				resolve();
			}
		}
	}
}

/**
 * Google Cloud Text-to-Speech service
 * Converts text to audio using Google's TTS REST API
 *
 * Based on Nayru TTS implementation with streaming chunk support
 */
export class GoogleTTSService {
	private static instance: GoogleTTSService;
	private readonly apiKey: string | undefined;
	private readonly endpoint = "https://texttospeech.googleapis.com/v1/text:synthesize";
	private readonly languageCode: string;
	private readonly voiceName: string;

	// LRU cache for synthesized audio
	private audioCache = new LRUCache<string, Buffer>(TTS_CONSTANTS.CACHE_SIZE);

	// Rate limiter to prevent overwhelming the API
	private rateLimiter = new RateLimiter(TTS_CONSTANTS.MAX_CONCURRENT_REQUESTS);

	private constructor() {
		this.apiKey = config.googleTtsApiKey;
		this.languageCode = config.googleTtsLanguageCode;
		this.voiceName = config.googleTtsVoiceName;
	}

	public static getInstance(): GoogleTTSService {
		if (!GoogleTTSService.instance) {
			GoogleTTSService.instance = new GoogleTTSService();
		}
		return GoogleTTSService.instance;
	}

	/**
	 * Convert text to speech audio
	 * @param text Text to synthesize
	 * @returns Audio buffer (LINEAR16 PCM at 48kHz)
	 */
	public async synthesize(text: string): Promise<Buffer> {
		if (!this.apiKey) {
			throw new Error(
				"Google TTS API key not configured. Set GOOGLE_TTS_API_KEY environment variable."
			);
		}

		if (!text || text.trim().length === 0) {
			throw new Error("Cannot synthesize empty text");
		}

		const normalizedText = text.trim();

		// Create cache key (include voice name for different voices)
		const cacheKey = `${this.voiceName}:${normalizedText}`;

		// Check cache first
		const cachedAudio = this.audioCache.get(cacheKey);
		if (cachedAudio) {
			return cachedAudio;
		}

		// Use rate limiter for API calls
		return this.rateLimiter.limit(async () => {
			// Check cache again in case another request synthesized it while we were waiting
			const recheck = this.audioCache.get(cacheKey);
			if (recheck) {
				return recheck;
			}

			// Check if using Gemini TTS (Laomedeia or other Gemini voices)
			const isGeminiVoice = this.voiceName === "Laomedeia" || this.voiceName.startsWith("gemini");

			const body = isGeminiVoice
				? {
						input: {
							text: normalizedText,
							prompt: TTS_CONSTANTS.GEMINI_PROMPT,
						},
						voice: {
							languageCode: this.languageCode,
							modelName: TTS_CONSTANTS.GEMINI_MODEL,
							name: this.voiceName,
						},
						audioConfig: {
							audioEncoding: TTS_CONSTANTS.ENCODING,
							pitch: TTS_CONSTANTS.GEMINI_PITCH,
							speakingRate: TTS_CONSTANTS.GEMINI_SPEAKING_RATE,
						},
				  }
				: {
						input: { text: normalizedText },
						voice: {
							languageCode: this.languageCode,
							name: this.voiceName,
						},
						audioConfig: {
							audioEncoding: TTS_CONSTANTS.ENCODING,
							sampleRateHertz: TTS_CONSTANTS.SAMPLE_RATE,
						},
				  };

			const url = `${this.endpoint}?key=${this.apiKey}`;

			try {
				const response = await fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json; charset=utf-8",
					},
					body: JSON.stringify(body),
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(
						`Google TTS API error (${response.status}): ${errorText}`
					);
				}

				const json = (await response.json()) as { audioContent?: string };

				if (!json.audioContent) {
					throw new Error("Google TTS API returned no audio content");
				}

				// Response is base64-encoded audio
				const audioBuffer = Buffer.from(json.audioContent, "base64");

				// Cache the result
				this.audioCache.set(cacheKey, audioBuffer);

				return audioBuffer;
			} catch (error) {
				if (error instanceof Error) {
					throw new Error(`Google TTS synthesis failed: ${error.message}`);
				}
				throw new Error("Google TTS synthesis failed: Unknown error");
			}
		});
	}

	/**
	 * Split text into natural speech chunks for streaming
	 * Splits on sentence boundaries (. ! ?) and commas for minimal latency
	 *
	 * @param text Full text to split
	 * @returns Array of text chunks
	 */
	public splitIntoChunks(text: string): string[] {
		const chunks: string[] = [];

		// First split by sentence endings (. ! ?)
		const sentences = text.split(/([.!?]\s+)/);

		let currentChunk = "";

		for (const part of sentences) {
			// If it's a sentence ending, add to current chunk and flush
			if (/^[.!?]\s+$/.test(part)) {
				currentChunk += part.trim();
				if (currentChunk.length > 0) {
					chunks.push(currentChunk.trim());
					currentChunk = "";
				}
			} else {
				// For longer sentences, split on commas
				const commaParts = part.split(/,\s+/);

				for (let i = 0; i < commaParts.length; i++) {
					const commaPart = commaParts[i];

					if (!commaPart) continue; // Skip empty parts

					if (i < commaParts.length - 1) {
						// Not the last part - add comma and flush
						chunks.push(commaPart.trim() + ",");
					} else {
						// Last part - keep in buffer for sentence ending
						currentChunk = commaPart;
					}
				}
			}
		}

		// Flush any remaining text
		if (currentChunk.trim().length > 0) {
			chunks.push(currentChunk.trim());
		}

		return chunks.filter((chunk) => chunk.length > 0);
	}

	/**
	 * Kick off synthesis for all chunks immediately so playback can start
	 * as soon as the first chunk is ready while remaining chunks continue
	 * processing in parallel.
	 *
	 * @param text Full text to synthesize
	 * @returns Total chunk count with synthesis promises
	 */
	public createChunkSynthesisQueue(
		text: string
	): {
		chunkCount: number;
		chunkPromises: Array<Promise<TTSChunk | null>>;
	} {
		const textChunks = this.splitIntoChunks(text);

		const chunkPromises = textChunks.map((chunk, index) => {
			if (!chunk) {
				return Promise.resolve(null);
			}

			return this.synthesize(chunk)
				.then((audio) => ({
					audio,
					text: chunk,
					sequence: index,
					isFinal: index === textChunks.length - 1,
				}))
				.catch((error) => {
					console.error(
						`Failed to synthesize chunk ${index}: ${chunk}`,
						error
					);
					return null;
				});
		});

		return {
			chunkCount: textChunks.length,
			chunkPromises,
		};
	}

	/**
	 * Check if the service is configured and ready to use
	 */
	public isConfigured(): boolean {
		return !!this.apiKey;
	}

	/**
	 * Get current voice configuration
	 */
	public getVoiceConfig(): { languageCode: string; voiceName: string } {
		return {
			languageCode: this.languageCode,
			voiceName: this.voiceName,
		};
	}
}
