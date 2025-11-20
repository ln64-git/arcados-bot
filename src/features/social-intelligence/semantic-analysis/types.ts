/**
 * Types for keyword extraction and TF-IDF vocabulary management
 */

/**
 * Represents a single keyword with its importance score
 */
export interface KeywordScore {
	/** The keyword term (can be single word or n-gram phrase) */
	word: string;
	/** Importance score (0-1, higher = more important) */
	score: number;
	/** Number of times this keyword appears in the conversation */
	count: number;
	/** Type of keyword extraction used */
	type: "tfidf" | "tfidf-bigram" | "tfidf-trigram" | "semantic" | "hybrid" | "simple" | "phrase";
}

/**
 * Collection of keywords for a conversation
 */
export interface ConversationKeywords {
	/** Top keywords extracted from conversation */
	terms: KeywordScore[];
	/** Timestamp when keywords were extracted */
	extracted_at: string;
	/** Extraction method used */
	method: "tfidf" | "semantic" | "hybrid" | "llm" | "simple";
	/** Version of the extraction algorithm */
	version: string;
}

/**
 * TF-IDF vocabulary entry for a single term in a guild
 */
export interface VocabularyEntry {
	/** The term (word or n-gram) */
	term: string;
	/** Inverse Document Frequency score */
	idf_score: number;
	/** Number of documents (conversations) containing this term */
	document_frequency: number;
	/** Total number of documents in the corpus */
	total_documents: number;
	/** Whether this term is identified as a stopword */
	is_stopword: boolean;
}

/**
 * Guild-level vocabulary statistics
 */
export interface GuildVocabulary {
	/** Guild ID */
	guild_id: string;
	/** Map of term to vocabulary entry */
	vocabulary: Map<string, VocabularyEntry>;
	/** When this vocabulary was last built */
	last_updated: Date;
	/** Total number of conversations analyzed */
	total_conversations: number;
	/** Statistics about the vocabulary */
	stats: VocabularyStats;
}

/**
 * Statistics about vocabulary quality and distribution
 */
export interface VocabularyStats {
	/** Total unique terms in vocabulary */
	total_terms: number;
	/** Number of terms identified as stopwords */
	stopword_count: number;
	/** Average IDF score */
	avg_idf: number;
	/** Median IDF score */
	median_idf: number;
	/** 90th percentile IDF score (high-value terms) */
	p90_idf: number;
}

/**
 * Options for keyword extraction
 */
export interface KeywordExtractionOptions {
	/** Number of top keywords to return */
	topN?: number;
	/** Minimum score threshold (0-1) */
	minScore?: number;
	/** Extraction method to use */
	method?: "tfidf" | "semantic" | "hybrid";
	/** Include n-grams (1-3 words) */
	includeNgrams?: boolean;
	/** Maximum n-gram length */
	maxNgramLength?: number;
	/** Guild vocabulary to use (if available) */
	vocabulary?: Map<string, VocabularyEntry>;
}

/**
 * TF-IDF calculation result for a single term in a document
 */
export interface TFIDFScore {
	/** The term */
	term: string;
	/** Term Frequency (normalized by document length) */
	tf: number;
	/** Inverse Document Frequency */
	idf: number;
	/** Final TF-IDF score (tf * idf) */
	tfidf: number;
	/** Raw count of term in document */
	count: number;
}

/**
 * Semantic keyword cluster from embedding analysis
 */
export interface SemanticCluster {
	/** Representative term for this cluster */
	label: string;
	/** Terms in this semantic cluster */
	terms: string[];
	/** Average embedding vector for this cluster */
	centroid: number[];
	/** Cluster density score (0-1) */
	density: number;
	/** Number of messages containing cluster terms */
	message_coverage: number;
}

/**
 * Result of keyword extraction process
 */
export interface KeywordExtractionResult {
	/** Extracted keywords */
	keywords: KeywordScore[];
	/** Extraction metadata */
	metadata: {
		method: string;
		processing_time_ms: number;
		message_count: number;
		total_terms_analyzed: number;
		vocabulary_size?: number;
	};
}

/**
 * Message data for keyword extraction
 */
export interface KeywordMessage {
	/** Message ID */
	id: string;
	/** Message content */
	content: string;
	/** Message embedding (if available) */
	embedding?: number[];
	/** Author ID */
	author_id: string;
}

/**
 * Vocabulary building options
 */
export interface VocabularyBuildOptions {
	/** Guild ID to build vocabulary for */
	guildId: string;
	/** Minimum document frequency (filter rare terms) */
	minDocFrequency?: number;
	/** Maximum document frequency (auto-detect stopwords) */
	maxDocFrequency?: number;
	/** Force rebuild even if vocabulary exists */
	forceRebuild?: boolean;
	/** Sample size (limit conversations analyzed, 0 = all) */
	sampleSize?: number;
}
