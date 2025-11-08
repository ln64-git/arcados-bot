import type { PostgreSQLManager } from "../database/PostgreSQLManager";
import type { DatabaseResult } from "../database/PostgreSQLManager";
import type { ConversationEntry } from "./types";

interface ActiveConversation {
  participants: Set<string>;
  messageIds: Set<string>;
  lastActivity: Date;
  topicEmbedding?: number[]; // Semantic center of conversation
}

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
  activeConversations: ActiveConversation[];
}

interface CachedEdgeData {
  data: any;
  expiredAt: number;
}

export class ConversationManager {
  private db: PostgreSQLManager;
  private channelBuffers: Map<string, ChannelBuffer> = new Map();
  private finalizationLocks: Map<string, Promise<void>> = new Map();
  private edgeCache: Map<string, CachedEdgeData> = new Map(); // Cache for edge queries
  private readonly EDGE_CACHE_TTL = 5 * 60 * 1000; // 5 minute cache TTL
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
   * Get or retrieve edge data with caching
   */
  private async getCachedEdge(
    guildId: string,
    user1: string,
    user2: string
  ): Promise<any> {
    const cacheKey = `${guildId}:${user1}:${user2}`;
    const now = Date.now();

    // Check cache
    const cached = this.edgeCache.get(cacheKey);
    if (cached && cached.expiredAt > now) {
      return cached.data;
    }

    // Fetch from DB
    const data = await this.db.getEdgeForPair(guildId, user1, user2);

    // Update cache
    this.edgeCache.set(cacheKey, {
      data,
      expiredAt: now + this.EDGE_CACHE_TTL,
    });

    return data;
  }

