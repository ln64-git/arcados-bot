import { pipeline, Pipeline } from "@xenova/transformers";

/**
 * Service for generating text embeddings using local transformers
 */
export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private model: any | null = null;
  private modelName = "Xenova/all-mpnet-base-v2";
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Initialize the model (lazy loading)
   */
  async initialize(): Promise<void> {
    if (this.model) {
      return;
    }

    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = (async () => {
      try {
        this.model = await pipeline("feature-extraction", this.modelName);
      } catch (error) {
        console.error("🔸 Failed to load embedding model:", error);
        throw error;
      } finally {
        this.isInitializing = false;
      }
    })();

    return this.initPromise;
  }

  /**
   * Generate embedding for a single text
   * @param text Text to generate embedding for
   * @returns Embedding vector (768 dimensions for all-mpnet-base-v2)
   */
  async generateEmbedding(text: string): Promise<number[]> {
    await this.initialize();

    if (!this.model) {
      throw new Error("Model not initialized");
    }

    try {
      const output = await this.model(text, {
        pooling: "mean",
        normalize: true,
      });

      // Convert tensor to array if needed
      const embedding = Array.isArray(output.data)
        ? output.data
        : Array.from(output.data);

      // Ensure it's a flat array of numbers
      return embedding.map((v: any) => (typeof v === "number" ? v : Number(v)));
    } catch (error) {
      console.error("🔸 Failed to generate embedding:", error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * @param texts Array of texts to generate embeddings for
   * @returns Array of embedding vectors
   */
  async generateBatch(texts: string[]): Promise<number[][]> {
    await this.initialize();

    if (!this.model) {
      throw new Error("Model not initialized");
    }

    if (texts.length === 0) {
      return [];
    }

    try {
      const embeddings: number[][] = [];

      // Process in batches to avoid memory issues
      const batchSize = 32;
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map((text) => this.generateEmbedding(text))
        );
        embeddings.push(...batchResults);
      }

      return embeddings;
    } catch (error) {
      console.error("🔸 Failed to generate batch embeddings:", error);
      throw error;
    }
  }

  /**
   * Get the embedding dimension for this model
   */
  getDimension(): number {
    return 768; // all-mpnet-base-v2 has 768 dimensions
  }
}
