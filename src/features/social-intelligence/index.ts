/**
 * Social Intelligence System - Unified Public API
 *
 * This is the main entry point for the Social Intelligence System.
 * It orchestrates conversation detection, semantic analysis, relationship mapping,
 * and enrichment pipelines.
 *
 * Usage:
 *   const socialIntelligence = new SocialIntelligence(postgresManager);
 *   await socialIntelligence.processMessage(message); // Called by LiveEventSync
 *   const conversations = await socialIntelligence.getConversations(channelId); // Called by AI tools
 */

import type { Message } from "discord.js";
import type { PostgreSQLManager } from "../database/PostgreSQLManager";
import type {
	StreamingConversation,
	FinalizedConversation,
	ConversationQueryOptions,
	RelationshipQueryOptions,
	SemanticSearchOptions,
	RelationshipEntry,
	KeywordScore,
} from "./types";

// Import components
import { ConversationDetector } from "./conversation-detection/ConversationDetector";
import { RelationshipMapper } from "./relationship-mapping/RelationshipMapper";
import { KeywordExtractor } from "./semantic-analysis/KeywordExtractor";
import { EmbeddingService } from "./semantic-analysis/EmbeddingService";
// import { EnrichmentOrchestrator } from "./enrichment-pipeline/EnrichmentOrchestrator"; // TODO: implement

/**
 * Main orchestrator for Social Intelligence System
 *
 * Provides a unified API for:
 * - Processing Discord messages (real-time)
 * - Querying conversations (streaming + finalized)
 * - Querying relationships (live view)
 * - Semantic search
 */
export class SocialIntelligence {
	private db: PostgreSQLManager;

	// Component instances
	private conversationDetector: ConversationDetector;
	private relationshipMapper: RelationshipMapper;
	private keywordExtractor: KeywordExtractor;
	private embeddingService: EmbeddingService;
	// private enrichmentOrchestrator: EnrichmentOrchestrator; // TODO: implement

	constructor(db: PostgreSQLManager) {
		this.db = db;

		// Initialize components
		this.conversationDetector = new ConversationDetector(db);
		this.relationshipMapper = new RelationshipMapper(db);
		this.keywordExtractor = new KeywordExtractor(db);
		this.embeddingService = EmbeddingService.getInstance();
		// this.enrichmentOrchestrator = new EnrichmentOrchestrator(db); // TODO: implement
	}

	// ============================================================================
	// REAL-TIME MESSAGE PROCESSING (Called by LiveEventSync)
	// ============================================================================

	/**
	 * Process a Discord message through the Social Intelligence pipeline
	 *
	 * Flow:
	 * 1. Track interaction edges (relationship mapping)
	 * 2. Buffer message for conversation detection
	 * 3. Create/update streaming conversation if applicable
	 * 4. Extract preliminary keywords (fast TF-IDF)
	 *
	 * @param message Discord message
	 */
	async processMessage(message: Message): Promise<void> {
		if (!message.guildId) return;

		// TODO: Implement full pipeline
		// 1. Track interactions
		// await this.relationshipMapper.recordInteraction(message);

		// 2. Buffer message
		// const conversation = await this.conversationDetector.addMessage(message);

		// 3. Extract preliminary keywords if conversation updated
		// if (conversation) {
		//   const keywords = await this.semanticAnalyzer.extractQuickKeywords(conversation);
		//   await this.conversationDetector.updateStreamingConversation(conversation.id, { keywords });
		// }

		console.log(
			`[SocialIntelligence] processMessage called for message ${message.id} (not yet implemented)`
		);
	}

	// ============================================================================
	// CONVERSATION QUERIES (Called by AI tools)
	// ============================================================================