  /**
   * Cleanup expired cache entries
   */
  private cleanupEdgeCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.edgeCache.entries()) {
      if (entry.expiredAt < now) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.edgeCache.delete(key);
    }
  }

  /**
   * Get lightweight conversation references for two users (optimized for relationship_network)
   * Returns segment references without full message data
   */
  async getConversationSegmentsForUsers(
    user1Id: string,
    user2Id: string,
    guildId: string,
    limit: number = 20
  ): Promise<DatabaseResult<ConversationEntry[]>> {
    try {
      // Get segments where both users are participants
      const result = await this.db.query(
        `
        SELECT
          id as segment_id,
          start_time,
          end_time,
          message_count,
          channel_id,
          array_length(participants, 1) as participant_count,
          EXTRACT(EPOCH FROM (end_time - start_time))/60::int as duration_minutes,
          features->>'interaction_types' as interaction_types
        FROM conversation_segments
        WHERE guild_id = $1
          AND participants @> $2::TEXT[]
          AND participants @> $3::TEXT[]
        ORDER BY end_time DESC
        LIMIT $4
        `,
        [guildId, [user1Id], [user2Id], limit]
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      const conversations: ConversationEntry[] = (result.data || []).map((row: any) => ({
        segment_id: row.segment_id,
        start_time: new Date(row.start_time),
        end_time: new Date(row.end_time),
        message_count: row.message_count,
        channel_id: row.channel_id,
        interaction_types: row.interaction_types ? row.interaction_types.split(',') : [],
        duration_minutes: row.duration_minutes || 0,
        participant_count: row.participant_count || 2,
      }));

      return { success: true, data: conversations };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
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
      const hasUser1Messages = conv.message_ids?.some((id) => {
        const message = validMessages.find((m) => m.id === id);
        return message && message.author_id === user1Id;
      });
      const hasUser2Messages = conv.message_ids?.some((id) => {
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
      segment_id: conversationId,
      conversation_id: conversationId, // Legacy alias
      start_time: startTime,
      end_time: endTime,
      message_count: messages.length,
      participant_count: 2, // Two users in this conversation
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
   * Get relationship score between author and participants (normalized 0-1)
   * Uses cached edge data to reduce DB queries
   */
  private async getRelationshipScore(
    authorId: string,
    participants: Set<string>,
    guildId: string
  ): Promise<number> {
    if (participants.size === 0) return 0;

    let maxScore = 0;

    for (const participantId of participants) {
      if (participantId === authorId) continue;

      // Check both directions (A->B and B->A) using cached data
      const edgeAtoB = await this.getCachedEdge(
        guildId,
        authorId,
        participantId
      );
      const edgeBtoA = await this.getCachedEdge(
        guildId,
        participantId,
        authorId
      );

      // Get total interaction count (bidirectional)
      let totalInteractions = 0;
      if (edgeAtoB?.success && edgeAtoB.data) {
        totalInteractions += edgeAtoB.data.total || 0;
      }
      if (edgeBtoA?.success && edgeBtoA.data) {
        totalInteractions += edgeBtoA.data.total || 0;
      }

      // Normalize: divide by 100 (can be adjusted based on typical interaction counts)
      // Cap at 1.0
      const normalizedScore = Math.min(totalInteractions / 100, 1.0);
      maxScore = Math.max(maxScore, normalizedScore);
    }

    // Periodically cleanup expired cache entries
    if (Math.random() < 0.1) {
      this.cleanupEdgeCache();
    }

    return maxScore;
  }

  /**
   * Score a message against active conversations
   * Returns sorted array of { conversation, score }
   */
  private async scoreMessageAgainstConversations(
    message: {
      id: string;
      author_id: string;
      content: string;
      created_at: Date;
      embedding?: number[];
    },
    conversations: ActiveConversation[],
    guildId: string
  ): Promise<Array<{ conversation: ActiveConversation; score: number }>> {
    const scores: Array<{ conversation: ActiveConversation; score: number }> =
      [];

    for (const conversation of conversations) {
      // Relationship score (0-1): Max affinity between author and participants
      const relationshipScore = await this.getRelationshipScore(
        message.author_id,
        conversation.participants,
        guildId
      );

      // Semantic score (0-1): Cosine similarity if embeddings exist
      let semanticScore = 0;
      const msgEmbed = message.embedding;
      const convEmbed = conversation.topicEmbedding;
      if (
        msgEmbed &&
        convEmbed &&
        msgEmbed.length === convEmbed.length
      ) {
        // Cosine similarity
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < msgEmbed.length; i++) {
          dotProduct += msgEmbed[i]! * convEmbed[i]!;
          normA += msgEmbed[i]! * msgEmbed[i]!;
          normB += convEmbed[i]! * convEmbed[i]!;
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        if (denominator > 0) {
          semanticScore = dotProduct / denominator;
          // Normalize to 0-1 (cosine similarity is -1 to 1)
          semanticScore = (semanticScore + 1) / 2;
        }
      }

      // Time score (0-1): Within 10 minute window
      const timeDiff =
        message.created_at.getTime() - conversation.lastActivity.getTime();
      const timeWindowMs = 10 * 60 * 1000; // 10 minutes
      const timeScore =
        timeDiff >= 0 && timeDiff <= timeWindowMs
          ? 1 - timeDiff / timeWindowMs
          : 0;

      // Weighted combination: relationship (0.5) + semantic (0.3) + time (0.2)
      const combinedScore =
        relationshipScore * 0.5 + semanticScore * 0.3 + timeScore * 0.2;

      scores.push({ conversation, score: combinedScore });
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
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
    embedding?: number[];
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
        activeConversations: [],
      };
      this.channelBuffers.set(key, buffer);
    }

    // Check if message has direct signal (reply or mention)
    const hasDirectSignal =
      message.referenced_message_id ||
      (message.mentioned_user_ids && message.mentioned_user_ids.length > 0);

    // If no direct signal, try to route to existing conversation
    if (!hasDirectSignal && buffer.activeConversations.length > 0) {
      const scoredMatches = await this.scoreMessageAgainstConversations(
        {
          id: message.id,
          author_id: message.author_id,
          content: message.content || "",
          created_at: message.created_at,
          embedding: message.embedding,
        },
        buffer.activeConversations,
        message.guild_id || ""
      );

      if (scoredMatches.length > 0 && scoredMatches[0] && scoredMatches[0].score > 0.5) {
        // Route to best matching conversation
        const bestMatch = scoredMatches[0]!.conversation;
        bestMatch.participants.add(message.author_id);
        bestMatch.messageIds.add(message.id);
        bestMatch.lastActivity = message.created_at;

        // Update topic embedding (lazy average calculation)
        // For now, we'll calculate it when needed during finalization
      }
    }

    // Add message to buffer
    buffer.messages.push({
      id: message.id,
      author_id: message.author_id,
      content: message.content,
      created_at: message.created_at,
      referenced_message_id: message.referenced_message_id,
      mentioned_user_ids: message.mentioned_user_ids,
    });
    buffer.lastActivity = message.created_at;

    // Update or create active conversation
    if (hasDirectSignal) {
      // Find or create conversation for this interaction
      let activeConv: ActiveConversation | undefined = buffer.activeConversations.find(
        (conv) => {
          // Check if this message connects to this conversation
          if (message.referenced_message_id) {
            return conv.messageIds.has(message.referenced_message_id);
          }
          if (message.mentioned_user_ids) {
            return message.mentioned_user_ids.some((id) =>
              conv.participants.has(id)
            );
          }
          return false;
        }
      );

      if (!activeConv) {
        // Create new active conversation
        activeConv = {
          participants: new Set([message.author_id]),
          messageIds: new Set([message.id]),
          lastActivity: message.created_at,
        };
        if (message.mentioned_user_ids) {
          message.mentioned_user_ids.forEach((id) =>
            activeConv!.participants.add(id)
          );
        }
        if (message.referenced_message_id) {
          activeConv.messageIds.add(message.referenced_message_id);
        }
        buffer.activeConversations.push(activeConv);
      } else {
        // Update existing conversation
        activeConv.participants.add(message.author_id);
        activeConv.messageIds.add(message.id);
        activeConv.lastActivity = message.created_at;
        if (message.mentioned_user_ids) {
          message.mentioned_user_ids.forEach((id) =>
            activeConv!.participants.add(id)
          );
        }
      }
    }

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
   * Enhanced with relationship affinity weighting
   */
  private async groupByReplyChainsAndMentions(
    messages: Array<{
      id: string;
      author_id: string;
      content: string;
      created_at: Date;
      referenced_message_id?: string;
      mentioned_user_ids?: string[];
      embedding?: number[];
    }>,
    guildId: string
  ): Promise<Array<{ messages: typeof messages }>> {
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

    // Merge groups that share participants or messages
    // This ensures multi-participant conversations are unified early
    for (let i = 0; i < allGroups.length; i++) {
      for (let j = i + 1; j < allGroups.length; j++) {
        const groupA = allGroups[i];
        const groupB = allGroups[j];
        if (!groupA || !groupB) continue;

        // Check if groups share messages (strongest signal - always merge)
        const sharesMessages = Array.from(groupA).some((id) => groupB.has(id));
        if (sharesMessages) {
          groupB.forEach((id) => groupA.add(id));
          allGroups.splice(j, 1);
          j--; // Adjust index after removal
          continue;
        }

        // Get participants for each group
        const participantsA = new Set(
          Array.from(groupA)
            .map((id) => messageMap.get(id))
            .filter(Boolean)
            .map((m) => m!.author_id)
        );
        const participantsB = new Set(
          Array.from(groupB)
            .map((id) => messageMap.get(id))
            .filter(Boolean)
            .map((m) => m!.author_id)
        );

        // Check if groups share participants (merge to create multi-participant conversations)
        const sharesParticipants = Array.from(participantsA).some((p) =>
          participantsB.has(p)
        );

        if (sharesParticipants) {
          // Also check time overlap to avoid merging unrelated conversations
          const messagesA = Array.from(groupA)
            .map((id) => messageMap.get(id))
            .filter(Boolean);
          const messagesB = Array.from(groupB)
            .map((id) => messageMap.get(id))
            .filter(Boolean);

          if (messagesA.length > 0 && messagesB.length > 0) {
            const timeA = {
              min: Math.min(...messagesA.map((m) => m!.created_at.getTime())),
              max: Math.max(...messagesA.map((m) => m!.created_at.getTime())),
            };
            const timeB = {
              min: Math.min(...messagesB.map((m) => m!.created_at.getTime())),
              max: Math.max(...messagesB.map((m) => m!.created_at.getTime())),
            };

            // Allow 15 minute gap for overlapping participants
            const timeGap = 15 * 60 * 1000;
            const timeOverlap =
              timeA.max >= timeB.min - timeGap &&
              timeA.min <= timeB.max + timeGap;

            if (timeOverlap) {
              groupB.forEach((id) => groupA.add(id));
              allGroups.splice(j, 1);
              j--; // Adjust index after removal
              continue;
            }
          }
        }

        // Also check relationship strength for additional merging
        let maxRelationshipScore = 0;
        for (const participantA of participantsA) {
          for (const participantB of participantsB) {
            if (participantA === participantB) continue;
            const relationshipScore = await this.getRelationshipScore(
              participantA,
              new Set([participantB]),
              guildId
            );
            maxRelationshipScore = Math.max(maxRelationshipScore, relationshipScore);
          }
        }

        // If relationship score is high (>0.3), merge the groups
        if (maxRelationshipScore > 0.3) {
          groupB.forEach((id) => groupA.add(id));
          allGroups.splice(j, 1);
          j--; // Adjust index after removal
        }
      }
    }

    // Add unconnected messages that don't have replies/mentions
    // Only if they're part of an ongoing conversation (within 5 minutes AND author is already a participant)
    const unprocessedMessages = messages.filter(
      (m) => !processedMessages.has(m.id)
    );
    const TIME_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

    // Score unprocessed messages against existing groups
    // Use relationship + semantic + time scoring (same as real-time routing)
    for (const msg of unprocessedMessages) {
      let bestScore = 0;
      let bestGroup: Set<string> | null = null;

      for (const group of allGroups) {
        const groupMessages = Array.from(group)
          .map((id) => messageMap.get(id))
          .filter(Boolean);

        if (groupMessages.length === 0) continue;

        // Get participants of this conversation group
        const groupParticipants = new Set(
          groupMessages.map((m) => m!.author_id)
        );

        // Relationship score (0-1)
        const relationshipScore = await this.getRelationshipScore(
          msg.author_id,
          groupParticipants,
          guildId
        );

        // Semantic score (0-1): Cosine similarity if embeddings exist
        let semanticScore = 0;
        if (msg.embedding) {
          // Calculate average embedding for the group
          const groupEmbeddings = groupMessages
            .map((m) => m!.embedding)
            .filter((emb): emb is number[] => emb !== undefined);
          if (groupEmbeddings.length > 0) {
            const avgEmbedding = new Array(msg.embedding.length).fill(0);
            for (const emb of groupEmbeddings) {
              for (let i = 0; i < emb.length && i < avgEmbedding.length; i++) {
                avgEmbedding[i] += emb[i];
              }
            }
            for (let i = 0; i < avgEmbedding.length; i++) {
              avgEmbedding[i] /= groupEmbeddings.length;
            }

            // Cosine similarity
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            const msgEmbed = msg.embedding;
            for (let i = 0; i < msgEmbed.length && i < avgEmbedding.length; i++) {
              dotProduct += msgEmbed[i]! * avgEmbedding[i]!;
              normA += msgEmbed[i]! * msgEmbed[i]!;
              normB += avgEmbedding[i]! * avgEmbedding[i]!;
            }
            const denominator = Math.sqrt(normA) * Math.sqrt(normB);
            if (denominator > 0) {
              semanticScore = dotProduct / denominator;
              semanticScore = (semanticScore + 1) / 2; // Normalize to 0-1
            }
          }
        }

        // Time score (0-1): Within 5 minute window
        const timeRange = {
          min: Math.min(...groupMessages.map((m) => m!.created_at.getTime())),
          max: Math.max(...groupMessages.map((m) => m!.created_at.getTime())),
        };
        const msgTime = msg.created_at.getTime();
        const timeDiff = Math.min(
          Math.abs(msgTime - timeRange.min),
          Math.abs(msgTime - timeRange.max)
        );
        const timeScore =
          timeDiff <= TIME_WINDOW_MS ? 1 - timeDiff / TIME_WINDOW_MS : 0;

        // Weighted combination: relationship (0.5) + semantic (0.3) + time (0.2)
        const combinedScore =
          relationshipScore * 0.5 + semanticScore * 0.3 + timeScore * 0.2;

        if (combinedScore > bestScore) {
          bestScore = combinedScore;
          bestGroup = group;
        }
      }

      // Only add if score meets threshold (0.5)
      if (bestScore > 0.5 && bestGroup) {
        bestGroup.add(msg.id);
        processedMessages.add(msg.id);
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
   * Merge overlapping conversation groups into unified multi-participant conversations
   * Groups are merged if they:
   * 1. Share messages (same message IDs)
   * 2. Have overlapping participants AND overlapping time windows
   */
  private mergeOverlappingGroups<T extends { id: string; author_id: string; created_at: Date }>(
    groups: Array<{ messages: T[] }>
  ): Array<{ messages: T[] }> {
    if (groups.length <= 1) return groups;

    // Use iterative approach to handle transitive merges
    let currentGroups = [...groups];
    let changed = true;

    // Keep merging until no more changes occur
    while (changed) {
      changed = false;
      const newGroups: typeof currentGroups = [];
      const processed = new Set<number>();

      for (let i = 0; i < currentGroups.length; i++) {
        if (processed.has(i)) continue;

        const currentGroup = currentGroups[i];
        if (!currentGroup) continue;

        const currentMessages = new Set(currentGroup.messages.map((m) => m.id));
        const currentParticipants = new Set(
          currentGroup.messages.map((m) => m.author_id)
        );
        const currentTimeRange = {
          min: Math.min(...currentGroup.messages.map((m) => m.created_at.getTime())),
          max: Math.max(...currentGroup.messages.map((m) => m.created_at.getTime())),
        };

        // Collect all groups that should be merged with this one
        const toMerge = [currentGroup];
        processed.add(i);

        // Look for overlapping groups - iterate until no more merges found
        let foundMerge = true;
        while (foundMerge) {
          foundMerge = false;
          for (let j = 0; j < currentGroups.length; j++) {
            if (processed.has(j) || i === j) continue;

            const otherGroup = currentGroups[j];
            if (!otherGroup) continue;

            const otherMessages = new Set(otherGroup.messages.map((m) => m.id));
            const otherParticipants = new Set(
              otherGroup.messages.map((m) => m.author_id)
            );
            const otherTimeRange = {
              min: Math.min(...otherGroup.messages.map((m) => m.created_at.getTime())),
              max: Math.max(...otherGroup.messages.map((m) => m.created_at.getTime())),
            };

            // Check for overlap:
            // 1. Share messages (intersection) - strongest signal - ALWAYS merge
            const messageOverlap =
              Array.from(currentMessages).some((id) => otherMessages.has(id));

            // 2. Have overlapping participants
            const participantOverlap =
              Array.from(currentParticipants).some((p) => otherParticipants.has(p));
            
            // 3. Time window check - more lenient for participant overlap
            // If participants overlap, allow larger time gaps (15 minutes)
            // If no participant overlap, require tight time windows (5 minutes)
            const timeGap = participantOverlap
              ? 15 * 60 * 1000 // 15 minutes for overlapping participants
              : 5 * 60 * 1000;  // 5 minutes for non-overlapping participants
            const timeOverlap =
              (currentTimeRange.max >= otherTimeRange.min - timeGap &&
               currentTimeRange.min <= otherTimeRange.max + timeGap);

            // Merge if:
            // - Groups share messages (always merge)
            // - Groups share participants AND time windows overlap (even loosely)
            // - Groups are very close in time (within 5 min) even without participant overlap
            const shouldMerge = messageOverlap || 
              (participantOverlap && timeOverlap) ||
              (!participantOverlap && timeOverlap && 
               Math.abs(currentTimeRange.max - otherTimeRange.min) <= 5 * 60 * 1000 &&
               Math.abs(currentTimeRange.min - otherTimeRange.max) <= 5 * 60 * 1000);

            if (shouldMerge) {
              // Merge: combine message sets and participant sets
              toMerge.push(otherGroup);
              processed.add(j);
              foundMerge = true;
              changed = true;

              // Update current sets for next iteration
              otherMessages.forEach((id) => currentMessages.add(id));
              otherParticipants.forEach((p) => currentParticipants.add(p));
              currentTimeRange.min = Math.min(
                currentTimeRange.min,
                otherTimeRange.min
              );
              currentTimeRange.max = Math.max(
                currentTimeRange.max,
                otherTimeRange.max
              );
            }
          }
        }

        // Combine all messages from merged groups
        const mergedMessagesMap = new Map<
          string,
          (typeof groups[0]["messages"])[0]
        >();
        for (const group of toMerge) {
          for (const msg of group.messages) {
            mergedMessagesMap.set(msg.id, msg);
          }
        }

        newGroups.push({
          messages: Array.from(mergedMessagesMap.values()),
        });
      }

      currentGroups = newGroups;
    }

    return currentGroups;
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
   * Finalize a conversation segment and write to DB (thread-safe with locks)
   */
  private async finalizeSegment(bufferKey: string): Promise<void> {
    // Acquire or wait for existing lock
    if (this.finalizationLocks.has(bufferKey)) {
      await this.finalizationLocks.get(bufferKey);
      return; // Another coroutine already finalized this buffer
    }

    // Create lock promise for this buffer
    const lockPromise = this.performFinalization(bufferKey);
    this.finalizationLocks.set(bufferKey, lockPromise);

    try {
      await lockPromise;
    } finally {
      this.finalizationLocks.delete(bufferKey);
    }
  }

  /**
   * Perform the actual finalization work (called while locked)
   */
  private async performFinalization(bufferKey: string): Promise<void> {
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
    const groupedMessages = await this.groupByReplyChainsAndMentions(
      validMessages,
      buffer.guildId
    );

    if (groupedMessages.length === 0) {
      return; // No valid conversation groups found - filter out noise
    }

    // Merge overlapping groups into a single multi-participant conversation
    // Groups overlap if they share messages or have overlapping participants in the same time window
    const mergedGroups = this.mergeOverlappingGroups(groupedMessages);

    // Check for existing segments that might overlap with these messages
    // to avoid creating duplicate segments
    const messageIdsInGroups = new Set<string>();
    for (const group of mergedGroups) {
      for (const msg of group.messages) {
        messageIdsInGroups.add(msg.id);
      }
    }

    // Query for existing segments that contain any of these messages
    const existingSegmentsResult = await this.db.query(
      `
      SELECT id, message_ids, participants
      FROM conversation_segments
      WHERE guild_id = $1 AND channel_id = $2
        AND message_ids && $3::TEXT[]
    `,
      [
        buffer.guildId,
        buffer.channelId,
        Array.from(messageIdsInGroups),
      ]
    );

    const existingMessageIds = new Set<string>();
    if (existingSegmentsResult.success && existingSegmentsResult.data) {
      for (const segment of existingSegmentsResult.data) {
        if (segment.message_ids && Array.isArray(segment.message_ids)) {
          segment.message_ids.forEach((id: string) =>
            existingMessageIds.add(id)
          );
        }
      }
    }

    // Filter out messages that are already in existing segments
    const filteredMergedGroups = mergedGroups.map((group) => ({
      messages: group.messages.filter((msg) => !existingMessageIds.has(msg.id)),
    })).filter((group) => group.messages.length >= this.MIN_MESSAGES);

    if (filteredMergedGroups.length === 0) {
      return; // All messages already in segments
    }

    // Merge again after filtering to ensure groups that share remaining messages are combined
    // This prevents creating duplicate segments from groups that had overlapping messages
    const finalMergedGroups = this.mergeOverlappingGroups(filteredMergedGroups);

    // Process all merged groups (not just the largest)
    // This creates one unified multi-participant conversation instead of multiple pairwise ones
    for (const group of finalMergedGroups) {
      // Deduplicate messages within the group (in case merging combined duplicates)
      const uniqueMessages = new Map<string, typeof group.messages[0]>();
      for (const msg of group.messages) {
        if (!uniqueMessages.has(msg.id)) {
          uniqueMessages.set(msg.id, msg);
        }
      }
      const deduplicatedGroup = {
        messages: Array.from(uniqueMessages.values()),
      };

      if (deduplicatedGroup.messages.length < this.MIN_MESSAGES) {
        continue; // Skip if not enough messages after deduplication
      }
      // Fetch and include any referenced messages that aren't already in the group
      let processedGroup = await this.includeReferencedMessages(deduplicatedGroup, buffer);

      // Sort messages chronologically after adding referenced messages
      processedGroup.messages.sort(
        (a, b) => a.created_at.getTime() - b.created_at.getTime()
      );

      const participants = Array.from(
        new Set(processedGroup.messages.map((m) => m.author_id))
      )
        .filter((id) => id && id.trim().length > 0)
        .sort();

      if (participants.length < 2) {
        continue; // Need at least 2 participants
      }

      // Use the grouped messages for this segment (already sorted chronologically)
      const segmentMessages = processedGroup.messages;

      // segmentMessages is guaranteed to have at least MIN_MESSAGES items at this point
      const segmentId = `seg_${segmentMessages[0]!.id}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
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
      status: "finalized", // Segments created from finalization are finalized
    });

      // Clear finalized conversations from activeConversations
      buffer.activeConversations = buffer.activeConversations.filter(
        (conv) => !Array.from(conv.messageIds).every((id) => segmentMessages.some((m) => m.id === id))
      );

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

  /**
   * Load and restore active conversations from database on bot startup
   * Resumes streaming mode for conversations that were active before shutdown
   */
  async loadActiveConversations(guildId: string): Promise<void> {
    const result = await this.db.loadActiveConversations(guildId);
    if (!result.success || !result.data) {
      return;
    }

    let restoredCount = 0;

    // Restore each active conversation to the appropriate channel buffer
    for (const segment of result.data) {
      try {
        const bufferKey = `${guildId}:${segment.channel_id}`;
        let buffer = this.channelBuffers.get(bufferKey);

        // Create buffer if it doesn't exist
        if (!buffer) {
          buffer = {
            messages: [],
            startTime: new Date(segment.start_time),
            lastActivity: new Date(segment.last_activity_at || segment.end_time),
            guildId,
            channelId: segment.channel_id,
            activeConversations: [],
          };
          this.channelBuffers.set(bufferKey, buffer);
        }

        // Restore as active conversation
        const activeConv: ActiveConversation = {
          participants: new Set(segment.participants || []),
          messageIds: new Set(segment.message_ids || []),
          lastActivity: new Date(segment.last_activity_at || segment.end_time),
          topicEmbedding: undefined,
        };

        buffer.activeConversations.push(activeConv);
        restoredCount++;

        // Set timeout for finalization (use normal inactivity timeout)
        if (buffer.timeoutHandle) {
          clearTimeout(buffer.timeoutHandle);
        }

        buffer.timeoutHandle = setTimeout(() => {
          this.finalizeSegment(bufferKey);
        }, this.INACTIVITY_MS);
      } catch (err) {
        console.error(`🔸 Failed to restore active conversation ${segment.id}:`, err);
      }
    }

    if (restoredCount > 0) {
      console.log(
        `🔄 Restored ${restoredCount} active conversations for guild ${guildId}`
      );
    }
  }

  /**
   * Update conversation activity (for active conversations tracking)
   */
  async updateConversationActivity(
    segmentId: string,
    status: "active" | "paused" | "finalized" = "active"
  ): Promise<void> {
    await this.db.updateConversationStatus(segmentId, status);
  }

  /**
   * Get active conversations for a user (real-time)
   */
  async getActiveConversationsForUser(
    userId: string,
    guildId: string,
    limit: number = 20
  ): Promise<any[]> {
    const result = await this.db.getActiveConversationsForUser(userId, guildId, limit);
    return result.success && result.data ? result.data : [];
  }

  /**
   * Get active conversations in a channel (real-time)
   */
  async getActiveConversationsInChannel(
    channelId: string,
    guildId: string,
    limit: number = 20
  ): Promise<any[]> {
    const result = await this.db.getActiveConversationsInChannel(channelId, guildId, limit);
    return result.success && result.data ? result.data : [];
  }

  /**
   * Get conversation history for a user (paginated)
   */
  async getUserConversationHistory(
    userId: string,
    guildId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any[]> {
    const result = await this.db.getUserConversationHistory(userId, guildId, limit, offset);
    return result.success && result.data ? result.data : [];
  }

  /**
   * Cleanup stale active conversations (older than 1 hour without activity)
   */
  async cleanupStaleConversations(guildId: string): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    try {
      await this.db.query(
        `UPDATE conversation_segments
         SET status = 'finalized'
         WHERE guild_id = $1
           AND status = 'active'
           AND last_activity_at < $2`,
        [guildId, oneHourAgo]
      );
    } catch (error) {
      console.error("🔸 Failed to cleanup stale conversations:", error);
    }
  }

  /**
   * Hydrate full conversation data from segment reference
   * Useful for when you have a segment_id and need full details
   */
  async hydrateConversationSegment(
    segmentId: string
  ): Promise<DatabaseResult<any>> {
    try {
      const result = await this.db.query(
        `
        SELECT
          id,
          guild_id,
          channel_id,
          participants,
          start_time,
          end_time,
          message_ids,
          message_count,
          features,
          summary,
          status,
          created_at,
          last_activity_at
        FROM conversation_segments
        WHERE id = $1
        `,
        [segmentId]
      );

      if (!result.success || !result.data || result.data.length === 0) {
        return {
          success: false,
          error: "Conversation segment not found",
        };
      }

      return { success: true, data: result.data[0] };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Hydrate multiple conversation segments (useful for relationship data)
   */
  async hydrateConversationSegments(
    segmentIds: string[]
  ): Promise<DatabaseResult<any[]>> {
    if (segmentIds.length === 0) {
      return { success: true, data: [] };
    }

    try {
      const result = await this.db.query(
        `
        SELECT
          id,
          guild_id,
          channel_id,
          participants,
          start_time,
          end_time,
          message_ids,
          message_count,
          features,
          summary,
          status,
          created_at,
          last_activity_at
        FROM conversation_segments
        WHERE id = ANY($1::TEXT[])
        ORDER BY end_time DESC
        `,
        [segmentIds]
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      return { success: true, data: result.data || [] };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ============================================================================
  // Analytics & Metrics
  // ============================================================================

  /**
   * Get conversation metrics for a guild
   */
  async getConversationMetrics(
    guildId: string,
    daysBack: number = 7
  ): Promise<DatabaseResult<any>> {
    try {
      const sinceDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      const result = await this.db.query(
        `
        SELECT
          COUNT(*) as total_conversations,
          COUNT(DISTINCT channel_id) as channels_with_conversations,
          AVG(array_length(participants, 1)) as avg_participants,
          AVG(message_count) as avg_messages_per_conversation,
          AVG(EXTRACT(EPOCH FROM (end_time - start_time))/60) as avg_duration_minutes,
          MIN(start_time) as earliest_conversation,
          MAX(end_time) as latest_conversation,
          ROUND(SUM(message_count)::numeric)::int as total_messages_in_conversations
        FROM conversation_segments
        WHERE guild_id = $1 AND status = 'finalized' AND created_at >= $2
        `,
        [guildId, sinceDate]
      );

      if (!result.success) {
        return { success: false, error: result.error };
      }

      const metrics = result.data?.[0] || {};
      return {
        success: true,
        data: {
          time_period_days: daysBack,
          total_conversations: parseInt(metrics.total_conversations) || 0,
          channels_with_conversations: parseInt(metrics.channels_with_conversations) || 0,
          avg_participants: parseFloat(metrics.avg_participants) || 0,
          avg_messages_per_conversation: parseFloat(metrics.avg_messages_per_conversation) || 0,
          avg_duration_minutes: parseFloat(metrics.avg_duration_minutes) || 0,
          total_messages: parseInt(metrics.total_messages_in_conversations) || 0,
          earliest_conversation: metrics.earliest_conversation ? new Date(metrics.earliest_conversation) : null,
          latest_conversation: metrics.latest_conversation ? new Date(metrics.latest_conversation) : null,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get top conversation participant pairs
   */
  async getTopConversationPairs(
    guildId: string,
    limit: number = 20
  ): Promise<DatabaseResult<any[]>> {
    try {
      const result = await this.db.query(
        `
        WITH pair_stats AS (
          SELECT
            array_agg(DISTINCT participant) as participants,
            COUNT(*) as conversation_count,
            SUM(message_count) as total_messages,
            AVG(array_length(participants, 1)) as avg_segment_size,
            MAX(end_time) as last_conversation
          FROM (
            SELECT DISTINCT ON (cs.id)
              UNNEST(cs.participants) as participant,
              cs.id,
              cs.message_count,
              cs.participants,
              cs.end_time
            FROM conversation_segments cs
            WHERE cs.guild_id = $1 AND cs.status = 'finalized'
          ) t
          GROUP BY (SELECT ARRAY_AGG(p) FROM UNNEST(participants) p ORDER BY p)
          HAVING array_length(ARRAY_AGG(DISTINCT participant), 1) >= 2
        )
        SELECT
          participants,
          conversation_count,
          total_messages,
          avg_segment_size,
          last_conversation
        FROM pair_stats
        ORDER BY conversation_count DESC, total_messages DESC
        LIMIT $2
        `,
        [guildId, limit]
      );

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, data: result.data || [] };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get conversation frequency for a user
   */
  async getUserConversationFrequency(
    userId: string,
    guildId: string,
    daysBack: number = 30
  ): Promise<DatabaseResult<any>> {
    try {
      const sinceDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      const result = await this.db.query(
        `
        SELECT
          COUNT(*) as total_conversations,
          COUNT(DISTINCT channel_id) as channels_participated_in,
          AVG(array_length(participants, 1)) as avg_conversation_size,
          AVG(message_count) as avg_messages_per_conversation,
          SUM(message_count) as total_messages,
          STRING_AGG(DISTINCT participant, ',') as frequent_partners
        FROM (
          SELECT
            cs.id,
            cs.channel_id,
            cs.participants,
            cs.message_count,
            UNNEST(cs.participants) as participant
          FROM conversation_segments cs
          WHERE cs.guild_id = $1
            AND cs.status = 'finalized'
            AND cs.created_at >= $2
        ) t
        WHERE participant = $3
        `,
        [guildId, sinceDate, userId]
      );

      if (!result.success) {
        return { success: false, error: result.error };
      }

      const data = result.data?.[0] || {};
      return {
        success: true,
        data: {
          user_id: userId,
          time_period_days: daysBack,
          total_conversations: parseInt(data.total_conversations) || 0,
          channels_participated_in: parseInt(data.channels_participated_in) || 0,
          avg_conversation_size: parseFloat(data.avg_conversation_size) || 0,
          avg_messages_per_conversation: parseFloat(data.avg_messages_per_conversation) || 0,
          total_messages: parseInt(data.total_messages) || 0,
          frequent_partners: data.frequent_partners ? data.frequent_partners.split(',') : [],
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ============================================================================
  // Semantic Merging - Auto-combine related conversations
  // ============================================================================

  /**
   * Calculate semantic similarity between two conversation summaries
   * Simplified heuristic: overlap of keywords and similar participant sets
   */
  private calculateSummarySimilarity(
    summary1: string,
    summary2: string,
    participants1: string[],
    participants2: string[]
  ): number {
    if (!summary1 || !summary2) return 0;

    // Extract keywords (simple word-level overlap)
    const words1 = new Set(summary1.toLowerCase().split(/\W+/));
    const words2 = new Set(summary2.toLowerCase().split(/\W+/));

    const commonWords = Array.from(words1).filter((w) => words2.has(w)).length;
    const totalWords = Math.max(words1.size, words2.size);
    const wordSimilarity = totalWords > 0 ? commonWords / totalWords : 0;

    // Participant overlap score
    const p1Set = new Set(participants1);
    const p2Set = new Set(participants2);
    const commonParticipants = Array.from(p1Set).filter((p) => p2Set.has(p)).length;
    const totalParticipants = new Set([...participants1, ...participants2]).size;
    const participantSimilarity =
      totalParticipants > 0 ? commonParticipants / totalParticipants : 0;

    // Weighted average (60% text, 40% participants)
    return wordSimilarity * 0.6 + participantSimilarity * 0.4;
  }

  /**
   * Find and merge semantically similar conversations
   * Merges conversations in the same channel with similar summaries and overlapping participants
   */
  async mergeSimilarConversations(
    guildId: string,
    channelId: string,
    similarityThreshold: number = 0.75,
    timeGapMinutes: number = 30
  ): Promise<DatabaseResult<{ merged_count: number }>> {
    try {
      // Get all finalized conversations in the channel
      const result = await this.db.query(
        `
        SELECT
          id,
          participants,
          summary,
          start_time,
          end_time,
          message_ids,
          message_count
        FROM conversation_segments
        WHERE guild_id = $1
          AND channel_id = $2
          AND status = 'finalized'
        ORDER BY end_time DESC
        `,
        [guildId, channelId]
      );

      if (!result.success || !result.data || result.data.length < 2) {
        return { success: true, data: { merged_count: 0 } };
      }

      const segments = result.data;
      const mergedSet = new Set<string>();
      let mergeCount = 0;

      // Compare adjacent and nearby segments
      for (let i = 0; i < segments.length; i++) {
        if (mergedSet.has(segments[i].id)) continue;

        const current = segments[i];
        const currentEnd = new Date(current.end_time);

        // Look ahead for similar segments within time window
        for (let j = i + 1; j < segments.length; j++) {
          if (mergedSet.has(segments[j].id)) continue;

          const candidate = segments[j];
          const candidateStart = new Date(candidate.start_time);
          const timeDiffMinutes = (currentEnd.getTime() - candidateStart.getTime()) / (1000 * 60);

          // Only merge if within time window
          if (timeDiffMinutes > timeGapMinutes) break;

          // Calculate similarity
          const similarity = this.calculateSummarySimilarity(
            current.summary,
            candidate.summary,
            current.participants,
            candidate.participants
          );

          // Merge if similar enough
          if (similarity >= similarityThreshold) {
            await this.mergeConversationSegments(current.id, candidate.id);
            mergedSet.add(candidate.id);
            mergeCount++;
          }
        }
      }

      return { success: true, data: { merged_count: mergeCount } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Merge two conversation segments into one
   */
  private async mergeConversationSegments(
    primarySegmentId: string,
    secondarySegmentId: string
  ): Promise<void> {
    try {
      // Get both segments
      const [primary, secondary] = await Promise.all([
        this.hydrateConversationSegment(primarySegmentId),
        this.hydrateConversationSegment(secondarySegmentId),
      ]);

      if (!primary.success || !secondary.success) {
        throw new Error("Failed to hydrate segments for merging");
      }

      const seg1 = primary.data;
      const seg2 = secondary.data;

      // Merge data
      const mergedParticipants = Array.from(
        new Set([...(seg1.participants || []), ...(seg2.participants || [])])
      ).sort();

      const mergedMessageIds = Array.from(
        new Set([...(seg1.message_ids || []), ...(seg2.message_ids || [])])
      );

      const mergedStartTime = new Date(
        Math.min(
          new Date(seg1.start_time).getTime(),
          new Date(seg2.start_time).getTime()
        )
      );

      const mergedEndTime = new Date(
        Math.max(
          new Date(seg1.end_time).getTime(),
          new Date(seg2.end_time).getTime()
        )
      );

      const mergedMessageCount = (seg1.message_count || 0) + (seg2.message_count || 0);

      // Merge features
      const mergedFeatures = {
        mention_count: ((seg1.features?.mention_count || 0) + (seg2.features?.mention_count || 0)),
        reply_count: ((seg1.features?.reply_count || 0) + (seg2.features?.reply_count || 0)),
        merged_from: [seg1.id, seg2.id],
      };

      // Update primary segment with merged data
      await this.db.query(
        `
        UPDATE conversation_segments
        SET
          participants = $1,
          message_ids = $2,
          start_time = $3,
          end_time = $4,
          message_count = $5,
          features = $6,
          summary = 'Merged conversation: ' || summary
        WHERE id = $7
        `,
        [mergedParticipants, mergedMessageIds, mergedStartTime, mergedEndTime, mergedMessageCount, JSON.stringify(mergedFeatures), primarySegmentId]
      );

      // Delete secondary segment
      await this.db.query(
        `DELETE FROM conversation_segments WHERE id = $1`,
        [secondarySegmentId]
      );
    } catch (error) {
      console.error(`🔸 Failed to merge conversation segments:`, error);
    }
  }

  /**
   * Run semantic merging for all channels in a guild (background task)
   */
  async runSemanticMergingForGuild(guildId: string): Promise<void> {
    try {
      // Get all channels with conversations
      const channelsResult = await this.db.query(
        `
        SELECT DISTINCT channel_id
        FROM conversation_segments
        WHERE guild_id = $1 AND status = 'finalized'
        `,
        [guildId]
      );

      if (!channelsResult.success || !channelsResult.data) {
        return;
      }

      let totalMerged = 0;

      for (const row of channelsResult.data) {
        const mergeResult = await this.mergeSimilarConversations(guildId, row.channel_id);
        if (mergeResult.success) {
          totalMerged += mergeResult.data?.merged_count || 0;
        }
      }

      if (totalMerged > 0) {
        console.log(`🔄 Semantic merging: merged ${totalMerged} conversation pairs in guild ${guildId}`);
      }
    } catch (error) {
      console.error("🔸 Failed to run semantic merging:", error);
    }
  }
}
