import type { PostgreSQLManager } from "../database/PostgreSQLManager";
import type { DatabaseResult } from "../database/PostgreSQLManager";
import type { ConversationEntry } from "./types";

export class ConversationManager {
  private db: PostgreSQLManager;

  // Pre-compile regex patterns for better performance
  private readonly mentionPattern = /<@!?(\d+)>/g;
  private readonly replyPatterns = [/^re:/i, /^>/, /^@\w+/, /^responding to/i];
  private readonly questionPatterns = [
    /\?$/,
    /^(what|how|why|when|where|who|can|could|would|should|do|does|did|is|are|was|were)\s/i,
    /^(hey|hi|hello)\s/i,
  ];
  private readonly directAddressPatterns = [
    /^(you|your|yours)\s/i,
    /^(i think|i believe|i feel|i know)\s/i,
    /^(thanks|thank you|thx)/i,
    /^(sorry|apologize|apologies)/i,
  ];
  private readonly reactionPatterns = [
    /(👍|👎|❤️|😀|😢|😮|😡|🤔|👏|🙌)/,
    /(lol|lmao|haha|hehe)/i,
    /(omg|wtf|wow|damn)/i,
  ];

  constructor(db: PostgreSQLManager) {
    this.db = db;
  }

  /**
   * Detect conversations between two users using interaction-driven clustering
   */
  async detectConversations(
    user1Id: string,
    user2Id: string,
    guildId: string,
    timeWindowMinutes: number = 5
  ): Promise<DatabaseResult<ConversationEntry[]>> {
    try {
      // Get all messages between the two users
      const messagesResult = await this.db.getMessagesBetweenUsers(
        user1Id,
        user2Id,
        guildId
      );

      if (!messagesResult.success || !messagesResult.data) {
        return {
          success: false,
          error: `Failed to get messages: ${messagesResult.error}`,
        };
      }

      const messages = messagesResult.data;
      if (messages.length === 0) {
        return { success: true, data: [] };
      }

      // Get user names for both users
      const [user1NamesResult, user2NamesResult] = await Promise.all([
        this.db.getUserNames(user1Id, guildId),
        this.db.getUserNames(user2Id, guildId),
      ]);

      const user1Names = user1NamesResult.success
        ? user1NamesResult.data || []
        : [];
      const user2Names = user2NamesResult.success
        ? user2NamesResult.data || []
        : [];

      // Cluster messages into conversations
      const conversations = this.clusterMessagesIntoConversations(
        messages,
        timeWindowMinutes,
        user1Id,
        user2Id,
        user1Names,
        user2Names
      );

      return { success: true, data: conversations };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Cluster messages into conversations based on interaction patterns
   */
  private clusterMessagesIntoConversations(
    messages: any[],
    timeWindowMinutes: number,
    user1Id: string,
    user2Id: string,
    user1Names: string[],
    user2Names: string[]
  ): ConversationEntry[] {
    if (messages.length === 0) {
      return [];
    }

    const conversations: ConversationEntry[] = [];
    const timeWindowMs = timeWindowMinutes * 60 * 1000;
    let currentConversation: any[] = [];
    let conversationStartTime: Date | null = null;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // Check if this message starts a new conversation
      const shouldStartNewConversation = this.shouldStartNewConversation(
        message,
        messages,
        i,
        currentConversation,
        conversationStartTime,
        timeWindowMs,
        user1Id,
        user2Id,
        user1Names,
        user2Names
      );

      if (shouldStartNewConversation && currentConversation.length > 0) {
        // Finalize current conversation
        conversations.push(
          this.createConversationEntry(
            currentConversation,
            conversationStartTime!,
            user1Id,
            user2Id,
            user1Names,
            user2Names
          )
        );

        // Start new conversation
        currentConversation = [message];
        conversationStartTime = new Date(message.created_at);
      } else if (currentConversation.length === 0) {
        // First message
        currentConversation = [message];
        conversationStartTime = new Date(message.created_at);
      } else {
        // Continue current conversation
        currentConversation.push(message);
      }
    }

    // Add the last conversation if it exists
    if (currentConversation.length > 0 && conversationStartTime) {
      conversations.push(
        this.createConversationEntry(
          currentConversation,
          conversationStartTime,
          user1Id,
          user2Id,
          user1Names,
          user2Names
        )
      );
    }

    // Filter out conversations that don't have actual back-and-forth
    const validConversations = conversations.filter((conv) => {
      // Must have at least 2 messages
      if (conv.message_count < 2) return false;

      // Must have messages from both users
      const hasUser1Messages = conv.message_ids.some((id) => {
        const message = messages.find((m) => m.id === id);
        return message && message.author_id === user1Id;
      });
      const hasUser2Messages = conv.message_ids.some((id) => {
        const message = messages.find((m) => m.id === id);
        return message && message.author_id === user2Id;
      });

      return hasUser1Messages && hasUser2Messages;
    });

    return validConversations;
  }

  /**
   * Determine if a message should start a new conversation
   */
  private shouldStartNewConversation(
    message: any,
    allMessages: any[],
    currentIndex: number,
    currentConversation: any[],
    conversationStartTime: Date | null,
    timeWindowMs: number,
    user1Id: string,
    user2Id: string,
    user1Names: string[],
    user2Names: string[]
  ): boolean {
    if (currentConversation.length === 0) {
      return false; // No current conversation to compare against
    }

    const messageTime = new Date(message.created_at).getTime();
    const lastConversationTime = new Date(
      currentConversation[currentConversation.length - 1].created_at
    ).getTime();

    // Check for time gap - if more than timeWindowMs has passed
    if (messageTime - lastConversationTime > timeWindowMs) {
      return true;
    }

    return false;
  }

  /**
   * Check if a message has direct interaction (reply, mention, or name usage)
   */
  private hasDirectInteraction(
    message: any,
    allMessages: any[],
    currentIndex: number,
    user1Id: string,
    user2Id: string,
    user1Names: string[],
    user2Names: string[]
  ): boolean {
    const content = message.content;
    if (!content || content.length === 0) {
      return false;
    }

    // Check for mentions in content
    if (this.mentionPattern.test(content)) {
      return true;
    }

    // Check for name-based interactions
    const otherUserNames =
      message.author_id === user1Id ? user2Names : user1Names;
    for (const name of otherUserNames) {
      if (name && content.toLowerCase().includes(name.toLowerCase())) {
        return true;
      }
    }

    const trimmedContent = content.trim();

    // Check for reply patterns
    for (const pattern of this.replyPatterns) {
      if (pattern.test(trimmedContent)) {
        return true;
      }
    }

    // Check for question patterns
    for (const pattern of this.questionPatterns) {
      if (pattern.test(trimmedContent)) {
        return true;
      }
    }

    // Check for direct address patterns
    for (const pattern of this.directAddressPatterns) {
      if (pattern.test(trimmedContent)) {
        return true;
      }
    }

    // Check for reaction patterns
    for (const pattern of this.reactionPatterns) {
      if (pattern.test(content)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create a ConversationEntry from a cluster of messages
   */
  private createConversationEntry(
    messages: any[],
    startTime: Date,
    user1Id: string,
    user2Id: string,
    user1Names: string[],
    user2Names: string[]
  ): ConversationEntry {
    const endTime = new Date(messages[messages.length - 1].created_at);
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationMinutes = Math.round(durationMs / (1000 * 60));

    // Check for mentions efficiently
    const hasMentions = messages.some(
      (message) => message.content && message.content.includes("<@")
    );

    // Check for actual name usage in messages
    const hasNameUsage = messages.some((message) => {
      if (!message.content) return false;

      const otherUserNames =
        message.author_id === user1Id ? user2Names : user1Names;
      return otherUserNames.some(
        (name) =>
          name && message.content.toLowerCase().includes(name.toLowerCase())
      );
    });

    // Generate unique conversation ID
    const conversationId = `conv_${messages[0].id}_${
      messages[messages.length - 1].id
    }`;

    return {
      conversation_id: conversationId,
      start_time: startTime,
      end_time: endTime,
      message_count: messages.length,
      channel_id: messages[0].channel_id, // Assume all messages in same channel
      message_ids: messages.map((m) => m.id),
      interaction_types: hasMentions ? ["mention"] : [],
      duration_minutes: durationMinutes,
      user_names: {
        user1: user1Names,
        user2: user2Names,
      },
      has_name_usage: hasNameUsage, // Add flag for actual name usage
    };
  }
}