	/**
	 * Get conversations for a channel
	 *
	 * Returns both streaming (active) and finalized conversations by default.
	 * Streaming conversations have preliminary keywords/embeddings.
	 * Finalized conversations have full enrichment (hybrid keywords, AI labels).
	 *
	 * @param channelId Channel ID
	 * @param options Query options
	 * @returns Array of conversations (streaming + finalized)
	 */
	async getConversations(
		channelId: string,
		options?: ConversationQueryOptions
	): Promise<Array<StreamingConversation | FinalizedConversation>> {
		const opts: ConversationQueryOptions = {
			includeStreaming: true,
			includeFinalized: true,
			...options,
		};

		// TODO: Query conversations_unified view
		// return this.conversationDetector.getConversations(channelId, opts);

		console.log(
			`[SocialIntelligence] getConversations called for channel ${channelId} (not yet implemented)`
		);
		return [];
	}

	/**
	 * Get a specific conversation by ID
	 *
	 * Checks streaming_conversations first, then conversation_segments.
	 *
	 * @param conversationId Conversation ID
	 * @returns Conversation or null
	 */
	async getConversation(
		conversationId: string
	): Promise<StreamingConversation | FinalizedConversation | null> {
		// TODO: Implement
		// return this.conversationDetector.getConversation(conversationId);

		console.log(
			`[SocialIntelligence] getConversation called for ${conversationId} (not yet implemented)`
		);
		return null;
	}

	/**
	 * Search conversations by semantic similarity
	 *
	 * Uses embedding cosine similarity + keyword matching.
	 * Searches both streaming and finalized conversations.
	 *
	 * @param query Search query (natural language)
	 * @param guildId Guild ID
	 * @param options Search options
	 * @returns Ranked conversation results
	 */
	async searchConversationsByTopic(
		query: string,
		guildId: string,
		options?: SemanticSearchOptions
	): Promise<Array<StreamingConversation | FinalizedConversation>> {
		// TODO: Implement semantic search
		// return this.semanticAnalyzer.searchBySemanticSimilarity(query, guildId, options);

		console.log(
			`[SocialIntelligence] searchConversationsByTopic called for "${query}" (not yet implemented)`
		);
		return [];
	}

	// ============================================================================
	// RELATIONSHIP QUERIES (Called by AI tools)
	// ============================================================================

	/**
	 * Get user's relationships (live data)
	 *
	 * Queries relationship_network_live view, which prioritizes fresh raw edges
	 * over cached JSONB (eliminates 30-second lag).
	 *
	 * @param userId User ID
	 * @param guildId Guild ID
	 * @param options Query options
	 * @returns Array of relationship entries
	 */
	async getRelationships(
		userId: string,
		guildId: string,
		options?: RelationshipQueryOptions
	): Promise<RelationshipEntry[]> {
		// TODO: Implement live view query
		// return this.relationshipMapper.getLiveRelationships(userId, guildId, options);

		console.log(
			`[SocialIntelligence] getRelationships called for user ${userId} (not yet implemented)`
		);
		return [];
	}

	/**
	 * Get affinity score between two users
	 *
	 * Calculates affinity based on:
	 * - Shared conversation segments
	 * - Direct interactions (mentions, replies, reactions)
	 * - Proximity interactions (same channel, time window)
	 *
	 * @param user1Id First user ID
	 * @param user2Id Second user ID
	 * @param guildId Guild ID
	 * @returns Affinity score (0-100)
	 */
	async getAffinityScore(
		user1Id: string,
		user2Id: string,
		guildId: string
	): Promise<number> {
		// TODO: Implement affinity calculation
		// return this.relationshipMapper.calculateAffinity(user1Id, user2Id, guildId);

		console.log(
			`[SocialIntelligence] getAffinityScore called for ${user1Id} <-> ${user2Id} (not yet implemented)`
		);
		return 0;
	}

	// ============================================================================
	// SEMANTIC ANALYSIS (Called by AI tools or enrichment pipeline)
	// ============================================================================

