/**
 * KeywordExtractor - Main service for keyword extraction
 *
 * This is the primary interface for keyword extraction. It combines TF-IDF and
 * semantic approaches to extract high-quality keywords from conversations.
 * Manages vocabulary caching and provides multiple extraction strategies.
 */

import type { PostgreSQLManager } from "../database/PostgreSQLManager";
import { SemanticKeywordExtractor } from "./SemanticKeywordExtractor";
import { TFIDFExtractor } from "./TFIDFExtractor";
import { VocabularyBuilder } from "./VocabularyBuilder";
import type {
	ConversationKeywords,
	GuildVocabulary,
	KeywordExtractionOptions,
	KeywordMessage,
	KeywordScore,
} from "./types";

export class KeywordExtractor {
	private db: PostgreSQLManager;
	private vocabularyBuilder: VocabularyBuilder;
	private tfidfExtractor: TFIDFExtractor;
	private semanticExtractor: SemanticKeywordExtractor;

	// In-memory vocabulary cache (guild_id -> vocabulary)
	private vocabularyCache: Map<string, GuildVocabulary>;
	private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

	// Version for tracking algorithm changes
	private readonly VERSION = "1.0.0";

	constructor(db: PostgreSQLManager) {
		this.db = db;
		this.vocabularyBuilder = new VocabularyBuilder(db);
		this.tfidfExtractor = new TFIDFExtractor();
		this.semanticExtractor = new SemanticKeywordExtractor();
		this.vocabularyCache = new Map();
	}

	/**
	 * Extract keywords from conversation messages
	 *
	 * This is the main entry point for keyword extraction. It automatically
	 * selects the best strategy based on available data and options.
	 */
	async extractKeywords(
		messages: KeywordMessage[],
		guildId: string,
		options: KeywordExtractionOptions = {},
	): Promise<ConversationKeywords> {
		const startTime = Date.now();

		if (messages.length === 0) {
			return this.createEmptyKeywords();
		}

		// Determine extraction method
		const method = options.method || "hybrid";
		const topN = options.topN || 10;

		let keywords: KeywordScore[] = [];

		try {
			switch (method) {
				case "tfidf":
					keywords = await this.extractTFIDF(messages, guildId, options);
					break;

				case "semantic":
					keywords = await this.extractSemantic(messages, options);
					break;

				case "hybrid":
				default:
					keywords = await this.extractHybrid(messages, guildId, options);
					break;
			}

			// Take top N keywords
			keywords = keywords.slice(0, topN);

			console.log(
				`[KeywordExtractor] Extracted ${keywords.length} keywords in ${Date.now() - startTime}ms (method: ${method})`,
			);

			return {
				terms: keywords,
				extracted_at: new Date().toISOString(),
				method,
				version: this.VERSION,
			};
		} catch (error) {
			console.error("[KeywordExtractor] Error extracting keywords:", error);
			return this.createEmptyKeywords();
		}
	}

	/**
	 * Extract keywords using TF-IDF only
	 */
	private async extractTFIDF(
		messages: KeywordMessage[],
		guildId: string,
		options: KeywordExtractionOptions,
	): Promise<KeywordScore[]> {
		// Get or load vocabulary
		const vocabulary = await this.getVocabulary(guildId);

		// Extract using TF-IDF
		const result = this.tfidfExtractor.extractKeywords(messages, {
			...options,
			vocabulary: vocabulary?.vocabulary,
		});

		return result.keywords;
	}

	/**
	 * Extract keywords using semantic clustering only
	 */
	private async extractSemantic(
		messages: KeywordMessage[],
		options: KeywordExtractionOptions,
	): Promise<KeywordScore[]> {
		const topN = options.topN || 10;
		const result = await this.semanticExtractor.extractKeywords(
			messages,
			topN,
		);
		return result.keywords;
	}

	/**
	 * Extract keywords using hybrid approach (TF-IDF + semantic)
	 */
	private async extractHybrid(
		messages: KeywordMessage[],
		guildId: string,
		options: KeywordExtractionOptions,
	): Promise<KeywordScore[]> {
		const topN = options.topN || 10;

		// Extract with both methods
		const [tfidfKeywords, semanticKeywords] = await Promise.all([
			this.extractTFIDF(messages, guildId, { ...options, topN: topN * 2 }),
			this.extractSemantic(messages, { ...options, topN: topN * 2 }),
		]);

		// Merge results with 70% TF-IDF, 30% semantic weight
		const merged = this.semanticExtractor.mergeWithTFIDF(
			semanticKeywords,
			tfidfKeywords,
			0.3,
		);

		return merged;
	}

	/**
	 * Get vocabulary for a guild (from cache or database)
	 */
	private async getVocabulary(
		guildId: string,
	): Promise<GuildVocabulary | null> {
		// Check cache first
		const cached = this.vocabularyCache.get(guildId);
		if (cached) {
			// Check if cache is still valid
			const age = Date.now() - cached.last_updated.getTime();
			if (age < this.CACHE_TTL_MS) {
				return cached;
			}
		}

		// Load from database
		const vocabulary = await this.loadVocabularyFromDatabase(guildId);

		if (vocabulary) {
			// Cache it
			this.vocabularyCache.set(guildId, vocabulary);
			return vocabulary;
		}

		return null;
	}

