/**
 * TFIDFExtractor - Extract keywords from conversations using TF-IDF
 *
 * This class takes a conversation's messages and a guild vocabulary to extract
 * the most important keywords using TF-IDF (Term Frequency - Inverse Document Frequency).
 * Supports n-grams (1-3 word phrases) for richer keyword extraction.
 */

import type {
	KeywordExtractionOptions,
	KeywordExtractionResult,
	KeywordMessage,
	KeywordScore,
	TFIDFScore,
	VocabularyEntry,
} from "./types";

export class TFIDFExtractor {
	// Default extraction parameters
	private readonly DEFAULT_TOP_N = 10;
	private readonly DEFAULT_MIN_SCORE = 0.1;
	private readonly MAX_NGRAM_LENGTH = 3;

	/**
	 * Extract keywords from messages using TF-IDF
	 */
	extractKeywords(
		messages: KeywordMessage[],
		options: KeywordExtractionOptions = {},
	): KeywordExtractionResult {
		const startTime = Date.now();

		if (messages.length === 0) {
			return this.createEmptyResult();
		}

		// Combine all messages into a single document
		const document = messages.map((m) => m.content).join(" ");

		// Extract terms and calculate TF (Term Frequency)
		const termFrequency = this.calculateTermFrequency(document);

		// Calculate TF-IDF scores using vocabulary (if provided)
		const tfidfScores = this.calculateTFIDFScores(
			termFrequency,
			options.vocabulary,
		);

		// Filter by minimum score
		const minScore = options.minScore || this.DEFAULT_MIN_SCORE;
		const filteredScores = tfidfScores.filter((score) => score.tfidf >= minScore);

		// Sort by TF-IDF score and take top N
		const topN = options.topN || this.DEFAULT_TOP_N;
		const topScores = filteredScores
			.sort((a, b) => b.tfidf - a.tfidf)
			.slice(0, topN);

		// Convert to KeywordScore format
		const keywords = this.convertToKeywordScores(topScores);

		const processingTime = Date.now() - startTime;

		return {
			keywords,
			metadata: {
				method: "tfidf",
				processing_time_ms: processingTime,
				message_count: messages.length,
				total_terms_analyzed: tfidfScores.length,
				vocabulary_size: options.vocabulary?.size,
			},
		};
	}

	/**
	 * Calculate term frequency (TF) for all terms in document
	 * TF = (count of term in document) / (total terms in document)
	 */
	private calculateTermFrequency(text: string): Map<string, TFIDFScore> {
		const termFrequency = new Map<string, TFIDFScore>();

		// Extract all terms (including n-grams)
		const terms = this.extractTermsFromDocument(text);

		// Count total terms for normalization
		const totalTerms = terms.length;

		// Calculate frequency for each unique term
		const termCounts = new Map<string, number>();
		for (const term of terms) {
			termCounts.set(term, (termCounts.get(term) || 0) + 1);
		}

		// Calculate normalized TF
		for (const [term, count] of termCounts.entries()) {
			const tf = count / totalTerms;

			termFrequency.set(term, {
				term,
				tf,
				idf: 0, // Will be filled later
				tfidf: 0, // Will be calculated later
				count,
			});
		}

		return termFrequency;
	}

	/**
	 * Calculate TF-IDF scores using guild vocabulary
	 */
	private calculateTFIDFScores(
		termFrequency: Map<string, TFIDFScore>,
		vocabulary?: Map<string, VocabularyEntry>,
	): TFIDFScore[] {
		const scores: TFIDFScore[] = [];

		for (const [term, tfScore] of termFrequency.entries()) {
			// Additional safety check: filter URL-related terms even if in vocabulary
			if (!this.isValidNgram(term)) {
				continue;
			}

			// Get IDF from vocabulary, or use default if not available
			let idf = 1.0; // Default IDF for unknown terms

			if (vocabulary) {
				const vocabEntry = vocabulary.get(term);
				if (vocabEntry) {
					// Skip stopwords
					if (vocabEntry.is_stopword) continue;

					idf = vocabEntry.idf_score;
				}
			}

			// Calculate TF-IDF
			const tfidf = tfScore.tf * idf;

			scores.push({
				term,
				tf: tfScore.tf,
				idf,
				tfidf,
				count: tfScore.count,
			});
		}

		return scores;
	}

