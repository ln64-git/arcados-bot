import Fuse from "fuse.js";
import type { SearchResult } from "../../types.js";
import type { SelectionResult, SelectionStrategy } from "../../types/selection.js";

/**
 * Strategy for fuzzy matching selection (e.g., "the one with homer", "simpsons s01e03")
 */
export class FuzzyStrategy implements SelectionStrategy {
  private fuse: Fuse<SearchResult>;

  constructor(results: SearchResult[]) {
    // Configure Fuse.js for fuzzy matching
    this.fuse = new Fuse(results, {
      keys: [
        { name: "title", weight: 0.7 },
        { name: "description", weight: 0.3 },
      ],
      threshold: 0.5, // 0 = perfect match, 1 = match anything
      includeScore: true,
      minMatchCharLength: 2,
    });
  }

  /**
   * Match fuzzy selection to search results
   * Uses Fuse.js for intelligent fuzzy matching
   */
  match(query: string, results: SearchResult[]): SelectionResult | null {
    if (!query || results.length === 0) {
      return null;
    }

    // Always create a new Fuse instance with current results
    // (Fuse.js doesn't have a reliable way to check collection length)
    this.fuse = new Fuse(results, {
      keys: [
        { name: "title", weight: 0.7 },
        { name: "description", weight: 0.3 },
      ],
      threshold: 0.5,
      includeScore: true,
      minMatchCharLength: 2,
    });

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return null;
    }

    // Search using Fuse.js
    const searchResults = this.fuse.search(trimmed);

    if (searchResults.length === 0) {
      return null;
    }

    // Get best match
    const bestMatch = searchResults[0];
    if (!bestMatch) {
      return null;
    }

    const score = bestMatch.score || 1.0;

    // Convert Fuse.js score (0 = perfect, 1 = worst) to confidence (1 = perfect, 0 = worst)
    const confidence = 1.0 - score;

    return {
      selected: bestMatch.item,
      confidence,
      method: "fuzzy",
      index: results.indexOf(bestMatch.item),
    };
  }
}

