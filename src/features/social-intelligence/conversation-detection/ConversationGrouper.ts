import type { GroupingStrategy, BaseMessage, GroupingContext } from "./strategies/GroupingStrategy";
import type { ConversationGroup } from "./ConversationGroup";
import { ReplyChainStrategy } from "./strategies/ReplyChainStrategy";
import { MentionStrategy } from "./strategies/MentionStrategy";
import { TopicContinuityStrategy } from "./strategies/TopicContinuityStrategy";
import { SemanticStrategy } from "./strategies/SemanticStrategy";
import { ProximityStrategy } from "./strategies/ProximityStrategy";
import type { ConversationScorer } from "./ConversationScorer";

/**
 * Orchestrates multiple grouping strategies to detect conversations
 * Strategies are executed in priority order, with higher priority strategies
 * processing messages first
 */
export class ConversationGrouper<T extends BaseMessage> {
  private strategies: GroupingStrategy<T>[] = [];
  private topicContinuityStrategy: TopicContinuityStrategy<T>;

  constructor(scorer: ConversationScorer) {
    // Initialize topic continuity strategy separately (used for post-processing)
    this.topicContinuityStrategy = new TopicContinuityStrategy<T>(scorer);

    // Initialize strategies in priority order
    this.strategies = [
      new ReplyChainStrategy<T>(),
      new MentionStrategy<T>(),
      // TopicContinuityStrategy is NOT in the normal strategy list
      // It runs as a post-processor after all other strategies
      new SemanticStrategy<T>(scorer),
      new ProximityStrategy<T>(),
    ];

    // Sort strategies by priority (lower number = higher priority)
    this.strategies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Group messages into conversations using all strategies
   * @param messages - Messages to group (MUST be pre-sorted by created_at)
   * @param context - Grouping context (guild, channel, message map)
   * @returns Array of conversation groups
   */
  async groupMessages(
    messages: T[],
    context: GroupingContext
  ): Promise<ConversationGroup<T>[]> {
    const processedIds = new Set<string>();
    const allGroups: ConversationGroup<T>[] = [];

    // Execute strategies in priority order
    for (const strategy of this.strategies) {
      const groups = await strategy.group(messages, processedIds, context);
      allGroups.push(...groups);
    }

    // Merge overlapping groups (groups that share message IDs)
    let mergedGroups = this.mergeOverlappingGroups(allGroups);

    // Post-processing: Apply topic continuity merging to reduce fragmentation
    mergedGroups = await this.topicContinuityStrategy.mergeExistingGroups(
      mergedGroups,
      context
    );

    return mergedGroups;
  }

  /**
   * Add a custom strategy (useful for extending behavior)
   */
  addStrategy(strategy: GroupingStrategy<T>): void {
    this.strategies.push(strategy);
    this.strategies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Remove a strategy by name
   */
  removeStrategy(name: string): void {
    this.strategies = this.strategies.filter((s) => s.name !== name);
  }

  /**
   * Get all registered strategies
   */
  getStrategies(): GroupingStrategy<T>[] {
    return [...this.strategies];
  }

  /**
   * Merge groups that share message IDs
   * This can happen when different strategies identify overlapping conversations
   */
  private mergeOverlappingGroups(
    groups: ConversationGroup<T>[]
  ): ConversationGroup<T>[] {
    if (groups.length <= 1) {
      return groups;
    }

    const merged: ConversationGroup<T>[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < groups.length; i++) {
      if (processed.has(i)) {
        continue;
      }

      const currentGroup = groups[i]!;
      const currentIds = currentGroup.getMessageIds();

      // Find all groups that overlap with current group
      const overlapping: number[] = [i];

      for (let j = i + 1; j < groups.length; j++) {
        if (processed.has(j)) {
          continue;
        }

        const otherGroup = groups[j]!;
        const otherIds = otherGroup.getMessageIds();

        // Check for overlap
        const hasOverlap = Array.from(currentIds).some((id) => otherIds.has(id));

        if (hasOverlap) {
          overlapping.push(j);
          // Merge other group into current
          currentGroup.merge(otherGroup);
        }
      }

      // Mark all overlapping groups as processed
      for (const idx of overlapping) {
        processed.add(idx);
      }

      merged.push(currentGroup);
    }

    return merged;
  }
}
