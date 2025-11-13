import type { GroupingStrategy, BaseMessage, GroupingContext } from "./GroupingStrategy";
import { ConversationGroup } from "../ConversationGroup";

/**
 * Groups messages based on temporal and participant proximity
 * Priority: 4 (lowest) - fallback for organic conversations without explicit signals
 */
export class ProximityStrategy<T extends BaseMessage> implements GroupingStrategy<T> {
  name = "Proximity";
  priority = 4;

  private readonly PROXIMITY_WINDOW_MS: number;

  constructor(proximityWindowMs = 10 * 60 * 1000) {
    this.PROXIMITY_WINDOW_MS = proximityWindowMs;
  }

  async group(
    messages: T[],
    processedIds: Set<string>,
    context: GroupingContext
  ): Promise<ConversationGroup<T>[]> {
    const groups: ConversationGroup<T>[] = [];

    // Get unprocessed messages
    const unprocessed = messages.filter((m) => !processedIds.has(m.id));
    if (unprocessed.length < 2) {
      return groups;
    }

    // Messages are already sorted by created_at
    // Group messages within proximity windows

    let currentGroup: T[] = [];
    let lastMessageTime: number | null = null;
    const participantSet = new Set<string>();

    for (const msg of unprocessed) {
      const msgTime = msg.created_at.getTime();

      // Start new group if:
      // 1. First message
      // 2. Time gap > proximity window
      if (
        lastMessageTime === null ||
        msgTime - lastMessageTime > this.PROXIMITY_WINDOW_MS
      ) {
        // Save previous group if it has at least 2 messages and 2+ participants
        if (this.isValidProximityGroup(currentGroup)) {
          const group = new ConversationGroup<T>(currentGroup);
          groups.push(group);

          // Mark all as processed
          for (const m of currentGroup) {
            processedIds.add(m.id);
          }
        }

        // Start new group
        currentGroup = [msg];
        participantSet.clear();
        participantSet.add(msg.author_id);
      } else {
        // Add to current group
        currentGroup.push(msg);
        participantSet.add(msg.author_id);
      }

      lastMessageTime = msgTime;
    }

    // Don't forget the last group
    if (this.isValidProximityGroup(currentGroup)) {
      const group = new ConversationGroup<T>(currentGroup);
      groups.push(group);

      // Mark all as processed
      for (const m of currentGroup) {
        processedIds.add(m.id);
      }
    }

    return groups;
  }

  /**
   * Check if a proximity group is valid
   * Must have at least 2 messages and 2+ participants
   */
  private isValidProximityGroup(messages: T[]): boolean {
    if (messages.length < 2) {
      return false;
    }

    const participants = new Set(messages.map((m) => m.author_id));
    return participants.size >= 2;
  }
}
