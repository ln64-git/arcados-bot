import type { ConversationGroup } from "../ConversationGroup";

/**
 * Base interface for conversation grouping strategies
 * Each strategy implements a different approach to grouping messages into conversations
 */
export interface GroupingStrategy<T extends BaseMessage> {
  name: string;
  priority: number; // Lower number = higher priority

  /**
   * Group messages into conversations
   * @param messages - Sorted array of messages to group
   * @param processedIds - Set of message IDs already processed by higher-priority strategies
   * @param context - Additional context needed for grouping (guild, channel, etc.)
   * @returns Array of conversation groups
   */
  group(
    messages: T[],
    processedIds: Set<string>,
    context: GroupingContext
  ): Promise<ConversationGroup<T>[]>;
}

/**
 * Base message interface that all strategies require
 */
export interface BaseMessage {
  id: string;
  author_id: string;
  created_at: Date;
  content?: string;
  referenced_message_id?: string;
  mentioned_user_ids?: string[];
  embedding?: number[];
}

/**
 * Context passed to grouping strategies
 */
export interface GroupingContext {
  guildId: string;
  channelId?: string;
  messageMap: Map<string, any>;
}
