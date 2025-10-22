import type { RelationshipEntry } from "../../database/schema";

// Configuration for affinity scoring weights
export interface AffinityWeights {
	sameChannelMessages: number;
	mentions: number;
	replies: number;
}

// Default weights for interaction scoring
export const DEFAULT_AFFINITY_WEIGHTS: AffinityWeights = {
	sameChannelMessages: 1, // Base interaction points
	mentions: 2, // Stronger signal
	replies: 3, // Strongest signal
};

// Message interaction metadata
export interface MessageInteraction {
	interaction_type: "same_channel" | "mention" | "reply";
	timestamp: Date;
	channel_id: string;
	message_id: string;
	other_user_id: string;
	points: number;
}

// Aggregated interaction data between two users
export interface UserInteractionSummary {
	user_id: string;
	total_points: number;
	interaction_count: number;
	last_interaction?: Date;
	breakdown: {
		same_channel: number;
		mentions: number;
		replies: number;
	};
}

// Options for relationship computation
export interface RelationshipComputeOptions {
	timeWindowMinutes?: number; // Default: 5 minutes for same-channel interactions
	cacheTTLMinutes?: number; // Default: 60 minutes for cached results
	minAffinityScore?: number; // Default: 1 (filter out zero-affinity relationships)
	maxRelationships?: number; // Default: 50 (limit network size)
}

// Default computation options
export const DEFAULT_COMPUTE_OPTIONS: RelationshipComputeOptions = {
	timeWindowMinutes: 5,
	cacheTTLMinutes: 60,
	minAffinityScore: 1,
	maxRelationships: 50,
};

// Result of affinity score calculation
export interface AffinityScoreResult {
	score: number;
	interaction_summary: UserInteractionSummary;
	computed_at: Date;
}

// Relationship network computation result
export interface RelationshipNetworkResult {
	user_id: string;
	guild_id: string;
	relationships: RelationshipEntry[];
	computed_at: Date;
	total_members_processed: number;
	computation_duration_ms: number;
}

// Query filters for relationship network retrieval
export interface RelationshipQueryFilters {
	minScore?: number;
	maxResults?: number;
	includeInactive?: boolean;
	lastUpdatedAfter?: Date;
}

// Error types for relationship network operations
export class RelationshipNetworkError extends Error {
	constructor(
		message: string,
		public code: string,
	) {
		super(message);
		this.name = "RelationshipNetworkError";
	}
}

export class AffinityCalculationError extends RelationshipNetworkError {
	constructor(message: string) {
		super(message, "AFFINITY_CALCULATION_ERROR");
	}
}

export class NetworkComputationError extends RelationshipNetworkError {
	constructor(message: string) {
		super(message, "NETWORK_COMPUTATION_ERROR");
	}
}

// Utility type for partial relationship updates
export type PartialRelationshipEntry = Partial<RelationshipEntry> & {
	user_id: string;
	affinity_score: number;
};

// Cache key generation utilities
export function generateCacheKey(userId: string, guildId: string): string {
	return `relationship_network:${guildId}:${userId}`;
}

export function generateAffinityCacheKey(
	user1Id: string,
	user2Id: string,
	guildId: string,
): string {
	// Ensure consistent ordering for bidirectional relationships
	const [first, second] = [user1Id, user2Id].sort();
	return `affinity_score:${guildId}:${first}:${second}`;
}
