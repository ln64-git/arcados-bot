/**
 * VocabularyBuilder - Builds per-guild TF-IDF vocabulary
 *
 * This class analyzes all conversations in a guild to build a corpus-specific
 * vocabulary with IDF (Inverse Document Frequency) scores. It automatically
 * identifies stopwords based on frequency distribution rather than hardcoded lists.
 */

import type { PostgreSQLManager } from "../../../database/PostgreSQLManager";
import type {
	GuildVocabulary,
	VocabularyBuildOptions,
	VocabularyEntry,
	VocabularyStats,
} from "./types";

export class VocabularyBuilder {
	private db: PostgreSQLManager;

	// Vocabulary building parameters
	private readonly DEFAULT_MIN_DOC_FREQUENCY = 2; // Ignore terms in < 2 conversations
	private readonly DEFAULT_MAX_DOC_FREQUENCY = 0.8; // Mark as stopword if in > 80% of conversations
	private readonly MAX_NGRAM_LENGTH = 3; // Support 1-3 word phrases

	constructor(db: PostgreSQLManager) {
		this.db = db;
	}

	/**
	 * Build vocabulary for a guild by analyzing all conversations
	 */
	async buildVocabulary(
		options: VocabularyBuildOptions,
	): Promise<GuildVocabulary> {
		const startTime = Date.now();
		console.log(
			`[VocabularyBuilder] Building vocabulary for guild ${options.guildId}...`,
		);

		// Fetch all conversations for the guild
		const conversations = await this.fetchGuildConversations(options);
		console.log(
			`[VocabularyBuilder] Analyzing ${conversations.length} conversations`,
		);

		if (conversations.length === 0) {
			console.warn(
				`[VocabularyBuilder] No conversations found for guild ${options.guildId}`,
			);
			return this.createEmptyVocabulary(options.guildId);
		}

		// Build term document frequency map
		const termDocFreq = this.buildTermDocumentFrequency(conversations);
		console.log(
			`[VocabularyBuilder] Found ${termDocFreq.size} unique terms`,
		);

		// Calculate IDF scores and identify stopwords
		const vocabulary = this.calculateIDFScores(
			termDocFreq,
			conversations.length,
			options,
		);

		// Calculate statistics
		const stats = this.calculateVocabularyStats(vocabulary);

		const processingTime = Date.now() - startTime;
		console.log(
			`[VocabularyBuilder] Vocabulary built in ${processingTime}ms - ${stats.total_terms} terms, ${stats.stopword_count} stopwords`,
		);

		return {
			guild_id: options.guildId,
			vocabulary,
			last_updated: new Date(),
			total_conversations: conversations.length,
			stats,
		};
	}

	/**
	 * Fetch all conversations for a guild from the database
	 */
	private async fetchGuildConversations(
		options: VocabularyBuildOptions,
	): Promise<Array<{ id: string; messages: string[] }>> {
		const result = await this.db.query(
			`
        SELECT id, message_ids
        FROM conversation_segments
        WHERE guild_id = $1
          AND status = 'finalized'
          AND message_count >= 2
        ORDER BY created_at DESC
        ${options.sampleSize ? `LIMIT ${options.sampleSize}` : ""}
      `,
			[options.guildId],
		);

		if (!result.success || !result.data) {
			console.error(
				"[VocabularyBuilder] Failed to fetch conversations:",
				result.error,
			);
			return [];
		}

		const conversations: Array<{ id: string; messages: string[] }> = [];

		// Fetch message content for each conversation
		for (const segment of result.data) {
			if (segment.message_ids.length === 0) continue;

			const messagesResult = await this.db.query(
				`
          SELECT content
          FROM messages
          WHERE id = ANY($1::TEXT[])
            AND content IS NOT NULL
            AND content != ''
        `,
				[segment.message_ids],
			);

			if (messagesResult.success && messagesResult.data) {
				const messageContents = messagesResult.data
					.map((m: { content: string }) => m.content)
					.filter((c: string) => c && c.trim().length > 0);

				if (messageContents.length > 0) {
					conversations.push({
						id: segment.id,
						messages: messageContents,
					});
				}
			}
		}

		return conversations;
	}

	/**
	 * Build term document frequency map (how many conversations contain each term)
	 */
	private buildTermDocumentFrequency(
		conversations: Array<{ id: string; messages: string[] }>,
	): Map<string, number> {
		const termDocFreq = new Map<string, number>();

		for (const conversation of conversations) {
			// Combine all messages in conversation into one document
			const document = conversation.messages.join(" ");

			// Extract unique terms from this document (including n-grams)
			const terms = this.extractTermsFromDocument(document);

			// Increment document frequency for each unique term
			for (const term of terms) {
				termDocFreq.set(term, (termDocFreq.get(term) || 0) + 1);
			}
		}

		return termDocFreq;
	}

