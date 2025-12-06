import type { SearchResult } from "../types.js";

/**
 * Result of a content selection operation
 */
export interface SelectionResult {
	selected: SearchResult;
	confidence: number; // 0-1, where 1 is exact match
	method: "numeric" | "fuzzy" | "auto";
	index: number; // Original index in search results
}

/**
 * Strategy for matching user selection to search results
 */
export interface SelectionStrategy {
	/**
	 * Attempt to match the user's selection query to a search result
	 * @param query User's selection query (e.g., "2", "the one with homer")
	 * @param results Available search results
	 * @returns SelectionResult if match found, null otherwise
	 */
	match(query: string, results: SearchResult[]): SelectionResult | null;
}

/**
 * Options for content selection
 */
export interface SelectionOptions {
	/**
	 * Minimum confidence threshold for auto-selection (0-1)
	 * Default: 0.8
	 */
	autoSelectThreshold?: number;

	/**
	 * Minimum confidence threshold for suggesting a match (0-1)
	 * Default: 0.5
	 */
	suggestThreshold?: number;
}