	/**
	 * Extract all terms (1-3 word n-grams) from document
	 */
	private extractTermsFromDocument(text: string): string[] {
		const terms: string[] = [];

		// Tokenize: lowercase, remove special chars except spaces, split on whitespace
		const tokens = text
			.toLowerCase()
			.replace(/[^\w\s'-]/g, " ") // Keep hyphens and apostrophes
			.split(/\s+/)
			.filter((token) => token.length > 0);

		// Extract unigrams (single words)
		for (const token of tokens) {
			if (this.isValidToken(token)) {
				terms.push(token);
			}
		}

		// Extract bigrams (2-word phrases)
		for (let i = 0; i < tokens.length - 1; i++) {
			if (
				this.isValidToken(tokens[i]) &&
				this.isValidToken(tokens[i + 1])
			) {
				const bigram = `${tokens[i]} ${tokens[i + 1]}`;
				if (this.isValidNgram(bigram)) {
					terms.push(bigram);
				}
			}
		}

		// Extract trigrams (3-word phrases)
		if (this.MAX_NGRAM_LENGTH >= 3) {
			for (let i = 0; i < tokens.length - 2; i++) {
				if (
					this.isValidToken(tokens[i]) &&
					this.isValidToken(tokens[i + 1]) &&
					this.isValidToken(tokens[i + 2])
				) {
					const trigram = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
					if (this.isValidNgram(trigram)) {
						terms.push(trigram);
					}
				}
			}
		}

		return terms;
	}

	/**
	 * Validate if an n-gram should be included (checks for URL fragments in the phrase)
	 */
	private isValidNgram(ngram: string): boolean {
		// URL-related tokens that should disqualify the entire n-gram
		const urlTokens = new Set([
			"http", "https", "www", "ftp", "ssh",
			"com", "org", "net", "edu", "gov", "io", "co", "ai", "app",
			"youtube", "youtu", "tenor", "discord", "twitter", "github",
			"reddit", "imgur", "giphy", "spotify", "twitch", "steam",
			"view", "watch", "embed", "api", "cdn", "static", "media",
			"be", "gif", "jpg", "png", "mp4", "webm",
			"discordapp", "attachments",
		]);

		// Check if any word in the n-gram is a URL token
		const words = ngram.toLowerCase().split(" ");
		for (const word of words) {
			if (urlTokens.has(word)) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Validate if a token should be included
	 */
	private isValidToken(token: string): boolean {
		// Must be at least 2 characters
		if (token.length < 2) return false;

		// Skip pure numbers
		if (/^\d+$/.test(token)) return false;

		// Skip tokens that are mostly special characters
		if (token.replace(/[\w-]/g, "").length > token.length / 2) return false;

		// Skip URL/link-related tokens
		const urlTokens = new Set([
			// Protocols and common URL parts
			"http", "https", "www", "ftp", "ssh",
			// Top-level domains
			"com", "org", "net", "edu", "gov", "io", "co", "ai", "app",
			// Common domains and services
			"youtube", "youtu", "tenor", "discord", "twitter", "github",
			"reddit", "imgur", "giphy", "spotify", "twitch", "steam",
			// URL path components
			"view", "watch", "embed", "api", "cdn", "static", "media",
			// Common URL patterns
			"www", "be", "gif", "jpg", "png", "mp4", "webm",
			"discordapp", "attachments",
		]);

		if (urlTokens.has(token.toLowerCase())) return false;

		// Skip tokens that look like URL fragments (e.g., "m3u8", "v=")
		if (/^[a-z]\d+$/.test(token)) return false; // e.g., "v1", "m3", "x2"

		return true;
	}

	/**
	 * Convert TFIDFScore to KeywordScore format
	 */
	private convertToKeywordScores(tfidfScores: TFIDFScore[]): KeywordScore[] {
		return tfidfScores.map((score) => {
			// Determine keyword type based on word count
			const wordCount = score.term.split(" ").length;
			let type: KeywordScore["type"] = "tfidf";

			if (wordCount === 2) {
				type = "tfidf-bigram";
			} else if (wordCount === 3) {
				type = "tfidf-trigram";
			}

			// Normalize TF-IDF score to 0-1 range
			// Use min-max normalization within the current set
			const maxTfidf = Math.max(...tfidfScores.map((s) => s.tfidf));
			const normalizedScore =
				maxTfidf > 0 ? score.tfidf / maxTfidf : score.tfidf;

			return {
				word: score.term,
				score: normalizedScore,
				count: score.count,
				type,
			};
		});
	}

	/**
	 * Create empty result when no messages provided
	 */
	private createEmptyResult(): KeywordExtractionResult {
		return {
			keywords: [],
			metadata: {
				method: "tfidf",
				processing_time_ms: 0,
				message_count: 0,
				total_terms_analyzed: 0,
			},
		};
	}

	/**
	 * Extract keywords without vocabulary (fallback mode)
	 * Uses simpler frequency-based approach when no guild vocabulary available
	 */
	extractKeywordsSimple(
		messages: KeywordMessage[],
		topN = 10,
	): KeywordScore[] {
		if (messages.length === 0) return [];

		const document = messages.map((m) => m.content).join(" ");
		const termFrequency = this.calculateTermFrequency(document);

		// Sort by raw TF and count (no IDF available)
		const topTerms = Array.from(termFrequency.values())
			.filter((score) => score.count >= 2) // Must appear at least twice
			.sort((a, b) => {
				// Prefer higher frequency and higher count
				const scoreA = a.tf * Math.log(a.count + 1);
				const scoreB = b.tf * Math.log(b.count + 1);
				return scoreB - scoreA;
			})
			.slice(0, topN);

		return this.convertToKeywordScores(topTerms);
	}

	/**
	 * Get keyword overlap score between two sets of keywords (0-1)
	 */
	calculateKeywordOverlap(
		keywords1: KeywordScore[],
		keywords2: KeywordScore[],
	): number {
		if (keywords1.length === 0 || keywords2.length === 0) return 0;

		const terms1 = new Set(keywords1.map((k) => k.word));
		const terms2 = new Set(keywords2.map((k) => k.word));

		// Calculate Jaccard similarity: intersection / union
		const intersection = new Set(
			[...terms1].filter((term) => terms2.has(term)),
		);
		const union = new Set([...terms1, ...terms2]);

		return intersection.size / union.size;
	}

	/**
	 * Get weighted keyword overlap score (considers keyword importance)
	 */
	calculateWeightedKeywordOverlap(
		keywords1: KeywordScore[],
		keywords2: KeywordScore[],
	): number {
		if (keywords1.length === 0 || keywords2.length === 0) return 0;

		// Create maps of term -> score
		const scoreMap1 = new Map(keywords1.map((k) => [k.word, k.score]));
		const scoreMap2 = new Map(keywords2.map((k) => [k.word, k.score]));

		// Calculate weighted overlap
		let overlapScore = 0;
		let totalPossibleScore = 0;

		const allTerms = new Set([...scoreMap1.keys(), ...scoreMap2.keys()]);

		for (const term of allTerms) {
			const score1 = scoreMap1.get(term) || 0;
			const score2 = scoreMap2.get(term) || 0;

			// Add minimum of both scores to overlap (shared importance)
			overlapScore += Math.min(score1, score2);

			// Add maximum of both scores to total (max possible)
			totalPossibleScore += Math.max(score1, score2);
		}

		return totalPossibleScore > 0 ? overlapScore / totalPossibleScore : 0;
	}
}
