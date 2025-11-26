/**
 * Smart sentence boundary detection for streaming text
 * Handles common abbreviations, ellipses, and edge cases
 */

export interface SentenceResult {
	completeSentences: string[];
	remainder: string;
}

export class SentenceDetector {
	// Common abbreviations that shouldn't trigger sentence breaks
	private static readonly ABBREVIATIONS = new Set([
		"Dr",
		"Mr",
		"Mrs",
		"Ms",
		"Prof",
		"Sr",
		"Jr",
		"etc",
		"vs",
		"e.g",
		"i.e",
		"Ph.D",
		"M.D",
		"B.A",
		"M.A",
		"U.S",
		"U.K",
		"U.N",
		"E.U",
		"Inc",
		"Ltd",
		"Co",
		"Corp",
		"Ave",
		"St",
		"Rd",
		"Blvd",
	]);

	// Pattern to match sentence terminators
	private static readonly SENTENCE_TERMINATORS = /([.!?]+)(\s+|$)/g;

	/**
	 * Extract complete sentences from a text buffer
	 * @param buffer Current text buffer (may contain partial sentences)
	 * @returns Object with complete sentences and remaining text
	 */
	public static extractSentences(buffer: string): SentenceResult {
		const completeSentences: string[] = [];
		let remainder = buffer;

		// Find all potential sentence boundaries
		const matches = Array.from(buffer.matchAll(this.SENTENCE_TERMINATORS));

		if (matches.length === 0) {
			return { completeSentences: [], remainder: buffer };
		}

		let lastValidEnd = 0;

		for (const match of matches) {
			if (match.index === undefined) continue;

			const endPos = match.index + match[0].length;
			const potentialSentence = buffer.substring(lastValidEnd, endPos).trim();

			// Check if this is a valid sentence boundary
			if (this.isValidSentenceBoundary(potentialSentence, buffer, endPos)) {
				completeSentences.push(potentialSentence);
				lastValidEnd = endPos;
			}
		}

		// Everything after the last valid sentence boundary is the remainder
		remainder = buffer.substring(lastValidEnd).trim();

		return { completeSentences, remainder };
	}

	/**
	 * Check if a period/terminator is a valid sentence boundary
	 */
	private static isValidSentenceBoundary(
		sentence: string,
		fullBuffer: string,
		endPos: number,
	): boolean {
		// Must have some content
		if (sentence.length < 2) return false;

		// Check for abbreviations
		const words = sentence.split(/\s+/);
		const lastWord = words[words.length - 1];

		if (!lastWord) return false;

		// Remove punctuation for abbreviation check
		const cleanWord = lastWord.replace(/[.!?]+$/, "");

		// If it's a known abbreviation, this is NOT a sentence boundary
		if (this.ABBREVIATIONS.has(cleanWord)) {
			return false;
		}

		// Check for single letter + period (could be initial like "J.")
		if (/^[A-Z]\.$/.test(cleanWord)) {
			// If followed by uppercase letter, it's likely an initial
			const nextChar = fullBuffer[endPos];
			if (nextChar && /[A-Z]/.test(nextChar)) {
				return false;
			}
		}

		// Check for ellipsis patterns (e.g., "..." or "…")
		if (/\.{2,}$/.test(lastWord) || sentence.includes("…")) {
			// Ellipsis at end is NOT a sentence boundary (indicates continuation)
			return false;
		}

		// Check for numbers with decimals (e.g., "3.14")
		if (/\d+\.\d*$/.test(sentence)) {
			return false;
		}

		// If next character is lowercase, probably not a sentence boundary
		const nextChar = fullBuffer[endPos];
		if (nextChar && /[a-z]/.test(nextChar)) {
			return false;
		}

		// Looks like a valid sentence boundary
		return true;
	}

	/**
	 * Check if buffer contains at least one complete sentence
	 */
	public static hasCompleteSentence(buffer: string): boolean {
		const result = this.extractSentences(buffer);
		return result.completeSentences.length > 0;
	}

	/**
	 * Get just the first complete sentence from buffer
	 */
	public static getFirstSentence(buffer: string): { sentence: string; remainder: string } | null {
		const result = this.extractSentences(buffer);
		if (result.completeSentences.length === 0) {
			return null;
		}

		const firstSentence = result.completeSentences[0];
		if (!firstSentence) {
			return null;
		}

		const remainingText = buffer.substring(buffer.indexOf(firstSentence) + firstSentence.length);

		return {
			sentence: firstSentence,
			remainder: remainingText.trim(),
		};
	}

	/**
	 * Estimate speaking duration for text (rough approximation)
	 * Assumes average speaking rate of ~150 words per minute
	 * @param text Text to estimate duration for
	 * @returns Estimated duration in milliseconds
	 */
	public static estimateSpeakingDuration(text: string): number {
		const words = text.split(/\s+/).filter((w) => w.length > 0).length;
		const wordsPerMinute = 150;
		const minutes = words / wordsPerMinute;
		return minutes * 60 * 1000;
	}
}
