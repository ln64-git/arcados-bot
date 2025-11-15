/**
 * Represents a group of messages that form a conversation
 * Optimizes repeated operations by caching computed values
 */
export class ConversationGroup<T extends { id: string; author_id: string; created_at: Date; embedding?: number[] }> {
  private messageIds: Set<string>;
  private messagesCache?: T[];
  private metadataCache?: GroupMetadata;

  constructor(initialMessages: T[] = []) {
    this.messageIds = new Set(initialMessages.map(m => m.id));
    this.messagesCache = initialMessages.length > 0 ? [...initialMessages] : undefined;
  }

  /**
   * Add a message to the group
   */
  addMessage(message: T): void {
    if (!this.messageIds.has(message.id)) {
      this.messageIds.add(message.id);
      this.invalidateCache();
    }
  }

  /**
   * Add multiple messages to the group
   */
  addMessages(messages: T[]): void {
    for (const message of messages) {
      this.messageIds.add(message.id);
    }
    this.invalidateCache();
  }

  /**
   * Merge another group into this one
   */
  merge(other: ConversationGroup<T>): void {
    for (const id of other.messageIds) {
      this.messageIds.add(id);
    }
    this.invalidateCache();
  }

  /**
   * Get all message IDs in the group
   */
  getMessageIds(): Set<string> {
    return new Set(this.messageIds);
  }

  /**
   * Get all messages in the group (with caching)
   */
  getMessages(messageMap: Map<string, T>): T[] {
    if (!this.messagesCache) {
      this.messagesCache = Array.from(this.messageIds)
        .map(id => messageMap.get(id))
        .filter((m): m is T => m !== undefined);
    }
    return this.messagesCache;
  }

  /**
   * Get cached metadata for the group (participants, time range, embeddings, etc.)
   */
  getMetadata(messageMap: Map<string, T>): GroupMetadata {
    if (!this.metadataCache) {
      const messages = this.getMessages(messageMap);
      this.metadataCache = this.computeMetadata(messages);
    }
    return this.metadataCache;
  }

  /**
   * Get the number of messages in the group
   */
  size(): number {
    return this.messageIds.size;
  }

  /**
   * Check if the group contains a message ID
   */
  has(messageId: string): boolean {
    return this.messageIds.has(messageId);
  }

  /**
   * Check if the group is empty
   */
  isEmpty(): boolean {
    return this.messageIds.size === 0;
  }

  /**
   * Private helper: Invalidate all caches when group changes
   */
  private invalidateCache(): void {
    this.messagesCache = undefined;
    this.metadataCache = undefined;
  }

  /**
   * Private helper: Compute metadata from messages
   */
  private computeMetadata(messages: T[]): GroupMetadata {
    if (messages.length === 0) {
      return {
        participants: new Set(),
        timeRange: { min: 0, max: 0 },
        hasReplies: false,
        hasMentions: false,
      };
    }

    const participants = new Set<string>();
    let minTime = Number.POSITIVE_INFINITY;
    let maxTime = Number.NEGATIVE_INFINITY;
    let hasReplies = false;
    let hasMentions = false;
    const embeddings: number[][] = [];

    for (const message of messages) {
      participants.add(message.author_id);

      const time = message.created_at.getTime();
      if (time < minTime) minTime = time;
      if (time > maxTime) maxTime = time;

      if ((message as any).referenced_message_id) {
        hasReplies = true;
      }

      if ((message as any).mentioned_user_ids && (message as any).mentioned_user_ids.length > 0) {
        hasMentions = true;
      }

      if (message.embedding) {
        embeddings.push(message.embedding);
      }
    }

    // Calculate average embedding if available
    let avgEmbedding: number[] | undefined;
    if (embeddings.length > 0 && embeddings[0]) {
      const embeddingLength = embeddings[0].length;
      avgEmbedding = new Array(embeddingLength).fill(0);

      for (const embedding of embeddings) {
        for (let i = 0; i < embeddingLength && i < embedding.length; i++) {
          avgEmbedding[i]! += embedding[i]!;
        }
      }

      for (let i = 0; i < avgEmbedding.length; i++) {
        avgEmbedding[i]! /= embeddings.length;
      }
    }

    return {
      participants,
      timeRange: { min: minTime, max: maxTime },
      avgEmbedding,
      hasReplies,
      hasMentions,
    };
  }
}

/**
 * Metadata about a conversation group
 */
export interface GroupMetadata {
  participants: Set<string>;
  timeRange: { min: number; max: number };
  avgEmbedding?: number[];
  hasReplies: boolean;
  hasMentions: boolean;
}