	/**
	 * Extract all terms (1-3 word n-grams) from a document
	 */
	private extractTermsFromDocument(text: string): Set<string> {
		const terms = new Set<string>();

		// Tokenize: lowercase, remove special chars except spaces, split on whitespace
		const tokens = text
			.toLowerCase()
			.replace(/[^\w\s'-]/g, " ") // Keep hyphens and apostrophes
			.split(/\s+/)
			.filter((token) => token.length > 0);

		// Extract unigrams (single words)
		for (const token of tokens) {
			if (this.isValidToken(token)) {
				terms.add(token);
			}
		}

		// Extract bigrams (2-word phrases)
		for (let i = 0; i < tokens.length - 1; i++) {
			const current = tokens[i];
			const next = tokens[i + 1];
			if (!current || !next) continue;

			if (this.isValidToken(current) && this.isValidToken(next)) {
				const bigram = `${current} ${next}`;
				// Also validate the combined bigram
				if (this.isValidNgram(bigram)) {
					terms.add(bigram);
				}
			}
		}

		// Extract trigrams (3-word phrases)
		if (this.MAX_NGRAM_LENGTH >= 3) {
			for (let i = 0; i < tokens.length - 2; i++) {
				const first = tokens[i];
				const second = tokens[i + 1];
				const third = tokens[i + 2];
				if (!first || !second || !third) {
					continue;
				}

				if (
					this.isValidToken(first) &&
					this.isValidToken(second) &&
					this.isValidToken(third)
				) {
					const trigram = `${first} ${second} ${third}`;
					// Also validate the combined trigram
					if (this.isValidNgram(trigram)) {
						terms.add(trigram);
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
	 * Validate if a token should be included in vocabulary
	 */
	private isValidToken(token: string): boolean {
		// Must be at least 2 characters (allow "js", "py", "go", etc.)
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
	 * Calculate IDF scores and identify stopwords
	 */
	private calculateIDFScores(
		termDocFreq: Map<string, number>,
		totalDocs: number,
		options: VocabularyBuildOptions,
	): Map<string, VocabularyEntry> {
		const vocabulary = new Map<string, VocabularyEntry>();

		const minDocFreq = options.minDocFrequency || this.DEFAULT_MIN_DOC_FREQUENCY;
		const maxDocFreq = options.maxDocFrequency || this.DEFAULT_MAX_DOC_FREQUENCY;
		const maxDocFreqCount = Math.floor(totalDocs * maxDocFreq);

		for (const [term, docFreq] of termDocFreq.entries()) {
			// Filter out rare terms (appear in too few documents)
			if (docFreq < minDocFreq) continue;

			// Calculate IDF: log(total_docs / doc_freq)
			const idf = Math.log(totalDocs / docFreq);

			// Identify stopwords: terms that appear in too many documents
			const isStopword = docFreq >= maxDocFreqCount;

			vocabulary.set(term, {
				term,
				idf_score: idf,
				document_frequency: docFreq,
				total_documents: totalDocs,
				is_stopword: isStopword,
			});
		}

		return vocabulary;
	}

	/**
	 * Calculate vocabulary statistics
	 */
	private calculateVocabularyStats(
		vocabulary: Map<string, VocabularyEntry>,
	): VocabularyStats {
		const idfScores = Array.from(vocabulary.values())
			.filter((entry) => !entry.is_stopword)
			.map((entry) => entry.idf_score)
			.sort((a, b) => a - b);

		const stopwordCount = Array.from(vocabulary.values()).filter(
			(entry) => entry.is_stopword,
		).length;

		return {
			total_terms: vocabulary.size,
			stopword_count: stopwordCount,
			avg_idf:
				idfScores.length > 0
					? idfScores.reduce((sum, score) => sum + score, 0) / idfScores.length
					: 0,
			median_idf:
				idfScores.length > 0
					? idfScores[Math.floor(idfScores.length / 2)] ?? 0
					: 0,
			p90_idf:
				idfScores.length > 0
					? idfScores[Math.floor(idfScores.length * 0.9)] ?? 0
					: 0,
		};
	}

	/**
	 * Create empty vocabulary when no data available
	 */
	private createEmptyVocabulary(guildId: string): GuildVocabulary {
		return {
			guild_id: guildId,
			vocabulary: new Map(),
			last_updated: new Date(),
			total_conversations: 0,
			stats: {
				total_terms: 0,
				stopword_count: 0,
				avg_idf: 0,
				median_idf: 0,
				p90_idf: 0,
			},
		};
	}

	/**
	 * Get terms by IDF score threshold (useful for filtering)
	 */
	getHighValueTerms(
		vocabulary: GuildVocabulary,
		minIDF: number,
	): VocabularyEntry[] {
		return Array.from(vocabulary.vocabulary.values())
			.filter((entry) => !entry.is_stopword && entry.idf_score >= minIDF)
			.sort((a, b) => b.idf_score - a.idf_score);
	}

	/**
	 * Get vocabulary entry for a specific term
	 */
	getTermEntry(
		vocabulary: GuildVocabulary,
		term: string,
	): VocabularyEntry | undefined {
		return vocabulary.vocabulary.get(term.toLowerCase());
	}
}
