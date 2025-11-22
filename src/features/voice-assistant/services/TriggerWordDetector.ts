import { config } from "../../../config/index.js";
import type { TriggerWordResult } from "../types.js";

/**
 * Detects trigger words (e.g., "Aria") in transcribed text
 * Uses case-insensitive matching with fuzzy matching support
 */
export class TriggerWordDetector {
	private static instance: TriggerWordDetector;
	private readonly triggerWord: string;
	private readonly variations: Set<string>;

	// Cache compiled regex patterns for each variation (performance optimization)
	private readonly variationPatterns: Map<string, RegExp> = new Map();

	// Cache Levenshtein distance calculations
	private readonly similarityCache: Map<string, number> = new Map();

	private constructor() {
		this.triggerWord = config.voiceAssistantTriggerWord.toLowerCase();

		// Generate common variations and misspellings
		this.variations = new Set([
			this.triggerWord, // "aria"
			this.triggerWord.charAt(0).toUpperCase() + this.triggerWord.slice(1), // "Aria"
			this.triggerWord.toUpperCase(), // "ARIA"
		]);

		// Add common phonetic variations for "aria"
		if (this.triggerWord === "aria") {
			this.variations.add("arya");
			this.variations.add("ariah");
			this.variations.add("area"); // Common mishearing
			this.variations.add("ariya");
			this.variations.add("are you"); // Very common STT mishearing
			this.variations.add("ari");
			this.variations.add("airy");
			this.variations.add("arianna");
		}

		// Pre-compile regex patterns for all variations
		for (const variation of this.variations) {
			const escapedVariation = variation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const pattern = new RegExp(`\\b${escapedVariation}\\b`, "i");
			this.variationPatterns.set(variation, pattern);
		}
	}

	public static getInstance(): TriggerWordDetector {
		if (!TriggerWordDetector.instance) {
			TriggerWordDetector.instance = new TriggerWordDetector();
		}
		return TriggerWordDetector.instance;
	}

	/**
	 * Detect trigger word in transcribed text
	 *
	 * @param text Transcribed text to search
	 * @returns Detection result with confidence score
	 */
	public detect(text: string): TriggerWordResult {
		if (!text || text.trim().length === 0) {
			return {
				detected: false,
				confidence: 0,
			};
		}

		const normalizedText = text.toLowerCase();

		// Check for exact matches first (highest confidence) using cached patterns
		for (const variation of this.variations) {
			const pattern = this.variationPatterns.get(variation);
			if (!pattern) continue;

			const match = pattern.exec(text);

			if (match) {
				return {
					detected: true,
					confidence: 1.0,
					triggerWord: variation,
					position: match.index,
				};
			}
		}

		// Check for fuzzy matches (medium confidence)
		const fuzzyResult = this.fuzzyMatch(normalizedText);
		if (fuzzyResult.detected) {
			return fuzzyResult;
		}

		// No match found
		return {
			detected: false,
			confidence: 0,
		};
	}

	/**
	 * Fuzzy matching for trigger word detection
	 * Uses Levenshtein distance for similarity
	 *
	 * @param text Normalized text to search
	 * @returns Detection result
	 */
	private fuzzyMatch(text: string): TriggerWordResult {
		const words = text.split(/\s+/);
		const threshold = 0.7; // 70% similarity required

		for (let i = 0; i < words.length; i++) {
			const wordAtIndex = words[i];
			if (!wordAtIndex) continue; // Skip undefined entries

			const word = wordAtIndex.replace(/[^\w]/g, ""); // Remove punctuation

			// Early exit: skip words that are too different in length
			const lengthDiff = Math.abs(word.length - this.triggerWord.length);
			const maxLength = Math.max(word.length, this.triggerWord.length);
			if (maxLength > 0 && lengthDiff / maxLength > (1 - threshold)) {
				continue; // Length difference too large to meet threshold
			}

			const similarity = this.calculateSimilarity(word, this.triggerWord);

			if (similarity >= threshold) {
				return {
					detected: true,
					confidence: similarity,
					triggerWord: word,
					position: text.indexOf(wordAtIndex),
				};
			}
		}

		return {
			detected: false,
			confidence: 0,
		};
	}

