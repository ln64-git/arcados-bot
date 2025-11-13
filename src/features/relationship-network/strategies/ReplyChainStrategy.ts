import type { GroupingStrategy, BaseMessage, GroupingContext } from "./GroupingStrategy";
import { ConversationGroup } from "../ConversationGroup";

/**
 * Groups messages based on reply chains
 * Priority: 1 (highest) - most reliable signal of conversation
 */
export class ReplyChainStrategy<T extends BaseMessage> implements GroupingStrategy<T> {
  name = "ReplyChain";
  priority = 1;

  private readonly MAX_REPLY_CHAIN_GAP_MS: number;

  constructor(maxReplyChainGapMs = 7 * 24 * 60 * 60 * 1000) {
    this.MAX_REPLY_CHAIN_GAP_MS = maxReplyChainGapMs;
  }

  async group(
    messages: T[],
    processedIds: Set<string>,
    context: GroupingContext
  ): Promise<ConversationGroup<T>[]> {
    const groups: ConversationGroup<T>[] = [];
    const messageMap = new Map<string, T>();

    // Build message map for quick lookup
    for (const msg of messages) {
      messageMap.set(msg.id, msg);
    }

    // Track which messages are part of reply chains
    const replyChainMessages = new Set<string>();

    // Find all reply chains
    for (const msg of messages) {
      if (processedIds.has(msg.id) || !msg.referenced_message_id) {
        continue;
      }

      // Check if the referenced message exists and isn't too old
      const referencedMsg = messageMap.get(msg.referenced_message_id);
      if (!referencedMsg) {
        continue;
      }

      const timeDiff = msg.created_at.getTime() - referencedMsg.created_at.getTime();
      if (timeDiff > this.MAX_REPLY_CHAIN_GAP_MS || timeDiff < 0) {
        continue; // Reply chain is too old or invalid
      }

      // Build the full reply chain
      const chain = this.buildReplyChain(msg, messageMap, processedIds);
      if (chain.length >= 2) {
        const group = new ConversationGroup<T>(chain);
        groups.push(group);

        // Mark all messages in chain as processed
        for (const chainMsg of chain) {
          processedIds.add(chainMsg.id);
          replyChainMessages.add(chainMsg.id);
        }
      }
    }

    return groups;
  }

  /**
   * Build a complete reply chain by following references backwards and forwards
   */
  private buildReplyChain(
    startMessage: T,
    messageMap: Map<string, T>,
    processedIds: Set<string>
  ): T[] {
    const chain: T[] = [];
    const visited = new Set<string>();

    // Go backwards to find the root of the chain
    let current: T | undefined = startMessage;
    const backwardChain: T[] = [];

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      backwardChain.unshift(current); // Add to beginning

      if (current.referenced_message_id && !processedIds.has(current.referenced_message_id)) {
        current = messageMap.get(current.referenced_message_id);
      } else {
        break;
      }
    }

    chain.push(...backwardChain);

    // Go forwards to find all replies to messages in the chain
    const rootId = chain[0]?.id;
    if (!rootId) {
      return chain;
    }

    // Find all messages that reply to any message in the current chain
    const chainIds = new Set(chain.map(m => m.id));
    for (const msg of messageMap.values()) {
      if (
        !visited.has(msg.id) &&
        !processedIds.has(msg.id) &&
        msg.referenced_message_id &&
        chainIds.has(msg.referenced_message_id)
      ) {
        // Check time constraint
        const referencedMsg = messageMap.get(msg.referenced_message_id);
        if (referencedMsg) {
          const timeDiff = msg.created_at.getTime() - referencedMsg.created_at.getTime();
          if (timeDiff <= this.MAX_REPLY_CHAIN_GAP_MS && timeDiff >= 0) {
            chain.push(msg);
            visited.add(msg.id);
            chainIds.add(msg.id);
          }
        }
      }
    }

    return chain;
  }
}
