import type { GroupingStrategy, BaseMessage, GroupingContext } from "./GroupingStrategy";
import { ConversationGroup } from "../ConversationGroup";
import type { ConversationScorer } from "../ConversationScorer";

/**
 * Merges conversation segments that are clearly continuations of the same topic
 * Priority: 2.5 (between mention and semantic) - runs after explicit signals but before general semantic
 *
 * This strategy addresses fragmentation issues where natural pauses in conversation
 * cause segments to split, even though they're clearly about the same topic.
 *
 * Uses:
 * - Participant overlap (same people continuing the chat)
 * - Time proximity (< 5 minute gap between segments)
 * - Semantic similarity (embeddings show topic continuity)
 */
export class TopicContinuityStrategy<T extends BaseMessage> implements GroupingStrategy<T> {
  name = "TopicContinuity";
  priority = 2.5;

  private scorer: ConversationScorer;
  private readonly MAX_GAP_MS = 15 * 60 * 1000; // 15 minutes max gap (was 5, too strict)
  private readonly MIN_PARTICIPANT_OVERLAP = 0.5; // 50% of participants must match (was 70%, too strict)
  private readonly MIN_SEMANTIC_SIMILARITY = 0.35; // Embeddings must be 35% similar (was 65%, too strict)

  constructor(scorer: ConversationScorer) {
    this.scorer = scorer;
  }

  async group(
    messages: T[],
    processedIds: Set<string>,
    context: GroupingContext
  ): Promise<ConversationGroup<T>[]> {
    // This strategy doesn't create new groups during the normal grouping phase
    // It only works as a post-processor in mergeExistingGroups()
    // Return empty array to let other strategies do the initial grouping
    return [];
  }

  /**
   * Post-processing method to merge existing groups based on topic continuity
   * Called after all strategies have created their groups
   *
   * Uses thread-aware merging to handle interleaved conversations:
   * - Groups same participant pairs even if separated by other conversations
   * - Example: alex+lunchie discussing Outlast can be one thread,
   *   while astoria+matthew discussing hair is a separate thread
   */
  async mergeExistingGroups(
    groups: ConversationGroup<T>[],
    context: GroupingContext
  ): Promise<ConversationGroup<T>[]> {
    if (groups.length < 2) {
      return groups; // Nothing to merge
    }

    // Sort groups by time
    const sortedGroups = [...groups].sort((a, b) => {
      const aTime = a.getMetadata(context.messageMap).timeRange.min;
      const bTime = b.getMetadata(context.messageMap).timeRange.min;
      return aTime - bTime;
    });

    // Track conversation threads by participant signature
    const threads = new Map<string, ConversationGroup<T>>();
    const finalGroups: ConversationGroup<T>[] = [];

    for (const group of sortedGroups) {
      const groupMeta = group.getMetadata(context.messageMap);

      // Find if this group belongs to an existing thread
      let mergedIntoThread = false;

      for (const [threadKey, threadGroup] of threads.entries()) {
        const threadMeta = threadGroup.getMetadata(context.messageMap);

        // Check if this group is a continuation of this thread
        if (await this.isThreadContinuation(group, groupMeta, threadGroup, threadMeta, context)) {
          // Merge into existing thread
          threadGroup.merge(group);
          mergedIntoThread = true;
          break;
        }
      }

      if (!mergedIntoThread) {
        // Start a new thread
        const threadKey = this.getThreadSignature(groupMeta.participants);
        threads.set(threadKey, group);
      }
    }

    // Collect all threads
    for (const thread of threads.values()) {
      finalGroups.push(thread);
    }

    // Sort by start time
    finalGroups.sort((a, b) => {
      const aTime = a.getMetadata(context.messageMap).timeRange.min;
      const bTime = b.getMetadata(context.messageMap).timeRange.min;
      return aTime - bTime;
    });

    return finalGroups;
  }

  /**
   * Check if a group is a continuation of an existing thread
   * More lenient than isContinuation - allows for interleaved conversations
   */
  private async isThreadContinuation(
    group: ConversationGroup<T>,
    groupMeta: any,
    threadGroup: ConversationGroup<T>,
    threadMeta: any,
    context: GroupingContext
  ): Promise<boolean> {
    // 1. Check if participants overlap significantly
    const participantOverlap = this.calculateParticipantOverlap(
      threadMeta.participants,
      groupMeta.participants
    );

    if (participantOverlap < this.MIN_PARTICIPANT_OVERLAP) {
      return false; // Different people = different thread
    }

    // 2. Check time gap from END of thread to START of group
    // Allow longer gaps for thread continuations (up to 30 minutes)
    const MAX_THREAD_GAP_MS = 30 * 60 * 1000; // 30 minutes for threads
    const timeGap = groupMeta.timeRange.min - threadMeta.timeRange.max;

    if (timeGap > MAX_THREAD_GAP_MS) {
      return false; // Too much time passed
    }

    // 3. Check semantic similarity (if embeddings available)
    if (threadMeta.avgEmbedding && groupMeta.avgEmbedding) {
      const semanticSim = this.cosineSimilarity(
        threadMeta.avgEmbedding,
        groupMeta.avgEmbedding
      );

      // More lenient for threads - topics can drift slightly
      if (semanticSim < 0.30) {
        return false; // Completely different topic
      }
    }

    // All checks passed - this is a thread continuation
    return true;
  }

  /**
   * Generate a signature for a thread based on participants
   * Used to identify which groups belong to the same conversation thread
   */
  private getThreadSignature(participants: Set<string>): string {
    return Array.from(participants).sort().join('-');
  }

  /**
   * Check if nextGroup is a continuation of currentGroup
   */
  private async isContinuation(
    currentGroup: ConversationGroup<T>,
    nextGroup: ConversationGroup<T>,
    context: GroupingContext
  ): Promise<boolean> {
    const currentMeta = currentGroup.getMetadata(context.messageMap);
    const nextMeta = nextGroup.getMetadata(context.messageMap);

    // 1. Check time gap
    const timeGap = nextMeta.timeRange.min - currentMeta.timeRange.max;
    if (timeGap > this.MAX_GAP_MS) {
      return false; // Too much time passed
    }

    // 2. Check participant overlap
    const participantOverlap = this.calculateParticipantOverlap(
      currentMeta.participants,
      nextMeta.participants
    );
    if (participantOverlap < this.MIN_PARTICIPANT_OVERLAP) {
      return false; // Different people
    }

    // 3. Check semantic similarity (if embeddings available)
    if (currentMeta.avgEmbedding && nextMeta.avgEmbedding) {
      const semanticSim = this.cosineSimilarity(
        currentMeta.avgEmbedding,
        nextMeta.avgEmbedding
      );

      if (semanticSim < this.MIN_SEMANTIC_SIMILARITY) {
        return false; // Different topics
      }
    }

    // All checks passed - this is a continuation!
    return true;
  }

  /**
   * Calculate what percentage of participants overlap
   */
  private calculateParticipantOverlap(
    set1: Set<string>,
    set2: Set<string>
  ): number {
    if (set1.size === 0 || set2.size === 0) return 0;

    const intersection = new Set(
      Array.from(set1).filter(id => set2.has(id))
    );

    // Use the smaller set as denominator (stricter check)
    const minSize = Math.min(set1.size, set2.size);
    return intersection.size / minSize;
  }

  /**
   * Calculate cosine similarity between two embedding vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i]! * vecB[i]!;
      normA += vecA[i]! * vecA[i]!;
      normB += vecB[i]! * vecB[i]!;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

}
