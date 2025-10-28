import type { RelationshipEntry } from "../database/PostgreSQLManager";

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

// Enhanced affinity breakdown
export interface EnhancedAffinityBreakdown {
  conversation_points: number;
  message_points: number;
  interaction_bonuses: number;
  total_conversations: number;
  total_messages: number;
  name_interactions: number;
  mention_interactions: number;
}

// Result of affinity score calculation
export interface AffinityScoreResult {
  raw_points: number; // Raw points for this relationship
  interaction_summary: UserInteractionSummary;
  computed_at: Date;
  enhanced_breakdown?: EnhancedAffinityBreakdown;
  relevance_percentage: number; // Percentage of total interaction time/attention
}

// Conversation tracking data
export interface ConversationEntry {
  conversation_id: string;
  start_time: Date;
  end_time: Date;
  message_count: number;
  channel_id: string;
  message_ids: string[];
  interaction_types: string[]; // Types of interactions in this conversation
  duration_minutes: number;
  user_names: {
    user1: string[]; // All names used for user1 during this conversation period
    user2: string[]; // All names used for user2 during this conversation period
  };
  has_name_usage: boolean; // Whether names were actually used in messages
}
