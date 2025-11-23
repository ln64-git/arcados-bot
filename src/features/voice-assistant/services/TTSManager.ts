import { CartesiaTTSService } from "./CartesiaTTSService.js";
import { GoogleTTSService } from "./GoogleTTSService.js";
import type { TTSChunk } from "../types.js";

/**
 * Unified TTS Manager with Fallback Support
 * Tries Cartesia TTS first, falls back to Google TTS on failure
 *
 * Features:
 * - Automatic provider fallback (Cartesia → Google)
 * - Unified interface for VoiceAssistantManager
 * - Transparent error handling
 */
export class TTSManager {
  private static instance: TTSManager;
  private readonly cartesia: CartesiaTTSService;
  private readonly google: GoogleTTSService;
  private usingCartesia: boolean;

  private constructor() {
    this.cartesia = CartesiaTTSService.getInstance();
    this.google = GoogleTTSService.getInstance();
    this.usingCartesia = this.cartesia.isConfigured();
  }

  public static getInstance(): TTSManager {
    if (!TTSManager.instance) {
      TTSManager.instance = new TTSManager();
    }
    return TTSManager.instance;
  }

  /**
   * Synthesize text to audio
   * Tries Cartesia first, falls back to Google on failure
   *
   * @param text Text to synthesize
   * @returns PCM audio buffer (48kHz stereo 16-bit)
   */
  public async synthesize(text: string): Promise<Buffer> {
    // Try Cartesia first if configured
    if (this.usingCartesia) {
      try {
        return await this.cartesia.synthesize(text);
      } catch (error) {
        console.warn(
          "[TTSManager] Cartesia failed, falling back to Google:",
          error
        );
      }
    }

    // Fallback to Google TTS
    return await this.google.synthesize(text);
  }

  /**
   * Split text into natural speech chunks for streaming
   * Uses the same chunking strategy for both providers
   *
   * @param text Full text to split
   * @returns Array of text chunks
   */
  public splitIntoChunks(text: string): string[] {
    // Both services use the same chunking algorithm
    // Use whichever is configured
    if (this.usingCartesia) {
      return this.cartesia.splitIntoChunks(text);
    }
    return this.google.splitIntoChunks(text);
  }

  /**
   * Create chunk synthesis queue for streaming playback
   * Tries Cartesia first, falls back to Google on failure
   *
   * @param text Full text to synthesize
   * @returns Total chunk count with synthesis promises
   */
  public createChunkSynthesisQueue(text: string): {
    chunkCount: number;
    chunkPromises: Array<Promise<TTSChunk | null>>;
  } {
    // Try Cartesia first if configured
    if (this.usingCartesia) {
      try {
        return this.createChunkQueueWithFallback(text);
      } catch (error) {
        console.warn(
          "[TTSManager] Failed to create Cartesia chunk queue, using Google:",
          error
        );
      }
    }

    // Fallback to Google TTS
    return this.google.createChunkSynthesisQueue(text);
  }

  /**
   * Create chunk queue with per-chunk fallback support
   * If a Cartesia chunk fails, retry with Google for that chunk only
   */
  private createChunkQueueWithFallback(text: string): {
    chunkCount: number;
    chunkPromises: Array<Promise<TTSChunk | null>>;
  } {
    const textChunks = this.cartesia.splitIntoChunks(text);
    const chunkCount = textChunks.length;

    const chunkPromises = textChunks.map((chunkText, index) => {
      return this.synthesize(chunkText)
        .then((audioBuffer): TTSChunk => {
          return {
            audio: audioBuffer,
            text: chunkText,
            sequence: index,
            isFinal: index === textChunks.length - 1,
          };
        })
        .catch(async (error) => {
          console.error(
            `[TTSManager] Failed to synthesize chunk ${
              index + 1
            }/${chunkCount}:`,
            error
          );
          return null; // Return null for failed chunks
        });
    });

    return {
      chunkCount,
      chunkPromises,
    };
  }

  /**
   * Check if any TTS provider is configured and available
   */
  public isConfigured(): boolean {
    return this.cartesia.isConfigured() || this.google.isConfigured();
  }

  /**
   * Close all TTS connections
   */
  public async disconnect(): Promise<void> {
    await Promise.all([this.cartesia.disconnect(), this.google.disconnect()]);
  }

  /**
   * Clear all TTS caches
   */
  public clearCache(): void {
    this.cartesia.clearCache();
    this.google.clearCache();
  }
}
