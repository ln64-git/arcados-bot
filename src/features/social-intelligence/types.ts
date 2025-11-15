/**
 * Unified types for Social Intelligence System
 *
 * This system transforms raw Discord interactions into structured,
 * queryable relationship and conversation insights.
 */

// ============================================================================
// CONVERSATION TYPES
// ============================================================================

export interface StreamingConversation {
	id: string;
	guild_id: string;
	channel_id: string;
	participants: string[]; // user IDs
	message_ids: string[];
	message_count: number;
	start_time: Date;
	last_activity: Date;
	status: "active" | "finalizing";
	preliminary_keywords: KeywordScore[];
	preliminary_embedding?: number[];
	created_at: Date;
	updated_at: Date;
}

export interface FinalizedConversation {
	id: string;
	guild_id: string;
	channel_id: string;
	participants: string[];
	message_ids: string[];
	message_count: number;
	start_time: Date;
	end_time: Date;
	status: "finalized";
	features: ConversationFeatures;
	summary?: string;
	topic_label?: string;
	topic_confidence?: number;
	ai_processing_status?: string;
	ai_metadata?: Record<string, any>;
}

export interface ConversationFeatures {
	keywords: KeywordScore[];
	embeddings?: number[][];
	interaction_types: InteractionType[];
	topic_center?: number[];
	semantic_score?: number;
}

export interface ConversationEntry {
	segment_id: string;
	participants: string[];
	start_time: Date;
	end_time: Date;
	message_count: number;
	summary?: string;
	keywords?: string[];
	topic_label?: string;
}

// ============================================================================
// SEMANTIC TYPES
// ============================================================================

export interface KeywordScore {
	word: string;
	score: number;
	type: "tfidf" | "semantic" | "hybrid";
	frequency?: number;
}

export interface ConversationKeywords {
	terms: KeywordScore[];
	method: "tfidf" | "semantic" | "hybrid";
	extracted_at: Date;
}

export interface GuildVocabulary {
	guild_id: string;
	term: string;
	idf_score: number;
	document_frequency: number;
	total_documents: number;
	is_stopword: boolean;
	updated_at: Date;
}

export interface TopicLabel {
	label: string;
	confidence: number;
	method: "ai" | "keyword_fallback";
	keywords_used?: string[];
}

// ============================================================================
// RELATIONSHIP TYPES
// ============================================================================

export interface RelationshipEdge {
	guild_id: string;
	user_a: string;
	user_b: string;
	msg_a_to_b: number;
	msg_b_to_a: number;
	mentions: number;
	replies: number;
	reactions: number;
	rolling_7d: number;
	rolling_30d: number;
	total: number;
	last_interaction: Date;
}

export interface RelationshipEntry {
	user_id: string;
	affinity_percentage: number; // 0-100
	interaction_count: number;
	last_interaction: Date;
	summary?: string;
	keywords?: string[];
	emojis?: string[];
	notes?: string[];
	conversations?: ConversationEntry[];
	display_name?: string;
	username?: string;
	raw_points?: number;
	total_messages?: number;
}

export interface AffinityScoreResult {
	target_user_id: string;
	raw_points: number;
	relevance_percentage: number;
	interaction_summary: UserInteractionSummary;
	conversations: ConversationEntry[];
	breakdown: {
		conversation_points: number;
		message_points: number;
		bonus_points: number;
	};
}

export interface UserInteractionSummary {
	total_interactions: number;
	messages: number;
	mentions: number;
	replies: number;
	reactions: number;
	conversations_together: number;
}

export interface MessageInteraction {
	user1_id: string;
	user2_id: string;
	timestamp: Date;
	interaction_type: InteractionType;
	direction: "a_to_b" | "b_to_a" | "mutual";
}

export type InteractionType =
	| "message"
	| "mention"
	| "reply"
	| "reaction"
	| "same_channel"
	| "conversation";

// ============================================================================
// GROUPING STRATEGY TYPES
// ============================================================================

export interface GroupingContext {
	guildId: string;
	channelId: string;
	messages: GroupableMessage[];
	existingGroups: ConversationGroupData[];
	scorer: any; // ConversationScorer
}

export interface GroupableMessage {
	id: string;
	author_id: string;
	content: string;
	created_at: Date;
	guild_id: string;
	channel_id: string;
	referenced_message_id?: string;
	mentioned_user_ids?: string[];
	embedding?: number[];
}

export interface ConversationGroupData {
	id: string;
	messageIds: string[];
	participants: Set<string>;
	startTime: Date;
	endTime: Date;
	embeddings: number[][];
	keywords?: string[];
}

export interface GroupingResult {
	messageId: string;
	groupId: string | null;
	confidence: number;
	strategy: string;
}

// ============================================================================
// STORAGE TYPES
// ============================================================================

export interface DatabaseResult<T> {
	success: boolean;
	data?: T;
	error?: string;
}

// ============================================================================
// QUERY OPTIONS
// ============================================================================

export interface ConversationQueryOptions {
	includeStreaming?: boolean; // Include active conversations (default: true)
	includeFinalized?: boolean; // Include finalized conversations (default: true)
	minMessages?: number; // Minimum message count
	startDate?: Date; // Filter by start time
	endDate?: Date; // Filter by end time
	participants?: string[]; // Filter by participant user IDs
}

export interface RelationshipQueryOptions {
	useLiveView?: boolean; // Use live view for real-time data (default: true)
	minAffinity?: number; // Minimum affinity percentage
	limit?: number; // Max results
}

export interface SemanticSearchOptions {
	includeStreaming?: boolean; // Search streaming conversations (default: true)
	minSimilarity?: number; // Minimum cosine similarity (default: 0.3)
	limit?: number; // Max results (default: 20)
}
