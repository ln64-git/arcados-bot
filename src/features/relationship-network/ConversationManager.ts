import type { PostgreSQLManager } from "../database/PostgreSQLManager";
import type { DatabaseResult } from "../database/PostgreSQLManager";
import type { ConversationEntry } from "./types";

interface ChannelBuffer {
  messages: Array<{
    id: string;
    author_id: string;
    content: string;
    created_at: Date;
    referenced_message_id?: string;
    mentioned_user_ids?: string[];
  }>;
  startTime: Date;
  lastActivity: Date;
  timeoutHandle?: NodeJS.Timeout;
  guildId: string;
  channelId: string;
}

export class ConversationManager {
  private db: PostgreSQLManager;
  private channelBuffers: Map<string, ChannelBuffer> = new Map();
  private readonly INACTIVITY_MS = 5 * 60 * 1000; // 5 minutes base inactivity
  private readonly INACTIVITY_MS_WITH_REPLIES = 30 * 60 * 1000; // 30 minutes when there are active replies/mentions
  private readonly MIN_MESSAGES = 3;

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

    // Filter out bot commands and messages without meaningful content
    const validMessages = messages.filter(
      (m) =>
        !this.isBotCommand(m.content || "") &&
        this.hasMeaningfulContent(m.content || "")
    );

    if (validMessages.length === 0) {
      return [];
    }

    // Require at least one message with substantial content
    const hasSubstantialContent = validMessages.some(
      (m) => m.content && m.content.trim().length >= 10
    );
    if (!hasSubstantialContent) {
      return []; // All messages are too short/superficial
    }

    // Group messages by channel first, then cluster within each channel
    const messagesByChannel = new Map<string, any[]>();
    for (const msg of validMessages) {
      const channelId = msg.channel_id || "unknown";
      if (!messagesByChannel.has(channelId)) {
        messagesByChannel.set(channelId, []);
      }
      messagesByChannel.get(channelId)!.push(msg);
    }

    const conversations: ConversationEntry[] = [];
    const timeWindowMs = timeWindowMinutes * 60 * 1000;

