/**
 * SemanticKeywordExtractor - Extract keywords using embedding-based clustering
 *
 * This class leverages existing message embeddings to identify semantic themes
 * and extract representative keywords through clustering analysis. Complements
 * TF-IDF by capturing semantic relationships beyond term frequency.
 */

import type {
	KeywordExtractionResult,
	KeywordMessage,
	KeywordScore,
	SemanticCluster,
} from "./types";

export class SemanticKeywordExtractor {
	// Clustering parameters
	private readonly DEFAULT_NUM_CLUSTERS = 5;
	private readonly MIN_CLUSTER_SIZE = 2;
	private readonly SIMILARITY_THRESHOLD = 0.7;

	/**
	 * Extract semantic keywords from messages using embedding clustering
	 */
	async extractKeywords(
		messages: KeywordMessage[],
		topN = 10,
	): Promise<KeywordExtractionResult> {
		const startTime = Date.now();

		// Filter messages with embeddings
		const messagesWithEmbeddings = messages.filter(
			(m) => m.embedding && m.embedding.length > 0,
		);

		if (messagesWithEmbeddings.length === 0) {
			return this.createEmptyResult();
		}

		// Extract terms from messages
		const terms = this.extractTermsFromMessages(messagesWithEmbeddings);

		if (terms.length === 0) {
			return this.createEmptyResult();
		}

		// Cluster terms semantically using message embeddings
		const clusters = this.clusterTerms(terms, messagesWithEmbeddings);

		// Extract representative keywords from each cluster
		const keywords = this.extractClusterKeywords(clusters, topN);

		const processingTime = Date.now() - startTime;

		return {
			keywords,
			metadata: {
				method: "semantic",
				processing_time_ms: processingTime,
				message_count: messages.length,
				total_terms_analyzed: terms.length,
			},
		};
	}

	/**
	 * Extract all valid terms from messages
	 */
	private extractTermsFromMessages(
		messages: KeywordMessage[],
	): Array<{ term: string; messageIndices: number[]; count: number }> {
		const termMap = new Map<
			string,
			{ messageIndices: Set<number>; count: number }
		>();

		// Extract terms from each message
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i];
			if (!message) continue;
			const tokens = this.tokenize(message.content);

