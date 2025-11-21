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

		// Check for exact matches first (highest confidence)
		for (const variation of this.variations) {
			const pattern = new RegExp(`\\b${variation.toLowerCase()}\\b`, "i");
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
		const distance = this.levenshteinDistance(str1, str2);
		const maxLength = Math.max(str1.length, str2.length);

		if (maxLength === 0) return 1.0;

		return 1 - distance / maxLength;
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
	 * @returns User query without trigger word
	 */
	public extractQuery(text: string, triggerWordPosition: number): string {
		// Find the end of the trigger word
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