	/**
	 * Extract keywords from text
	 *
	 * Uses hybrid TF-IDF + semantic clustering by default.
	 *
	 * @param messages Array of messages
	 * @param guildId Guild ID
	 * @param method Extraction method (default: "hybrid")
	 * @returns Array of keyword scores
	 */
	async extractKeywords(
		messages: Array<{ id: string; content: string; author_id: string }>,
		guildId: string,
		method: "tfidf" | "semantic" | "hybrid" = "hybrid"
	): Promise<KeywordScore[]> {
		// TODO: Implement keyword extraction
		// return this.semanticAnalyzer.extractKeywords(messages, guildId, method);

		console.log(
			`[SocialIntelligence] extractKeywords called for ${messages.length} messages (not yet implemented)`
		);
		return [];
	}

	/**
	 * Generate embedding for text
	 *
	 * Uses local transformer model (Xenova/all-mpnet-base-v2).
	 *
	 * @param text Text to embed
	 * @returns 768-dimensional embedding vector
	 */
	async generateEmbedding(text: string): Promise<number[]> {
		// TODO: Implement embedding generation
		// return this.semanticAnalyzer.generateEmbedding(text);

		console.log(
			`[SocialIntelligence] generateEmbedding called for text "${text.substring(0, 50)}..." (not yet implemented)`
		);
		return [];
	}

	// ============================================================================
	// ENRICHMENT PIPELINE (Background tasks)
	// ============================================================================

	/**
	 * Enrich a conversation with AI-generated topic labels and summaries
	 *
	 * @param conversationId Conversation ID
	 * @returns Updated conversation
	 */
	async enrichConversation(conversationId: string): Promise<void> {
		// TODO: Implement enrichment
		// await this.enrichmentOrchestrator.enrichConversation(conversationId);

		console.log(
			`[SocialIntelligence] enrichConversation called for ${conversationId} (not yet implemented)`
		);
	}

	/**
	 * Build guild vocabulary for TF-IDF keyword extraction
	 *
	 * Analyzes all finalized conversations to build IDF scores.
	 *
	 * @param guildId Guild ID
	 */
	async buildGuildVocabulary(guildId: string): Promise<void> {
		// TODO: Implement vocabulary building
		// await this.semanticAnalyzer.buildVocabulary(guildId);

		console.log(
			`[SocialIntelligence] buildGuildVocabulary called for guild ${guildId} (not yet implemented)`
		);
	}

	// ============================================================================
	// UTILITIES
	// ============================================================================

	/**
	 * Get statistics for monitoring
	 *
	 * Returns counts of streaming conversations, finalized conversations,
	 * relationship edges, and vocabulary terms.
	 */
	async getStats(guildId: string): Promise<{
		streaming_conversations: number;
		finalized_conversations: number;
		relationship_edges: number;
		vocabulary_terms: number;
	}> {
		// TODO: Implement stats query
		const streamingResult = await this.db.query(
			"SELECT COUNT(*) as count FROM streaming_conversations WHERE guild_id = $1 AND status = 'active'",
			[guildId]
		);
		const finalizedResult = await this.db.query(
			"SELECT COUNT(*) as count FROM conversation_segments WHERE guild_id = $1 AND status = 'finalized'",
			[guildId]
		);
		const edgesResult = await this.db.query(
			"SELECT COUNT(*) as count FROM relationship_edges WHERE guild_id = $1",
			[guildId]
		);
		const vocabResult = await this.db.query(
			"SELECT COUNT(*) as count FROM guild_vocabulary WHERE guild_id = $1",
			[guildId]
		);

		return {
			streaming_conversations:
				streamingResult.success && streamingResult.data
					? parseInt(streamingResult.data[0].count, 10)
					: 0,
			finalized_conversations:
				finalizedResult.success && finalizedResult.data
					? parseInt(finalizedResult.data[0].count, 10)
					: 0,
			relationship_edges:
				edgesResult.success && edgesResult.data
					? parseInt(edgesResult.data[0].count, 10)
					: 0,
			vocabulary_terms:
				vocabResult.success && vocabResult.data
					? parseInt(vocabResult.data[0].count, 10)
					: 0,
		};
	}
}

// Export types for convenience
export * from "./types";