			for (const token of tokens) {
				if (!this.isValidToken(token)) continue;

				if (!termMap.has(token)) {
					termMap.set(token, { messageIndices: new Set(), count: 0 });
				}

				const entry = termMap.get(token);
				if (entry) {
					entry.messageIndices.add(i);
					entry.count++;
				}
			}
		}

		// Convert to array format
		return Array.from(termMap.entries())
			.map(([term, data]) => ({
				term,
				messageIndices: Array.from(data.messageIndices),
				count: data.count,
			}))
			.filter((entry) => entry.count >= 2); // Must appear at least twice
	}

	/**
	 * Cluster terms based on their co-occurrence in messages with similar embeddings
	 */
	private clusterTerms(
		terms: Array<{ term: string; messageIndices: number[]; count: number }>,
		messages: KeywordMessage[],
	): SemanticCluster[] {
		const clusters: SemanticCluster[] = [];

		// Calculate average embedding for each term based on messages it appears in
		const termEmbeddings = new Map<string, number[]>();

		for (const { term, messageIndices } of terms) {
			const embeddings = messageIndices
				.map((idx) => messages[idx]?.embedding)
				.filter((emb): emb is number[] => emb !== undefined && emb.length > 0);

			if (embeddings.length > 0) {
				const avgEmbedding = this.averageEmbeddings(embeddings);
				termEmbeddings.set(term, avgEmbedding);
			}
		}

		// Simple clustering: group terms with similar embeddings
		const clustered = new Set<string>();

		for (const [term, embedding] of termEmbeddings.entries()) {
			if (clustered.has(term)) continue;

			// Find all similar terms
			const clusterTerms: string[] = [term];
			clustered.add(term);

			for (const [otherTerm, otherEmbedding] of termEmbeddings.entries()) {
				if (clustered.has(otherTerm)) continue;

				const similarity = this.cosineSimilarity(embedding, otherEmbedding);

				if (similarity >= this.SIMILARITY_THRESHOLD) {
					clusterTerms.push(otherTerm);
					clustered.add(otherTerm);
				}
			}

			// Only create cluster if it has enough terms
			if (clusterTerms.length >= this.MIN_CLUSTER_SIZE) {
				// Calculate cluster centroid
				const clusterEmbeddings = clusterTerms
					.map((t) => termEmbeddings.get(t))
					.filter((e): e is number[] => e !== undefined);

				const centroid = this.averageEmbeddings(clusterEmbeddings);

				// Calculate cluster density (average similarity to centroid)
				const densities = clusterEmbeddings.map((emb) =>
					this.cosineSimilarity(emb, centroid),
				);
				const avgDensity =
					densities.reduce((sum, d) => sum + d, 0) / densities.length;

				// Count message coverage
				const termData = terms.filter((t) => clusterTerms.includes(t.term));
				const messageCoverage = new Set(
					termData.flatMap((t) => t.messageIndices),
				).size;

				clusters.push({
					label: clusterTerms[0] || "", // Use most frequent term as label
					terms: clusterTerms,
					centroid,
					density: avgDensity,
					message_coverage: messageCoverage,
				});
			}
		}

		return clusters;
	}

	/**
	 * Extract representative keywords from clusters
	 */
	private extractClusterKeywords(
		clusters: SemanticCluster[],
		topN: number,
	): KeywordScore[] {
		const keywords: KeywordScore[] = [];

		// Sort clusters by density and message coverage
		const sortedClusters = clusters.sort((a, b) => {
			const scoreA = a.density * Math.log(a.message_coverage + 1);
			const scoreB = b.density * Math.log(b.message_coverage + 1);
			return scoreB - scoreA;
		});

		// Extract top keywords from each cluster
		for (const cluster of sortedClusters) {
			// Take the label (most representative term) from each cluster
			keywords.push({
				word: cluster.label,
				score: cluster.density,
				count: cluster.message_coverage,
				type: "semantic",
			});

			if (keywords.length >= topN) break;
		}

		return keywords;
	}

	/**
	 * Calculate average of multiple embedding vectors
	 */
	private averageEmbeddings(embeddings: number[][]): number[] {
		if (embeddings.length === 0) return [];

		const firstEmbedding = embeddings[0];
		if (!firstEmbedding) return [];
		
		const dim = firstEmbedding.length;
		const avg = new Array(dim).fill(0);

		for (const embedding of embeddings) {
			for (let i = 0; i < dim; i++) {
				avg[i] += embedding[i];
			}
		}

		for (let i = 0; i < dim; i++) {
			avg[i] /= embeddings.length;
		}

		return avg;
	}

	/**
	 * Calculate cosine similarity between two vectors
	 */
	private cosineSimilarity(vec1: number[], vec2: number[]): number {
		if (vec1.length !== vec2.length) return 0;

		let dotProduct = 0;
		let norm1 = 0;
		let norm2 = 0;

		for (let i = 0; i < vec1.length; i++) {
			const v1 = vec1[i];
			const v2 = vec2[i];
			if (v1 === undefined || v2 === undefined) continue;
			
			dotProduct += v1 * v2;
			norm1 += v1 * v1;
			norm2 += v2 * v2;
		}

		const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
		return magnitude > 0 ? dotProduct / magnitude : 0;
	}

	/**
	 * Tokenize text into words
	 */
	private tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^\w\s'-]/g, " ")
			.split(/\s+/)
			.filter((token) => token.length > 0);
	}

	/**
	 * Validate token
	 */
	private isValidToken(token: string): boolean {
		if (token.length < 2) return false;
		if (/^\d+$/.test(token)) return false;
		if (token.replace(/[\w-]/g, "").length > token.length / 2) return false;
		return true;
	}

	/**
	 * Create empty result
	 */
	private createEmptyResult(): KeywordExtractionResult {
		return {
			keywords: [],
			metadata: {
				method: "semantic",
				processing_time_ms: 0,
				message_count: 0,
				total_terms_analyzed: 0,
			},
		};
	}

	/**
	 * Merge semantic keywords with TF-IDF keywords (hybrid approach)
	 */
	mergeWithTFIDF(
		semanticKeywords: KeywordScore[],
		tfidfKeywords: KeywordScore[],
		semanticWeight = 0.3,
	): KeywordScore[] {
		const merged = new Map<string, KeywordScore>();

		// Add TF-IDF keywords with their weights
		for (const keyword of tfidfKeywords) {
			merged.set(keyword.word, {
				...keyword,
				score: keyword.score * (1 - semanticWeight),
				type: "hybrid",
			});
		}

		// Add or merge semantic keywords
		for (const keyword of semanticKeywords) {
			const existing = merged.get(keyword.word);

			if (existing) {
				// Merge scores if term exists in both
				existing.score += keyword.score * semanticWeight;
				existing.count = Math.max(existing.count, keyword.count);
			} else {
				// Add new semantic keyword
				merged.set(keyword.word, {
					...keyword,
					score: keyword.score * semanticWeight,
					type: "hybrid",
				});
			}
		}

		// Sort by combined score
		return Array.from(merged.values()).sort((a, b) => b.score - a.score);
	}
}
