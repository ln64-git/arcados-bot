import type { GroupingStrategy, BaseMessage, GroupingContext } from "./GroupingStrategy";
import { ConversationGroup } from "../ConversationGroup";
import type { ConversationScorer } from "../ConversationScorer";

/**
 * Groups messages based on semantic similarity, relationship scores, and temporal proximity
 * Priority: 3 - uses ML signals to infer conversations without explicit connections
 */
export class SemanticStrategy<T extends BaseMessage> implements GroupingStrategy<T> {
  name = "Semantic";
  priority = 3;

  private scorer: ConversationScorer;

  constructor(scorer: ConversationScorer) {
    this.scorer = scorer;
  }

  async group(
    messages: T[],
    processedIds: Set<string>,
    context: GroupingContext
  ): Promise<ConversationGroup<T>[]> {
    const unprocessedMessages = messages.filter((m) => !processedIds.has(m.id));

    if (unprocessedMessages.length === 0) {
      return [];
    }

    // Score each unprocessed message against existing groups
    // This is the "routing" logic that assigns messages to conversations
    const groups: ConversationGroup<T>[] = [];
    const messageMap = new Map<string, T>();

    for (const msg of messages) {
      messageMap.set(msg.id, msg);
    }

    // Build initial groups from processed messages (created by previous strategies)
    const processedGroups = this.buildGroupsFromProcessed(messages, processedIds);
    groups.push(...processedGroups);

    // For each unprocessed message, find the best group or create a new one
    for (const msg of unprocessedMessages) {
      if (processedIds.has(msg.id)) {
        continue; // May have been processed while iterating
      }

      let bestScore = 0;
      let bestGroup: ConversationGroup<T> | null = null;

      // Score against all existing groups
      for (const group of groups) {
        const score = await this.scoreMessageAgainstGroup(
          msg,
          group,
          messageMap,
          context.guildId
        );

        if (score > bestScore) {
          bestScore = score;
          bestGroup = group;
        }
      }

      // Add to best group if score meets threshold
      if (bestGroup && this.scorer.meetsThreshold(bestScore)) {
        bestGroup.addMessage(msg);
        processedIds.add(msg.id);
      }
      // If no good match, leave unprocessed for proximity fallback
    }

    return groups;
  }

  /**
   * Score a message against a conversation group
   */
  private async scoreMessageAgainstGroup(
    message: T,
    group: ConversationGroup<T>,
    messageMap: Map<string, T>,
    guildId: string
  ): Promise<number> {
    const metadata = group.getMetadata(messageMap);
    const groupMessages = group.getMessages(messageMap);

    if (groupMessages.length === 0) {
      return 0;
    }

    // Calculate relationship score
    const relationshipScore = await this.scorer.calculateRelationshipScore(
      message.author_id,
      metadata.participants,
      guildId
    );

    // Calculate semantic score
    const groupEmbeddings = groupMessages
      .map((m) => m.embedding)
      .filter((emb): emb is number[] => emb !== undefined);

    const semanticScore = this.scorer.calculateSemanticScore(
      message.embedding,
      groupEmbeddings
    );

    // Calculate time score
    const messageTime = message.created_at.getTime();
    const timeScore = this.scorer.calculateTimeScore(messageTime, metadata.timeRange);

    // Calculate combined score
    return this.scorer.calculateCombinedScore({
      relationship: relationshipScore,
      semantic: semanticScore,
      time: timeScore,
    });
  }

  /**
   * Build groups from messages that were already processed by previous strategies
   * This allows unprocessed messages to be scored against them
   */
  private buildGroupsFromProcessed(
    allMessages: T[],
    processedIds: Set<string>
  ): ConversationGroup<T>[] {
    // For now, we don't create groups from processed messages
    // They were already grouped by previous strategies
    // This method is here for future extensibility
    return [];
  }
}
