/**
 * Validates conversation groups against various constraints
 * Ensures conversations meet quality and realism requirements
 */
export class ConversationValidator {
  private readonly MAX_CONVERSATION_DURATION_MS: number;
  private readonly MAX_MESSAGE_GAP_MS: number;
  private readonly MIN_MESSAGES: number;

  constructor(
    maxConversationDurationMs = 24 * 60 * 60 * 1000, // 24 hours
    maxMessageGapMs = 4 * 60 * 60 * 1000, // 4 hours
    minMessages = 2
  ) {
    this.MAX_CONVERSATION_DURATION_MS = maxConversationDurationMs;
    this.MAX_MESSAGE_GAP_MS = maxMessageGapMs;
    this.MIN_MESSAGES = minMessages;
  }

  /**
   * Validate that conversation doesn't span too long (prevents unrealistic grouping)
   */
  validateDuration<T extends { created_at: Date }>(messages: T[]): boolean {
    if (messages.length === 0) {
      return false;
    }

    const firstTime = messages[0]!.created_at.getTime();
    const lastTime = messages[messages.length - 1]!.created_at.getTime();
    const duration = lastTime - firstTime;

    return duration <= this.MAX_CONVERSATION_DURATION_MS;
  }

  /**
   * Validate that there are no large gaps between consecutive messages
   */
  validateGaps<T extends { created_at: Date }>(messages: T[]): boolean {
    if (messages.length < 2) {
      return true; // Single message has no gaps
    }

    for (let i = 1; i < messages.length; i++) {
      const currentMsg = messages[i];
      const prevMsg = messages[i - 1];

      if (currentMsg && prevMsg) {
        const gap = currentMsg.created_at.getTime() - prevMsg.created_at.getTime();
        if (gap > this.MAX_MESSAGE_GAP_MS) {
          return false; // Gap too large
        }
      }
    }

    return true;
  }

  /**
   * Validate that conversation has explicit connections (replies or mentions)
   */
  validateConnections<
    T extends {
      id: string;
      referenced_message_id?: string;
      mentioned_user_ids?: string[];
    }
  >(messages: T[], messageIds: Set<string>): boolean {
    // Check for reply connections within the group
    const hasReplyConnections = messages.some(
      (m) => m.referenced_message_id && messageIds.has(m.referenced_message_id)
    );

    // Check for mentions
    const hasMentions = messages.some(
      (m) => m.mentioned_user_ids && m.mentioned_user_ids.length > 0
    );

    return hasReplyConnections || hasMentions;
  }

  /**
   * Validate that conversation has enough participants (at least 2 different users)
   */
  validateParticipants<T extends { author_id: string }>(messages: T[]): boolean {
    const participants = new Set(messages.map((m) => m.author_id));
    return participants.size >= 2;
  }

  /**
   * Validate that conversation has minimum number of messages
   * If conversation has explicit connections (replies/mentions), require fewer messages
   */
  validateMinimumMessages<
    T extends {
      id: string;
      referenced_message_id?: string;
      mentioned_user_ids?: string[];
    }
  >(messages: T[], messageIds: Set<string>): boolean {
    if (messages.length < 2) {
      return false; // Always require at least 2 messages
    }

    const hasConnections = this.validateConnections(messages, messageIds);

    // If has explicit connections, 2 messages is enough
    // Otherwise, require the configured minimum
    const minRequired = hasConnections ? 2 : this.MIN_MESSAGES;

    return messages.length >= minRequired;
  }

  /**
   * Run all validations and return true if conversation is valid
   */
  isValidConversation<
    T extends {
      id: string;
      author_id: string;
      created_at: Date;
      referenced_message_id?: string;
      mentioned_user_ids?: string[];
    }
  >(messages: T[], messageIds: Set<string>): boolean {
    // Messages must be sorted by created_at before calling this method
    // TUNED: Removed strict connection requirement to allow natural conversations
    // Connection requirement was too strict - same reply/mention rate in mapped vs unmapped (18%)
    return (
      this.validateMinimumMessages(messages, messageIds) &&
      this.validateParticipants(messages) &&
      this.validateDuration(messages) &&
      this.validateGaps(messages)
      // this.validateConnections(messages, messageIds) // DISABLED: Too strict, allows natural chat
    );
  }

  /**
   * Get validation results with detailed reasons for failure
   * Useful for debugging and logging
   */
  getValidationDetails<
    T extends {
      id: string;
      author_id: string;
      created_at: Date;
      referenced_message_id?: string;
      mentioned_user_ids?: string[];
    }
  >(messages: T[], messageIds: Set<string>): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      failures: [],
    };

    if (!this.validateMinimumMessages(messages, messageIds)) {
      result.isValid = false;
      result.failures.push("Insufficient messages");
    }

    if (!this.validateParticipants(messages)) {
      result.isValid = false;
      result.failures.push("Insufficient participants (need at least 2)");
    }

    if (!this.validateDuration(messages)) {
      result.isValid = false;
      result.failures.push(`Duration exceeds maximum (${this.MAX_CONVERSATION_DURATION_MS}ms)`);
    }

    if (!this.validateGaps(messages)) {
      result.isValid = false;
      result.failures.push(`Message gap exceeds maximum (${this.MAX_MESSAGE_GAP_MS}ms)`);
    }

    if (!this.validateConnections(messages, messageIds)) {
      result.isValid = false;
      result.failures.push("No explicit connections (replies/mentions)");
    }

    return result;
  }
}

/**
 * Result of validation with detailed failure reasons
 */
export interface ValidationResult {
  isValid: boolean;
  failures: string[];
}
