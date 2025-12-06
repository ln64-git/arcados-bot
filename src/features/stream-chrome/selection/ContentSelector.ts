import type { SearchResult } from "../types.js";
import type {
	SelectionResult,
	SelectionOptions,
} from "../types/selection.js";
import { NumericStrategy } from "./strategies/NumericStrategy.js";
import { FuzzyStrategy } from "./strategies/FuzzyStrategy.js";

/**
 * Unified content selector with fuzzy and numeric matching
 * Uses strategy pattern for different selection methods
 */
export class ContentSelector {
	private numericStrategy: NumericStrategy;
	private fuzzyStrategy: FuzzyStrategy | null = null;
	private options: Required<SelectionOptions>;

	constructor(
		results: SearchResult[],
		options: SelectionOptions = {}
	) {
		this.numericStrategy = new NumericStrategy();
		this.options = {
			autoSelectThreshold: options.autoSelectThreshold ?? 0.8,
			suggestThreshold: options.suggestThreshold ?? 0.5,
		};

		// Initialize fuzzy strategy with results
		if (results.length > 0) {
			this.fuzzyStrategy = new FuzzyStrategy(results);
		}
	}

	/**
	 * Update search results (for when results change)
	 */
	public updateResults(results: SearchResult[]): void {
		if (results.length > 0) {
			this.fuzzyStrategy = new FuzzyStrategy(results);
		} else {
			this.fuzzyStrategy = null;
		}
	}

	/**
	 * Select content based on user query
	 * @param query User's selection query
	 * @param results Available search results
	 * @returns SelectionResult if match found, null otherwise
	 */
	public select(query: string, results: SearchResult[]): SelectionResult | null {
		if (!query || results.length === 0) {
			return null;
		}

		// Update fuzzy strategy if results changed
		if (this.fuzzyStrategy) {
			this.fuzzyStrategy = new FuzzyStrategy(results);
		}

		// Try numeric strategy first (exact match, faster)
		const numericResult = this.numericStrategy.match(query, results);
		if (numericResult) {
			return numericResult;
		}

		// Try fuzzy strategy
		if (this.fuzzyStrategy) {
			const fuzzyResult = this.fuzzyStrategy.match(query, results);
			if (fuzzyResult) {
				return fuzzyResult;
			}
		}

		return null;
	}

	/**
	 * Check if selection should be auto-selected based on confidence
	 * @param result Selection result
	 * @returns True if confidence is high enough for auto-selection
	 */
	public shouldAutoSelect(result: SelectionResult): boolean {
		return result.confidence >= this.options.autoSelectThreshold;
	}

	/**
	 * Check if selection should be suggested (medium confidence)
	 * @param result Selection result
	 * @returns True if confidence is high enough for suggestion
	 */
	public shouldSuggest(result: SelectionResult): boolean {
		return (
			result.confidence >= this.options.suggestThreshold &&
			result.confidence < this.options.autoSelectThreshold
		);
	}

	/**
	 * Check if selection should be rejected (low confidence)
	 * @param result Selection result
	 * @returns True if confidence is too low
	 */
	public shouldReject(result: SelectionResult): boolean {
		return result.confidence < this.options.suggestThreshold;
	}
}