    // Process each channel separately
    for (const [channelId, channelMessages] of messagesByChannel.entries()) {
      // Sort messages by time within this channel
      channelMessages.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      let currentConversation: any[] = [];
      let conversationStartTime: Date | null = null;

      for (let i = 0; i < channelMessages.length; i++) {
        const message = channelMessages[i];

        // Check if this message starts a new conversation
        const shouldStartNewConversation = this.shouldStartNewConversation(
          message,
          channelMessages,
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

      // Add the last conversation in this channel if it exists
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
    }

    // Filter out conversations that don't have actual back-and-forth
    const validConversations = conversations.filter((conv) => {
      // Must have at least 2 messages
      if (conv.message_count < 2) return false;

      // Must have messages from both users
      const hasUser1Messages = conv.message_ids.some((id) => {
        const message = validMessages.find((m) => m.id === id);
        return message && message.author_id === user1Id;
      });
      const hasUser2Messages = conv.message_ids.some((id) => {
        const message = validMessages.find((m) => m.id === id);
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

  // ============================================================================
  // Streaming Mode - Realtime Conversation Detection
  // ============================================================================

  /**
   * Check if message is a bot command that should be excluded from conversations
   */
  private isBotCommand(content: string): boolean {
    if (!content || content.trim().length === 0) return false;
    const trimmed = content.trim().toLowerCase();
    // Filter messages starting with m! (music bot commands: m!p, m!stop, m!skip, etc.)
    // or starting with . (bot commands: .spin, .play, etc.)
    return trimmed.startsWith("m!") || trimmed.startsWith(".");
  }

  /**
   * Check if message has meaningful text content (not just emojis/attachments)
   */
  private hasMeaningfulContent(content: string): boolean {
    if (!content || content.trim().length === 0) return false;

    // Remove Discord emoji/animated emoji patterns: <:name:id> or <a:name:id>
    const withoutEmojis = content.replace(/<(a?):[\w]+:\d+>/g, "");

    // Remove unicode emojis (basic check - single emoji characters)
    const withoutUnicode = withoutEmojis.replace(/[\u{1F300}-\u{1F9FF}]/gu, "");

    // Remove whitespace and common punctuation
    const trimmed = withoutUnicode.trim().replace(/^[^\w]*$/, "");

    // Must have at least 3 alphanumeric characters to be meaningful
    return trimmed.length >= 3 && /\w/.test(trimmed);
  }

  /**
   * Add message to streaming buffer (realtime)
   */
  async addMessageToStream(message: {
    id: string;
    author_id: string;
    content: string;
    created_at: Date;
    guild_id: string;
    channel_id: string;
    referenced_message_id?: string;
    mentioned_user_ids?: string[];
  }): Promise<void> {
    // Skip bot commands
    if (this.isBotCommand(message.content)) {
      return;
    }

    const key = `${message.guild_id}:${message.channel_id}`;
    let buffer = this.channelBuffers.get(key);

    if (!buffer) {
      buffer = {
        messages: [],
        startTime: message.created_at,
        lastActivity: message.created_at,
        guildId: message.guild_id,
        channelId: message.channel_id,
      };
      this.channelBuffers.set(key, buffer);
    }

    buffer.messages.push({
      id: message.id,
      author_id: message.author_id,
      content: message.content,
      created_at: message.created_at,
      referenced_message_id: message.referenced_message_id,
      mentioned_user_ids: message.mentioned_user_ids,
    });
    buffer.lastActivity = message.created_at;

    // Check if this message is a reply or has mentions - if so, use longer timeout
    const hasReplyOrMention =
      message.referenced_message_id ||
      (message.mentioned_user_ids && message.mentioned_user_ids.length > 0);

    // Also check if any recent message in buffer is a reply/mention to current participants
    const bufferMessages = buffer.messages; // Capture for closure
    const currentParticipants = new Set(bufferMessages.map((m) => m.author_id));
    const hasRecentReplyToParticipants = bufferMessages
      .slice(-10) // Check last 10 messages
      .some(
        (m) =>
          m.referenced_message_id &&
          bufferMessages.some(
            (prev) =>
              prev.id === m.referenced_message_id &&
              currentParticipants.has(prev.author_id)
          )
      );

    const inactivityTimeout =
      hasReplyOrMention || hasRecentReplyToParticipants
        ? this.INACTIVITY_MS_WITH_REPLIES
        : this.INACTIVITY_MS;

    if (buffer.timeoutHandle) {
      clearTimeout(buffer.timeoutHandle);
    }

    buffer.timeoutHandle = setTimeout(() => {
      this.finalizeSegment(key);
    }, inactivityTimeout);
  }

  /**
   * Group messages by reply chains and mentions
   * Messages that reply to each other or mention each other are grouped together
   */
  private groupByReplyChainsAndMentions(
    messages: Array<{
      id: string;
      author_id: string;
      content: string;
      created_at: Date;
      referenced_message_id?: string;
      mentioned_user_ids?: string[];
    }>
  ): Array<{ messages: typeof messages }> {
    if (messages.length === 0) return [];

    // Build a map of message ID to message
    const messageMap = new Map<string, (typeof messages)[0]>();
    for (const msg of messages) {
      messageMap.set(msg.id, msg);
    }

    // Build reply chains: message -> what it replies to -> what that replies to, etc.
    const replyChains = new Map<string, Set<string>>(); // message ID -> set of connected message IDs

    for (const msg of messages) {
      if (!msg.referenced_message_id) continue;

      // Find the root of the reply chain
      let currentMsg = msg;
      const chain = new Set<string>([msg.id]);

      // Walk up the reply chain
      while (currentMsg.referenced_message_id) {
        const referencedMsg = messageMap.get(currentMsg.referenced_message_id);
        if (!referencedMsg) break; // Referenced message not in this buffer

        // Check if we've hit a cycle (shouldn't happen, but safety check)
        if (chain.has(referencedMsg.id)) break;

        chain.add(referencedMsg.id);
        currentMsg = referencedMsg;
      }

      // Also walk down: find messages that reply to this one
      const walkDown = (msgId: string, visited: Set<string>) => {
        if (visited.has(msgId)) return;
        visited.add(msgId);
        for (const m of messages) {
          if (m.referenced_message_id === msgId) {
            chain.add(m.id);
            walkDown(m.id, visited);
          }
        }
      };
      walkDown(msg.id, new Set());

      // Store the chain for each message in it
      for (const msgId of chain) {
        if (!replyChains.has(msgId)) {
          replyChains.set(msgId, new Set());
        }
        const chainSet = replyChains.get(msgId)!;
        for (const otherMsgId of chain) {
          chainSet.add(otherMsgId);
        }
      }
    }

    // Build mention-based connections
    const mentionGroups = new Map<string, Set<string>>(); // participant ID -> set of message IDs

    for (const msg of messages) {
      if (!msg.mentioned_user_ids || msg.mentioned_user_ids.length === 0)
        continue;

      // Get all participants mentioned by this message
      const mentionedParticipants = new Set(msg.mentioned_user_ids);
      mentionedParticipants.add(msg.author_id); // Include the author

      // Group with messages from these participants or that mention them
      for (const otherMsg of messages) {
        const otherParticipants = new Set([otherMsg.author_id]);
        if (otherMsg.mentioned_user_ids) {
          otherMsg.mentioned_user_ids.forEach((id) =>
            otherParticipants.add(id)
          );
        }

        // Check if there's overlap
        const hasOverlap = Array.from(mentionedParticipants).some((p) =>
          otherParticipants.has(p)
        );
        if (hasOverlap) {
          for (const participant of mentionedParticipants) {
            if (!mentionGroups.has(participant)) {
              mentionGroups.set(participant, new Set());
            }
            mentionGroups.get(participant)!.add(msg.id);
            mentionGroups.get(participant)!.add(otherMsg.id);
          }
        }
      }
    }

    // Combine reply chains and mention groups
    const allGroups: Array<Set<string>> = [];
    const processedMessages = new Set<string>();

    // Add reply chain groups
    for (const chain of replyChains.values()) {
      if (chain.size >= 2) {
        // Only consider chains with at least 2 messages
        allGroups.push(new Set(chain));
        chain.forEach((id) => processedMessages.add(id));
      }
    }

    // Add mention groups
    for (const mentionGroup of mentionGroups.values()) {
      if (mentionGroup.size >= 2) {
        // Merge with existing groups if they overlap
        let merged = false;
        for (let i = 0; i < allGroups.length; i++) {
          const existingGroup = allGroups[i];
          if (!existingGroup) continue;
          // Check for overlap
          const hasOverlap = Array.from(mentionGroup).some((id) =>
            existingGroup.has(id)
          );
          if (hasOverlap) {
            // Merge
            mentionGroup.forEach((id) => existingGroup.add(id));
            merged = true;
            break;
          }
        }
        if (!merged) {
          allGroups.push(new Set(mentionGroup));
        }
        mentionGroup.forEach((id) => processedMessages.add(id));
      }
    }

    // Add unconnected messages that don't have replies/mentions
    // Only if they're part of an ongoing conversation (within 5 minutes AND author is already a participant)
    const unprocessedMessages = messages.filter(
      (m) => !processedMessages.has(m.id)
    );
    const TIME_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

    for (const msg of unprocessedMessages) {
      let added = false;
      for (const group of allGroups) {
        const groupMessages = Array.from(group)
          .map((id) => messageMap.get(id))
          .filter(Boolean);

        if (groupMessages.length === 0) continue;

        // Get participants of this conversation group
        const groupParticipants = new Set(
          groupMessages.map((m) => m!.author_id)
        );

        // Check if:
        // 1. Message author is already a participant in this conversation
        // 2. Message is within time window of the conversation
        const isParticipant = groupParticipants.has(msg.author_id);
        const timeRange = {
          min: Math.min(...groupMessages.map((m) => m!.created_at.getTime())),
          max: Math.max(...groupMessages.map((m) => m!.created_at.getTime())),
        };
        const msgTime = msg.created_at.getTime();
        const isWithinTimeWindow =
          msgTime >= timeRange.min - TIME_WINDOW_MS &&
          msgTime <= timeRange.max + TIME_WINDOW_MS;

        if (isParticipant && isWithinTimeWindow) {
          // This message is part of an ongoing conversation
          group.add(msg.id);
          processedMessages.add(msg.id);
          added = true;
          break;
        }
      }
      // Don't create new groups for messages without replies/mentions
      // They're just one-off messages, not part of actual conversations
    }

    // Convert groups back to message arrays, filtering out groups that are too small
    // Only include groups that have actual reply/mention connections (not just time-based)
    const result: Array<{ messages: typeof messages }> = [];
    for (const group of allGroups) {
      if (group.size >= this.MIN_MESSAGES) {
        const groupMessages = Array.from(group)
          .map((id) => messageMap.get(id))
          .filter((m): m is (typeof messages)[0] => m !== undefined);

        if (groupMessages.length >= this.MIN_MESSAGES) {
          // Verify this group has actual conversation connections (replies or mentions)
          // Not just random messages grouped by time
          const hasReplyConnections = groupMessages.some(
            (m) => m.referenced_message_id && group.has(m.referenced_message_id)
          );
          const hasMentions = groupMessages.some(
            (m) => m.mentioned_user_ids && m.mentioned_user_ids.length > 0
          );

          // Only include if there are actual reply chains or mentions connecting the messages
          if (hasReplyConnections || hasMentions) {
            result.push({ messages: groupMessages });
          }
        }
      }
    }

    // Don't fallback - if no valid conversation groups found, return empty
    // This filters out noise (one-off messages without actual conversations)
    return result;
  }

  /**
   * Include referenced messages that aren't already in the conversation group
   * This ensures reply chains are complete - if someone replies to a message,
   * that original message should be included in the conversation.
   * Recursively fetches the full reply chain.
   */
  private async includeReferencedMessages(
    group: {
      messages: Array<{
        id: string;
        author_id: string;
        content: string;
        created_at: Date;
        referenced_message_id?: string;
        mentioned_user_ids?: string[];
      }>;
    },
    buffer: ChannelBuffer
  ): Promise<typeof group> {
    const messageIdsInGroup = new Set(group.messages.map((m) => m.id));
    const MAX_REFERENCE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours - don't include very old references
    const fetchedMessages = new Map<string, (typeof group.messages)[0]>();

    // Recursively fetch all referenced messages in the reply chain
    const fetchReferencedChain = async (
      messageId: string,
      visited: Set<string>
    ): Promise<void> => {
      if (
        visited.has(messageId) ||
        messageIdsInGroup.has(messageId) ||
        fetchedMessages.has(messageId)
      ) {
        return; // Already processed, already in group, or already fetched
      }
      visited.add(messageId);

      try {
        const result = await this.db.query(
          `SELECT id, author_id, content, created_at, channel_id, referenced_message_id
           FROM messages
           WHERE id = $1 AND guild_id = $2 AND channel_id = $3 AND active = true`,
          [messageId, buffer.guildId, buffer.channelId]
        );

        if (result.success && result.data && result.data.length > 0) {
          const refMsg = result.data[0] as any;

          // Only include if:
          // 1. Same channel
          // 2. Within reasonable time window (24 hours)
          // 3. Has meaningful content (not bot command)
          const msgTime = new Date(refMsg.created_at).getTime();
          const bufferTime = buffer.startTime.getTime();
          const ageDiff = Math.abs(bufferTime - msgTime);

          if (
            refMsg.channel_id === buffer.channelId &&
            ageDiff <= MAX_REFERENCE_AGE_MS &&
            !this.isBotCommand(refMsg.content) &&
            this.hasMeaningfulContent(refMsg.content)
          ) {
            // Add this message
            const messageData: (typeof group.messages)[0] = {
              id: refMsg.id,
              author_id: refMsg.author_id,
              content: refMsg.content,
              created_at: new Date(refMsg.created_at),
              referenced_message_id: refMsg.referenced_message_id || undefined,
              mentioned_user_ids: undefined, // We don't store this for old messages
            };
            fetchedMessages.set(refMsg.id, messageData);

            // Recursively fetch what this message references (walk up the reply chain)
            if (refMsg.referenced_message_id) {
              await fetchReferencedChain(refMsg.referenced_message_id, visited);
            }
          }
        }
      } catch (error) {
        // Silently skip if fetch fails
        console.error(
          `🔸 Failed to fetch referenced message ${messageId}:`,
          error
        );
      }
    };

    // Find all referenced message IDs that aren't already in the group
    const referencedIdsToFetch = new Set<string>();
    for (const msg of group.messages) {
      if (
        msg.referenced_message_id &&
        !messageIdsInGroup.has(msg.referenced_message_id)
      ) {
        referencedIdsToFetch.add(msg.referenced_message_id);
      }
    }

    // Recursively fetch all referenced messages and their chains
    // Use a single visited set across all calls to avoid duplicate fetches and infinite loops
    const globalVisited = new Set<string>();
    for (const refId of referencedIdsToFetch) {
      await fetchReferencedChain(refId, globalVisited);
    }

    // Add all fetched messages to the group
    if (fetchedMessages.size > 0) {
      return {
        messages: [...group.messages, ...Array.from(fetchedMessages.values())],
      };
    }

    return group;
  }

  /**
   * Finalize a conversation segment and write to DB
   */
  private async finalizeSegment(bufferKey: string): Promise<void> {
    const buffer = this.channelBuffers.get(bufferKey);
    if (!buffer) return;

    this.channelBuffers.delete(bufferKey);
    if (buffer.timeoutHandle) {
      clearTimeout(buffer.timeoutHandle);
    }

    // Filter out bot commands and messages without meaningful content
    const validMessages = buffer.messages.filter(
      (m) =>
        !this.isBotCommand(m.content) && this.hasMeaningfulContent(m.content)
    );

    if (validMessages.length < this.MIN_MESSAGES) {
      return; // Not enough valid messages
    }

    // Require at least one message with substantial content (not just short responses)
    const hasSubstantialContent = validMessages.some(
      (m) => m.content && m.content.trim().length >= 10
    );
    if (!hasSubstantialContent) {
      return; // All messages are too short/superficial
    }

    // Group messages by reply chains and mentions before determining participants
    // This ensures messages that reply to each other stay together
    const groupedMessages = this.groupByReplyChainsAndMentions(validMessages);

    if (groupedMessages.length === 0) {
      return; // No valid conversation groups found - filter out noise
    }

    // Use the largest group (most interconnected conversation)
    // This represents the main conversation thread among all detected groups
    let largestGroup = groupedMessages.reduce((a, b) =>
      b.messages.length > a.messages.length ? b : a
    );

    // Fetch and include any referenced messages that aren't already in the group
    // If the first message in a conversation is a reply, we should include what it's replying to
    largestGroup = await this.includeReferencedMessages(largestGroup, buffer);

    // Sort messages chronologically after adding referenced messages
    largestGroup.messages.sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime()
    );

    const participants = Array.from(
      new Set(largestGroup.messages.map((m) => m.author_id))
    )
      .filter((id) => id && id.trim().length > 0)
      .sort();

    if (participants.length < 2) {
      return; // Need at least 2 participants
    }

    // Use the grouped messages for this segment (already sorted chronologically)
    const segmentMessages = largestGroup.messages;

    // segmentMessages is guaranteed to have at least MIN_MESSAGES items at this point
    const segmentId = `seg_${segmentMessages[0]!.id}_${Date.now()}`;
    const endTime = segmentMessages[segmentMessages.length - 1]!.created_at;

    const features: Record<string, any> = {
      mention_count: segmentMessages.filter(
        (m) => m.mentioned_user_ids && m.mentioned_user_ids.length > 0
      ).length,
      reply_count: segmentMessages.filter(
        (m) =>
          m.referenced_message_id !== undefined &&
          m.referenced_message_id !== null
      ).length,
    };

    const summary = this.generateSegmentSummary(segmentMessages, participants);

    await this.db.upsertConversationSegment({
      id: segmentId,
      guildId: buffer.guildId,
      channelId: buffer.channelId,
      participants,
      startTime: buffer.startTime,
      endTime,
      messageIds: segmentMessages.map((m) => m.id),
      messageCount: segmentMessages.length,
      features,
      summary,
    });

    // Only create pairs for distinct users (skip self-interactions)
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        // Skip if same user
        if (participants[i] === participants[j]) continue;
        const user1 = participants[i];
        const user2 = participants[j];
        if (user1 && user2) {
          await this.db.upsertPair(buffer.guildId, user1, user2, segmentId);
        }
      }
    }

    // Try to merge with nearby segments in the same channel
    await this.mergeNearbySegments(
      buffer.guildId,
      buffer.channelId,
      segmentId,
      participants,
      buffer.startTime,
      endTime
    );
  }

  /**
   * Merge segments that are close in time with overlapping participants
   */
  private async mergeNearbySegments(
    guildId: string,
    channelId: string,
    newSegmentId: string,
    participants: string[],
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    try {
      // Find segments in the same channel that are within 30 minutes and have overlapping participants
      const mergeWindowMs = 30 * 60 * 1000; // 30 minutes
      const nearbyResult = await this.db.query(
        `SELECT id, participants, start_time, end_time, message_ids, message_count
         FROM conversation_segments
         WHERE guild_id = $1 
           AND channel_id = $2
           AND id != $3
           AND (
             (start_time BETWEEN $4::timestamp - interval '30 minutes' AND $5::timestamp + interval '30 minutes')
             OR (end_time BETWEEN $4::timestamp - interval '30 minutes' AND $5::timestamp + interval '30 minutes')
           )
         ORDER BY start_time ASC`,
        [guildId, channelId, newSegmentId, startTime, endTime]
      );

      if (
        !nearbyResult.success ||
        !nearbyResult.data ||
        nearbyResult.data.length === 0
      ) {
        return;
      }

      const nearbySegments = nearbyResult.data;
      const participantsSet = new Set(participants);

      // Find segments with overlapping participants
      const segmentsToMerge: any[] = [];
      for (const seg of nearbySegments) {
        const segParticipants = Array.isArray(seg.participants)
          ? seg.participants
          : (seg.participants as any).split
          ? (seg.participants as any).split(",")
          : [];

        const hasOverlap = segParticipants.some((p: string) =>
          participantsSet.has(p)
        );
        if (hasOverlap) {
          segmentsToMerge.push(seg);
        }
      }

      if (segmentsToMerge.length === 0) return;

      // Merge: combine participants and message_ids
      const allParticipants = new Set(participants);
      const allMessageIds = new Set<string>();

      // Get current segment's message IDs
      const currentSegmentResult = await this.db.query(
        `SELECT message_ids FROM conversation_segments WHERE id = $1`,
        [newSegmentId]
      );

      if (currentSegmentResult.success && currentSegmentResult.data) {
        const currentMsgIds = Array.isArray(
          currentSegmentResult.data[0]?.message_ids
        )
          ? currentSegmentResult.data[0].message_ids
          : [];
        currentMsgIds.forEach((id: string) => allMessageIds.add(id));
      }

      for (const seg of segmentsToMerge) {
        const segParticipants = Array.isArray(seg.participants)
          ? seg.participants
          : (seg.participants as any).split
          ? (seg.participants as any).split(",")
          : [];
        segParticipants.forEach((p: string) => allParticipants.add(p));

        const segMsgIds = Array.isArray(seg.message_ids)
          ? seg.message_ids
          : (seg.message_ids as any).split
          ? (seg.message_ids as any).split(",")
          : [];
        segMsgIds.forEach((id: string) => allMessageIds.add(id));
      }

      // Update the new segment with merged data
      const mergedParticipants = Array.from(allParticipants).sort();
      const mergedMessageIds = Array.from(allMessageIds);

      // Recalculate times
      const allStartTimes = [
        startTime,
        ...segmentsToMerge.map((s) => new Date(s.start_time)),
      ];
      const allEndTimes = [
        endTime,
        ...segmentsToMerge.map((s) => new Date(s.end_time)),
      ];
      const mergedStartTime = new Date(
        Math.min(...allStartTimes.map((d) => d.getTime()))
      );
      const mergedEndTime = new Date(
        Math.max(...allEndTimes.map((d) => d.getTime()))
      );

      // Update the segment
      await this.db.query(
        `UPDATE conversation_segments
         SET participants = $1::TEXT[],
             message_ids = $2::TEXT[],
             message_count = $3,
             start_time = $4,
             end_time = $5
         WHERE id = $6`,
        [
          mergedParticipants,
          mergedMessageIds,
          mergedMessageIds.length,
          mergedStartTime,
          mergedEndTime,
          newSegmentId,
        ]
      );

      // Delete merged segments
      const deleteIds = segmentsToMerge.map((s) => s.id);
      if (deleteIds.length > 0) {
        await this.db.query(
          `DELETE FROM conversation_segments WHERE id = ANY($1::TEXT[])`,
          [deleteIds]
        );
      }
    } catch (error) {
      // Silently fail - merging is optional
    }
  }

  /**
   * Generate a short summary for a conversation segment
   */
  private generateSegmentSummary(
    messages: Array<{ content: string; author_id: string }>,
    participants: string[]
  ): string {
    const contents = messages
      .map((m) => m.content)
      .filter((c) => c && c.length > 0)
      .slice(0, 5)
      .join(" ")
      .substring(0, 200);
    return `${participants.length} users: ${contents}...`;
  }

  /**
   * Manually finalize all active segments (for shutdown/cleanup)
   */
  async finalizeAllSegments(): Promise<void> {
    const keys = Array.from(this.channelBuffers.keys());
    for (const key of keys) {
      await this.finalizeSegment(key);
    }
  }
}