	/**
	 * Load vocabulary from database
	 */
	private async loadVocabularyFromDatabase(
		guildId: string,
	): Promise<GuildVocabulary | null> {
		try {
			const result = await this.db.query<{
				term: string;
				idf_score: number;
				document_frequency: number;
				total_documents: number;
				is_stopword: boolean;
			}>(`
        SELECT term, idf_score, document_frequency, total_documents, is_stopword
        FROM guild_vocabulary
        WHERE guild_id = $1
      `, [guildId]);

			if (!result.success || !result.data || result.data.length === 0) {
				return null;
			}

			// Convert to Map
			const vocabulary = new Map(
				result.data.map((entry) => [
					entry.term,
					{
						term: entry.term,
						idf_score: entry.idf_score,
						document_frequency: entry.document_frequency,
						total_documents: entry.total_documents,
						is_stopword: entry.is_stopword,
					},
				]),
			);

			// Get metadata (use first entry for total_documents)
			const totalDocs = result.data[0]?.total_documents || 0;

			// Calculate stats
			const idfScores = result.data
				.filter((e) => !e.is_stopword)
				.map((e) => e.idf_score)
				.sort((a, b) => a - b);

			const stats = {
				total_terms: vocabulary.size,
				stopword_count: result.data.filter((e) => e.is_stopword).length,
				avg_idf:
					idfScores.length > 0
						? idfScores.reduce((sum, s) => sum + s, 0) / idfScores.length
						: 0,
				median_idf:
					idfScores.length > 0
						? idfScores[Math.floor(idfScores.length / 2)]
						: 0,
				p90_idf:
					idfScores.length > 0
						? idfScores[Math.floor(idfScores.length * 0.9)]
						: 0,
			};

			return {
				guild_id: guildId,
				vocabulary,
				last_updated: new Date(),
				total_conversations: totalDocs,
				stats,
			};
		} catch (error) {
			console.error(
				"[KeywordExtractor] Error loading vocabulary from database:",
				error,
			);
			return null;
		}
	}

	/**
	 * Build vocabulary for a guild (expensive operation)
	 */
	async buildVocabulary(guildId: string, forceRebuild = false): Promise<void> {
		console.log(
			`[KeywordExtractor] Building vocabulary for guild ${guildId}...`,
		);

		const vocabulary = await this.vocabularyBuilder.buildVocabulary({
			guildId,
			forceRebuild,
		});

		// Save to database
		await this.saveVocabularyToDatabase(vocabulary);

		// Update cache
		this.vocabularyCache.set(guildId, vocabulary);

		console.log(
			`[KeywordExtractor] Vocabulary built and saved: ${vocabulary.stats.total_terms} terms`,
		);
	}

	/**
	 * Save vocabulary to database
	 */
	private async saveVocabularyToDatabase(
		vocabulary: GuildVocabulary,
	): Promise<void> {
		try {
			// Delete existing vocabulary for this guild
			await this.db.query(
				`DELETE FROM guild_vocabulary WHERE guild_id = $1`,
				[vocabulary.guild_id],
			);

			// Insert new vocabulary
			const entries = Array.from(vocabulary.vocabulary.values());

			if (entries.length === 0) {
				console.log(
					"[KeywordExtractor] No vocabulary entries to save (empty vocabulary)",
				);
				return;
			}

			// Batch insert in chunks to avoid PostgreSQL parameter limit
			// PostgreSQL has a limit of ~65k parameters, and we have 6 params per entry
			// So we'll insert in chunks of 10,000 entries (60k params)
			const CHUNK_SIZE = 10000;
			let totalInserted = 0;

			for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
				const chunk = entries.slice(i, i + CHUNK_SIZE);
				const values: string[] = [];
				const params: (string | number | boolean)[] = [];
				let paramIndex = 1;

				for (const entry of chunk) {
					values.push(
						`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5})`,
					);
					params.push(
						vocabulary.guild_id,
						entry.term,
						entry.idf_score,
						entry.document_frequency,
						entry.total_documents,
						entry.is_stopword,
					);
					paramIndex += 6;
				}

				const query = `
          INSERT INTO guild_vocabulary (guild_id, term, idf_score, document_frequency, total_documents, is_stopword)
          VALUES ${values.join(", ")}
        `;

				await this.db.query(query, params);
				totalInserted += chunk.length;

				if (entries.length > CHUNK_SIZE) {
					console.log(
						`[KeywordExtractor] Saved ${totalInserted}/${entries.length} vocabulary entries...`,
					);
				}
			}

			console.log(
				`[KeywordExtractor] Saved ${totalInserted} vocabulary entries to database`,
			);
		} catch (error) {
			console.error(
				"[KeywordExtractor] Error saving vocabulary to database:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Clear vocabulary cache
	 */
	clearCache(guildId?: string): void {
		if (guildId) {
			this.vocabularyCache.delete(guildId);
		} else {
			this.vocabularyCache.clear();
		}
	}

	/**
	 * Get vocabulary statistics for a guild
	 */
	async getVocabularyStats(guildId: string) {
		const vocabulary = await this.getVocabulary(guildId);
		return vocabulary?.stats || null;
	}

	/**
	 * Create empty keywords result
	 */
	private createEmptyKeywords(): ConversationKeywords {
		return {
			terms: [],
			extracted_at: new Date().toISOString(),
			method: "none",
			version: this.VERSION,
		};
	}

	/**
	 * Calculate keyword overlap between two conversations
	 */
	calculateKeywordOverlap(
		keywords1: ConversationKeywords,
		keywords2: ConversationKeywords,
		weighted = true,
	): number {
		if (weighted) {
			return this.tfidfExtractor.calculateWeightedKeywordOverlap(
				keywords1.terms,
				keywords2.terms,
			);
		}
		return this.tfidfExtractor.calculateKeywordOverlap(
			keywords1.terms,
			keywords2.terms,
		);
	}
}
