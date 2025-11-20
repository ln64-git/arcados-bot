/**
 * SimpleKeywordExtractor - Pragmatic keyword extraction for Discord conversations
 *
 * This extractor focuses on finding distinctive, meaningful words without over-filtering.
 * Designed specifically for short, casual Discord messages where traditional TF-IDF fails.
 */

import type { KeywordScore } from "./types";

export class SimpleKeywordExtractor {
	// Minimal stopwords - only the most generic function words
	private readonly STOPWORDS = new Set([
		"a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
		"by", "from", "as", "is", "was", "are", "were", "be", "been", "being",
		"i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
		"my", "your", "his", "her", "its", "our", "their", "this", "that", "these", "those",
		"have", "has", "had", "do", "does", "did", "will", "would", "could", "should"
	]);

	// Minimum word length
	private readonly MIN_WORD_LENGTH = 3;

	/**
	 * Extract keywords from messages using a simple frequency-based approach
	 * with smart filtering
	 */
	extractKeywords(
		messages: Array<{ content: string }>,
		topN = 10
	): KeywordScore[] {
		if (messages.length === 0) {
			return [];
		}

		// Combine all message content
		const combinedText = messages.map(m => m.content || "").join(" ");

		// Extract and count all valid words
		const wordCounts = this.countWords(combinedText);

		// Convert to keyword scores
		const keywords = Array.from(wordCounts.entries())
			.map(([word, count]) => ({
				word,
				score: this.calculateScore(word, count, messages.length),
				count: count,
				type: "simple" as const
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, topN);

		return keywords;
	}

	/**
	 * Count valid words in text
	 */
	private countWords(text: string): Map<string, number> {
		const counts = new Map<string, number>();

		// Strip URLs first
		const cleanText = this.stripUrls(text);

		// Tokenize
		const words = cleanText
			.toLowerCase()
			.replace(/[^\w\s'-]/g, " ")
			.split(/\s+/)
			.filter(word => this.isValidWord(word));

		// Count occurrences
		for (const word of words) {
			counts.set(word, (counts.get(word) || 0) + 1);
		}

		return counts;
	}

	/**
	 * Check if a word is valid for keyword extraction
	 */
	private isValidWord(word: string): boolean {
		// Must meet minimum length
		if (word.length < this.MIN_WORD_LENGTH) {
			return false;
		}

		// Skip stopwords
		if (this.STOPWORDS.has(word)) {
			return false;
		}

		// Skip pure numbers
		if (/^\d+$/.test(word)) {
			return false;
		}

		// Skip Discord mentions/emojis
		if (word.startsWith("<@") || word.startsWith("<#") || word.startsWith(":")) {
			return false;
		}

		// Skip common Discord bot commands
		if (word.startsWith("m!") || word.startsWith("!") || word.startsWith(".")) {
			return false;
		}

		// Skip URL fragments (domains, paths, etc.)
		const urlFragments = new Set([
			"http", "https", "www", "com", "org", "net", "io", "youtube", "youtu",
			"tenor", "discord", "gif", "png", "jpg", "mp4", "cdn", "attachments"
		]);
		if (urlFragments.has(word)) {
			return false;
		}

		// Skip tokens that look like random IDs (mix of letters and numbers, 8+ chars)
		if (word.length >= 8) {
			const hasLetters = /[a-z]/.test(word);
			const hasNumbers = /\d/.test(word);
			const hasConsecutiveDigits = /\d{4,}/.test(word);

			if (hasLetters && hasNumbers && hasConsecutiveDigits) {
				return false; // Likely a video ID or similar
			}

			// Skip very low vowel density (random strings)
			const vowels = word.match(/[aeiou]/g);
			const vowelRatio = vowels ? vowels.length / word.length : 0;
			if (vowelRatio < 0.2) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Strip URLs from text
	 */
	private stripUrls(text: string): string {
		let cleaned = text;

		// Remove complete URLs
		cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, " ");
		cleaned = cleaned.replace(/www\.[^\s]+/gi, " ");

		// Remove common URL patterns
		cleaned = cleaned.replace(/\b\w+\.(com|org|net|io|co|ai)[^\s]*/gi, " ");

		return cleaned;
	}

	/**
	 * Calculate relevance score for a word
	 * Higher frequency = higher score, but with diminishing returns
	 */
	private calculateScore(word: string, count: number, totalMessages: number): number {
		// Base score from frequency (with logarithmic scaling to prevent domination)
		const frequencyScore = Math.log(count + 1) / Math.log(totalMessages + 1);

		// Bonus for longer words (they're often more specific/meaningful)
		const lengthBonus = Math.min(word.length / 15, 1.0) * 0.3;

		// Bonus for words with mixed case preservation (often proper nouns or specific terms)
		// Note: This won't work since we lowercase everything, but keeping for future
		const caseBonus = 0;

		// Normalize to 0-1 range
		const score = Math.min(frequencyScore + lengthBonus + caseBonus, 1.0);

		return score;
	}

	/**
	 * Extract n-grams (phrases) from text
	 * Useful for extracting multi-word concepts like "flying fish" or "halal food"
	 */
	extractPhrases(
		messages: Array<{ content: string }>,
		maxNgramLength = 3,
		topN = 5
	): KeywordScore[] {
		if (messages.length === 0) {
			return [];
		}

		const phraseCounts = new Map<string, number>();
		const combinedText = messages.map(m => m.content || "").join(" ");
		const cleanText = this.stripUrls(combinedText);

		// Tokenize
		const words = cleanText
			.toLowerCase()
			.replace(/[^\w\s'-]/g, " ")
			.split(/\s+/)
			.filter(word => word.length >= this.MIN_WORD_LENGTH);

		// Extract n-grams
		for (let n = 2; n <= maxNgramLength; n++) {
			for (let i = 0; i <= words.length - n; i++) {
				const ngram = words.slice(i, i + n);

				// Check if all words in ngram are valid
				if (ngram.every(w => this.isValidWord(w))) {
					const phrase = ngram.join(" ");
					phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
				}
			}
		}

		// Convert to keyword scores (only keep phrases that appear more than once)
		const phrases = Array.from(phraseCounts.entries())
			.filter(([_, count]) => count >= 2) // Phrases must repeat
			.map(([phrase, count]) => ({
				word: phrase,
				score: Math.log(count + 1) / Math.log(messages.length + 1),
				count: count,
				type: "phrase" as const
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, topN);

		return phrases;
	}

	/**
	 * Extract both single words and phrases
	 */
	extractHybrid(
		messages: Array<{ content: string }>,
		topN = 10
	): KeywordScore[] {
		const words = this.extractKeywords(messages, Math.ceil(topN * 0.7));
		const phrases = this.extractPhrases(messages, 3, Math.ceil(topN * 0.3));

		// Combine and sort
		return [...words, ...phrases]
			.sort((a, b) => b.score - a.score)
			.slice(0, topN);
	}
}
