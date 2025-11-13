import type { GroupingStrategy, BaseMessage, GroupingContext } from "./GroupingStrategy";
import { ConversationGroup } from "../ConversationGroup";

/**
 * Groups messages based on @mentions
 * Priority: 2 - strong signal of conversation, but weaker than reply chains
 */
export class MentionStrategy<T extends BaseMessage> implements GroupingStrategy<T> {
  name = "Mention";
  priority = 2;

  private readonly TIME_WINDOW_MS: number;

  constructor(timeWindowMs = 10 * 60 * 1000) {
    this.TIME_WINDOW_MS = timeWindowMs;
  }

  async group(
    messages: T[],
    processedIds: Set<string>,
    context: GroupingContext
  ): Promise<ConversationGroup<T>[]> {
    const groups: ConversationGroup<T>[] = [];
    const messageMap = new Map<string, T>();

    // Build message map
    for (const msg of messages) {
      messageMap.set(msg.id, msg);
    }

    // Find messages with mentions that aren't already processed
    const mentionMessages = messages.filter(
      (msg) =>
        !processedIds.has(msg.id) &&
        msg.mentioned_user_ids &&
        msg.mentioned_user_ids.length > 0
    );

    // For each mention message, find nearby messages involving mentioned users
    for (const mentionMsg of mentionMessages) {
      if (processedIds.has(mentionMsg.id)) {
        continue;
      }

      const mentionedUsers = new Set(mentionMsg.mentioned_user_ids || []);
      const groupMessages: T[] = [mentionMsg];
      const groupedIds = new Set([mentionMsg.id]);

      // Find related messages within time window
      for (const msg of messages) {
        if (processedIds.has(msg.id) || groupedIds.has(msg.id)) {
          continue;
        }

        // Check if message is within time window
        const timeDiff = Math.abs(
          msg.created_at.getTime() - mentionMsg.created_at.getTime()
        );
        if (timeDiff > this.TIME_WINDOW_MS) {
          continue;
        }

        // Check if message involves any of the mentioned users
        const isMentioner = msg.author_id === mentionMsg.author_id;
        const isMentioned = mentionedUsers.has(msg.author_id);
        const mentionsBack =
          msg.mentioned_user_ids &&
          (msg.mentioned_user_ids.includes(mentionMsg.author_id) ||
            msg.mentioned_user_ids.some((uid) => mentionedUsers.has(uid)));

        if (isMentioner || isMentioned || mentionsBack) {
          groupMessages.push(msg);
          groupedIds.add(msg.id);

          // Add any newly mentioned users to the set
          if (msg.mentioned_user_ids) {
            for (const uid of msg.mentioned_user_ids) {
              mentionedUsers.add(uid);
            }
          }
        }
      }

      // Create group if we have at least 2 messages
      if (groupMessages.length >= 2) {
        const group = new ConversationGroup<T>(groupMessages);
        groups.push(group);

        // Mark all as processed
        for (const msg of groupMessages) {
          processedIds.add(msg.id);
        }
      }
    }

    return groups;
  }
}