	/**
	 * Calculate similarity between two strings using Levenshtein distance
	 * Returns a score between 0 and 1 (1 = identical)
	 *
	 * @param str1 First string
	 * @param str2 Second string
	 * @returns Similarity score (0-1)
	 */
	private calculateSimilarity(str1: string, str2: string): number {
		// Check cache first
		const cacheKey = `${str1}:${str2}`;
		const cached = this.similarityCache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		// Early exit for identical strings
		if (str1 === str2) {
			this.similarityCache.set(cacheKey, 1.0);
			return 1.0;
		}

		const distance = this.levenshteinDistance(str1, str2);
		const maxLength = Math.max(str1.length, str2.length);

		if (maxLength === 0) {
			this.similarityCache.set(cacheKey, 1.0);
			return 1.0;
		}

		const similarity = 1 - distance / maxLength;

		// Cache the result (limit cache size to prevent memory leaks)
		if (this.similarityCache.size > 1000) {
			// Clear oldest entries (simple strategy: clear half when limit reached)
			const entries = Array.from(this.similarityCache.entries());
			this.similarityCache.clear();
			// Keep only second half
			for (let i = Math.floor(entries.length / 2); i < entries.length; i++) {
				const entry = entries[i];
				if (entry) {
					this.similarityCache.set(entry[0], entry[1]);
				}
			}
		}

		this.similarityCache.set(cacheKey, similarity);
		return similarity;
	}

	/**
	 * Calculate Levenshtein distance between two strings
	 *
	 * @param str1 First string
	 * @param str2 Second string
	 * @returns Edit distance
	 */
	private levenshteinDistance(str1: string, str2: string): number {
		const matrix: number[][] = [];

		// Initialize matrix
		for (let i = 0; i <= str2.length; i++) {
			matrix[i] = [i];
		}

		for (let j = 0; j <= str1.length; j++) {
			if (matrix[0]) {
				matrix[0][j] = j;
			}
		}

		// Fill matrix
		for (let i = 1; i <= str2.length; i++) {
			for (let j = 1; j <= str1.length; j++) {
				const prevRow = matrix[i - 1];
				const prevDiag = prevRow?.[j - 1];
				const prevLeft = matrix[i]?.[j - 1];
				const prevUp = prevRow?.[j];

				if (
					prevDiag !== undefined &&
					prevLeft !== undefined &&
					prevUp !== undefined
				) {
					if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
						matrix[i]![j] = prevDiag;
					} else {
						matrix[i]![j] = Math.min(
							prevDiag + 1, // substitution
							prevLeft + 1, // insertion
							prevUp + 1 // deletion
						);
					}
				}
			}
		}

		const lastRow = matrix[str2.length];
		return lastRow?.[str1.length] ?? 0;
	}

	/**
	 * Extract the user's query after the trigger word
	 *
	 * @param text Full transcribed text
	 * @param triggerWordPosition Position where trigger word was found
	 * @param triggerWord The actual trigger word that was detected (handles multi-word triggers)
	 * @returns User query without trigger word
	 */
	public extractQuery(text: string, triggerWordPosition: number, triggerWord?: string): string {
		// If we know the exact trigger word, use it to extract the query
		if (triggerWord) {
			const triggerEnd = triggerWordPosition + triggerWord.length;
			const afterTrigger = text.slice(triggerEnd).trim();

			// Remove leading punctuation (commas, periods, etc.)
			return afterTrigger.replace(/^[,;.!?\s]+/, "").trim();
		}

		// Fallback: Find the end of the first word (single-word triggers)
		const afterTrigger = text.slice(triggerWordPosition);
		const match = /^\S+\s+(.+)$/i.exec(afterTrigger);

		if (match && match[1]) {
			return match[1].trim();
		}

		// If trigger word is at the end or alone, return empty
		return "";
	}

	/**
	 * Get the configured trigger word
	 */
	public getTriggerWord(): string {
		return this.triggerWord;
	}

	/**
	 * Get all trigger word variations
	 */
	public getVariations(): string[] {
		return Array.from(this.variations);
	}
}
