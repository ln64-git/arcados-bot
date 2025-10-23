import type { RelationshipEntry } from "../../database/PostgreSQLManager";

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

// Result of affinity score calculation
export interface AffinityScoreResult {
	raw_points: number; // Changed from 'score'
	interaction_summary: UserInteractionSummary;
	computed_at: Date;
}
