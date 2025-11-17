import {
  type DatabaseTool,
  type ToolContext,
  type DatabaseToolResult,
  formatConversation,
} from "../DatabaseTools";
import type { ConversationEntry } from "../../social-intelligence/types";
import { ConversationDetector } from "../../social-intelligence/conversation-detection/ConversationDetector";
import { pgvector, type RelationshipEntry } from "../../../database/PostgreSQLManager.js";
import { EmbeddingService } from "../../social-intelligence/semantic-analysis/EmbeddingService.js";

/**
 * Get conversations between two users
 */
export const getConversationsBetweenTool: DatabaseTool = {
  name: "getConversationsBetween",
  description:
    "Get conversation entries between two users including metadata like duration, message count, and interaction types. Use this to understand how users interact.",
  parameters: {
    type: "object",
    properties: {
      user1Id: {
        type: "string",
        description: "First user's Discord ID",
      },
      user2Id: {
        type: "string",
        description: "Second user's Discord ID",
      },
      limit: {
        type: "number",
        description: "Maximum number of conversations to return (default: 10)",
      },
    },
    required: ["user1Id", "user2Id"],
  },
  execute: async (
    params: Record<string, any>,
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    const { user1Id, user2Id, limit } = params as { user1Id: string; user2Id: string; limit?: number };
    try {
      const conversationManager = new ConversationDetector(context.db);
      const result = await conversationManager.detectConversations(
        user1Id,
        user2Id,
        context.guildId,
        5
      );

      if (!result.success || !result.data) {
        return {
          success: false,
          error: `Failed to get conversations: ${result.error}`,
        };
      }

      let conversations = result.data;
      if (limit) {
        conversations = conversations.slice(0, limit);
      }

      // Sort by most recent
      conversations = conversations.sort(
        (a, b) =>
          new Date(b.end_time).getTime() - new Date(a.end_time).getTime()
      );

      const formatted = conversations.map(formatConversation).join("\n\n");

      const totalMessages = conversations.reduce(
        (sum, conv) => sum + conv.message_count,
        0
      );
      const totalDuration = conversations.reduce(
        (sum, conv) => sum + (conv.duration_minutes || 0),
        0
      );

      return {
        success: true,
        summary: `Found ${conversations.length} conversation(s) with ${totalMessages} total messages`,
        data: {
          formatted,
          conversations,
          count: conversations.length,
          totalMessages,
          totalDuration,
        },
      };
    } catch (error) {
      console.error("🔸 Error in getConversationsBetween:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get conversations",
      };
    }
  },
};

/**
 * Get details for a specific conversation
 */
export const getConversationDetailsTool: DatabaseTool = {
  name: "getConversationDetails",
  description:
    "Get detailed information about a specific conversation by conversation ID. Use this when you have a conversation ID and need full details.",
  parameters: {
    type: "object",
    properties: {
      conversationId: {
        type: "string",
        description: "Conversation ID to get details for",
      },
      user1Id: {
        type: "string",
        description: "First user's Discord ID (to locate conversation)",
      },
      user2Id: {
        type: "string",
        description: "Second user's Discord ID (to locate conversation)",
      },
    },
    required: ["conversationId", "user1Id", "user2Id"],
  },
  execute: async (
    params: Record<string, any>,
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    const { conversationId, user1Id, user2Id } = params as {
      conversationId: string;
      user1Id: string;
      user2Id: string;
    };
    try {
      const conversationManager = new ConversationDetector(context.db);
      const result = await conversationManager.detectConversations(
        user1Id,
        user2Id,
        context.guildId,
        5
      );

      if (!result.success || !result.data) {
        return {
          success: false,
          error: `Failed to get conversations: ${result.error}`,
        };
      }

      const conversation = result.data.find(
        (conv) => conv.conversation_id === conversationId
      );

      if (!conversation) {
        return {
          success: false,
          error: `Conversation ${conversationId} not found`,
        };
      }

      const formatted = formatConversation(conversation);

      return {
        success: true,
        summary: `Conversation: ${conversation.message_count} messages over ${conversation.duration_minutes} minutes`,
        data: {
          formatted,
          conversation,
        },
      };
    } catch (error) {
      console.error("🔸 Error in getConversationDetails:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get conversation details",
      };
    }
  },
};

/**
 * Get user's recent conversations across all relationships
 */
export const getRecentConversationsTool: DatabaseTool = {
  name: "getRecentConversations",
  description:
    "Get a user's recent conversations across all their relationships. Use this to understand who someone has been talking to recently.",
  parameters: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        description: "Discord user ID to get recent conversations for",
      },
      limit: {
        type: "number",
        description: "Maximum number of conversations to return (default: 10)",
      },
    },
    required: ["userId"],
  },
  execute: async (
    params: Record<string, any>,
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    const { userId, limit } = params as { userId: string; limit?: number };
    try {
      // Get user's relationship network
      const networkResult = await context.db.getMemberRelationshipNetwork(
        userId,
        context.guildId
      );

      if (!networkResult.success || !networkResult.data) {
        return {
          success: false,
          error: `Failed to get relationship network: ${networkResult.error}`,
        };
      }

      // Collect all conversations from relationships
      const allConversations: Array<{
        conversation: ConversationEntry;
        otherUserId: string;
        relationship: RelationshipEntry;
      }> = [];

      for (const rel of networkResult.data) {
        if (rel.conversations && rel.conversations.length > 0) {
          for (const conv of rel.conversations) {
            allConversations.push({
              conversation: conv,
              otherUserId: rel.user_id,
              relationship: rel,
            });
          }
        }
      }

      // Sort by most recent
      allConversations.sort(
        (a, b) =>
          new Date(b.conversation.end_time).getTime() -
          new Date(a.conversation.end_time).getTime()
      );

      // Get display names
      const userIds = [
        ...new Set(allConversations.map((c) => c.otherUserId)),
      ].slice(0, limit || 10);

      const namesResult = await context.db.query(
        `SELECT user_id, display_name, username 
         FROM members 
         WHERE user_id = ANY($1::text[]) AND guild_id = $2 AND active = true`,
        [userIds, context.guildId]
      );

      const nameMap = new Map();
      if (namesResult.success && namesResult.data) {
        for (const member of namesResult.data) {
          nameMap.set(member.user_id, member);
        }
      }

      // Format conversations
      const limited = allConversations.slice(0, limit || 10);
      const formatted = limited
        .map((item, idx) => {
          const member = nameMap.get(item.otherUserId);
          const name = member?.display_name || item.otherUserId;
          const conv = item.conversation;
          return `${idx + 1}. With ${name} (${conv.conversation_id}):\n   ${
            conv.message_count
          } messages, ${conv.duration_minutes} min, ${new Date(
            conv.end_time
          ).toLocaleDateString()}`;
        })
        .join("\n\n");

      return {
        success: true,
        summary: `Found ${limited.length} recent conversation(s)`,
        data: {
          formatted,
          conversations: limited,
          count: limited.length,
        },
      };
    } catch (error) {
      console.error("🔸 Error in getRecentConversations:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get recent conversations",
      };
    }
  },
};

/**
 * Get actual message content for a conversation
 */
export const getConversationMessagesTool: DatabaseTool = {
  name: "getConversationMessages",
  description:
    "Get the actual message content from a conversation. Use this when you need to see what was said in a conversation.",
  parameters: {
    type: "object",
    properties: {
      conversationId: {
        type: "string",
        description: "Conversation ID to get messages for",
      },
      user1Id: {
        type: "string",
        description: "First user's Discord ID",
      },
      user2Id: {
        type: "string",
        description: "Second user's Discord ID",
      },
      limit: {
        type: "number",
        description: "Maximum number of messages to return (default: 50)",
      },
    },
    required: ["conversationId", "user1Id", "user2Id"],
  },
  execute: async (
    params: Record<string, any>,
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    const { conversationId, user1Id, user2Id, limit } = params as {
      conversationId: string;
      user1Id: string;
      user2Id: string;
      limit?: number;
    };
    try {
      // First get the conversation to find message IDs
      const conversationManager = new ConversationDetector(context.db);
      const convResult = await conversationManager.detectConversations(
        user1Id,
        user2Id,
        context.guildId,
        5
      );

      if (!convResult.success || !convResult.data) {
        return {
          success: false,
          error: `Failed to get conversation: ${convResult.error}`,
        };
      }

      const conversation = convResult.data.find(
        (conv) => conv.conversation_id === conversationId
      );

      if (!conversation) {
        return {
          success: false,
          error: `Conversation ${conversationId} not found`,
        };
      }

      // Get messages by IDs
      const messageIds = conversation.message_ids?.slice(0, limit || 50) || [];

      if (messageIds.length === 0) {
        return {
          success: true,
          summary: "No messages in this conversation",
          data: {
            formatted: "No messages found",
            messages: [],
          },
        };
      }

      const messagesResult = await context.db.query(
        `SELECT id, author_id, content, created_at, edited_at
         FROM messages 
         WHERE id = ANY($1::text[]) AND guild_id = $2 AND active = true
         ORDER BY created_at ASC`,
        [messageIds, context.guildId]
      );

      if (!messagesResult.success || !messagesResult.data) {
        return {
          success: false,
          error: "Failed to get messages",
        };
      }

      // Get user display names
      const userIds = [...new Set([user1Id, user2Id])];
      const namesResult = await context.db.query(
        `SELECT user_id, display_name, username 
         FROM members 
         WHERE user_id = ANY($1::text[]) AND guild_id = $2 AND active = true`,
        [userIds, context.guildId]
      );

      const nameMap = new Map();
      if (namesResult.success && namesResult.data) {
        for (const member of namesResult.data) {
          nameMap.set(member.user_id, member.display_name || member.username);
        }
      }

      const formatted = messagesResult.data
        .map((msg: any) => {
          const authorName = nameMap.get(msg.author_id) || msg.author_id;
          const timestamp = new Date(msg.created_at).toLocaleTimeString();
          return `[${timestamp}] ${authorName}: ${
            msg.content || "(no content)"
          }`;
        })
        .join("\n");

      return {
        success: true,
        summary: `Retrieved ${messagesResult.data.length} message(s) from conversation`,
        data: {
          formatted,
          messages: messagesResult.data,
          count: messagesResult.data.length,
        },
      };
    } catch (error) {
      console.error("🔸 Error in getConversationMessages:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get conversation messages",
      };
    }
  },
};

/**
 * Analyze conversation patterns between users
 */
export const analyzeConversationPatternsTool: DatabaseTool = {
  name: "analyzeConversationPatterns",
  description:
    "Analyze conversation patterns including frequency, duration, time of day, and interaction types. Use this for detailed insights about how two users interact.",
  parameters: {
    type: "object",
    properties: {
      user1Id: {
        type: "string",
        description: "First user's Discord ID",
      },
      user2Id: {
        type: "string",
        description: "Second user's Discord ID",
      },
    },
    required: ["user1Id", "user2Id"],
  },
  execute: async (
    params: Record<string, any>,
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    const { user1Id, user2Id } = params as { user1Id: string; user2Id: string };
    try {
      const conversationManager = new ConversationDetector(context.db);
      const result = await conversationManager.detectConversations(
        user1Id,
        user2Id,
        context.guildId,
        5
      );

      if (!result.success || !result.data) {
        return {
          success: false,
          error: `Failed to get conversations: ${result.error}`,
        };
      }

      const conversations = result.data;

      if (conversations.length === 0) {
        return {
          success: true,
          summary: "No conversations found to analyze",
          data: {
            formatted: "No conversation patterns detected",
            patterns: {},
          },
        };
      }

      // Calculate patterns
      const totalConversations = conversations.length;
      const totalMessages = conversations.reduce(
        (sum, conv) => sum + conv.message_count,
        0
      );
      const avgDuration =
        conversations.reduce((sum, conv) => sum + (conv.duration_minutes || 0), 0) /
        totalConversations;
      const totalDuration = conversations.reduce(
        (sum, conv) => sum + (conv.duration_minutes || 0),
        0
      );

      // Time of day analysis
      const hourCounts = new Map<number, number>();
      conversations.forEach((conv) => {
        const hour = new Date(conv.start_time).getHours();
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      });
      const peakHour = Array.from(hourCounts.entries()).sort(
        (a, b) => b[1] - a[1]
      )[0]?.[0];

      // Interaction types
      const interactionTypes = new Set<string>();
      conversations.forEach((conv) => {
        if (conv.interaction_types) {
          conv.interaction_types.forEach((type) => interactionTypes.add(type));
        }
      });

      // Date range
      const sortedByTime = [...conversations].sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );
      const firstConversation = sortedByTime[0];
      const lastConversation = sortedByTime[sortedByTime.length - 1];
      const dateRange = firstConversation && lastConversation
        ? new Date(firstConversation.start_time).toLocaleDateString() +
          " to " +
          new Date(lastConversation.end_time).toLocaleDateString()
        : "Unknown";

      const parts: string[] = [];
      parts.push(`Conversation Pattern Analysis:`);
      parts.push(`  - Total Conversations: ${totalConversations}`);
      parts.push(`  - Total Messages: ${totalMessages}`);
      parts.push(`  - Average Duration: ${avgDuration.toFixed(1)} minutes`);
      parts.push(
        `  - Total Conversation Time: ${totalDuration.toFixed(1)} minutes`
      );
      parts.push(`  - Date Range: ${dateRange}`);

      if (peakHour !== undefined) {
        parts.push(`  - Most Active Hour: ${peakHour}:00`);
      }

      if (interactionTypes.size > 0) {
        parts.push(
          `  - Interaction Types: ${Array.from(interactionTypes).join(", ")}`
        );
      }

      const hasNameUsage = conversations.some((conv) => conv.has_name_usage);
      parts.push(`  - Direct Name Usage: ${hasNameUsage ? "Yes" : "No"}`);

      return {
        success: true,
        summary: `${totalConversations} conversations, ${totalMessages} messages, avg ${avgDuration.toFixed(
          1
        )} min`,
        data: {
          formatted: parts.join("\n"),
          patterns: {
            totalConversations,
            totalMessages,
            avgDuration,
            totalDuration,
            peakHour,
            interactionTypes: Array.from(interactionTypes),
            hasNameUsage,
            dateRange,
          },
        },
      };
    } catch (error) {
      console.error("🔸 Error in analyzeConversationPatterns:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to analyze conversation patterns",
      };
    }
  },
};

/**
 * Search conversations using semantic similarity and programmatic filters
 * Hybrid approach: embeddings for semantic meaning + SQL for identity/structure
 */
export const searchConversationsSemanticTool: DatabaseTool = {
  name: "searchConversationsSemantic",
  description:
    "Search for conversations using semantic similarity (what was discussed) combined with optional filters (who, where, when). Perfect for queries like 'remember when alex converted a server', 'what did people discuss in guy-chat', 'conversations about politics'. Uses AI embeddings to understand meaning, not just keywords.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What to search for (e.g., 'converting a server', 'politics discussion', 'funny moments'). User names will be automatically extracted as filters.",
      },
      userIds: {
        type: "string",
        description:
          "Optional: Comma-separated user IDs to filter by participants (e.g., '123,456'). Leave empty to search all conversations.",
      },
      channelIds: {
        type: "string",
        description:
          "Optional: Comma-separated channel IDs to filter by channel. Leave empty to search all channels.",
      },
      lookbackDays: {
        type: "number",
        description:
          "Optional: Only search conversations from the last N days (default: 30 days)",
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default: 5, max: 20)",
      },
    },
    required: ["query"],
  },
  execute: async (
    params: Record<string, any>,
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      const query = String(params.query);
      const limit = Math.min(params.limit || 5, 20);
      const lookbackDays = params.lookbackDays || 30;

      // Parse user IDs and channel IDs
      const userIds = params.userIds
        ? String(params.userIds)
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        : [];
      const channelIds = params.channelIds
        ? String(params.channelIds)
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        : [];

      // Generate embedding for the query
      let queryEmbedding: number[] | null = null;
      try {
        const embeddingService = EmbeddingService.getInstance();
        queryEmbedding = await embeddingService.generateEmbedding(query);
      } catch (error) {
        console.warn("⚠️  Failed to generate query embedding:", error);
        // Fall back to keyword search if embedding fails
      }

      // Build SQL query with programmatic filters
      let whereConditions = ["cs.guild_id = $1", "cs.status = 'finalized'"];
      const queryParams: any[] = [context.guildId];
      let paramIndex = 2;

      // Add embedding condition if available
      if (queryEmbedding) {
        whereConditions.push("cs.embedding IS NOT NULL");
      }

      // Filter by participants
      if (userIds.length > 0) {
        whereConditions.push(`cs.participants && $${paramIndex}::text[]`);
        queryParams.push(userIds);
        paramIndex++;
      }

      // Filter by channels
      if (channelIds.length > 0) {
        whereConditions.push(`cs.channel_id = ANY($${paramIndex}::text[])`);
        queryParams.push(channelIds);
        paramIndex++;
      }

      // Filter by time
      const lookbackTime = new Date(
        Date.now() - lookbackDays * 24 * 60 * 60 * 1000
      );
      whereConditions.push(`cs.start_time >= $${paramIndex}`);
      queryParams.push(lookbackTime);
      paramIndex++;

      // Build the main query
      let orderByClause: string;
      if (queryEmbedding) {
        // Use vector similarity if embedding is available
        // Convert to pgvector format using toSql()
        queryParams.push(pgvector.toSql(queryEmbedding));
        orderByClause = `(cs.embedding <=> $${paramIndex}::vector) ASC`;
        paramIndex++;
      } else {
        // Fallback to recency if no embedding
        orderByClause = "cs.start_time DESC";
      }

      const result = await context.db.query(
        `
        SELECT
          cs.id,
          cs.channel_id,
          cs.participants,
          cs.start_time,
          cs.end_time,
          cs.message_count,
          cs.summary,
          cs.features,
          c.name as channel_name,
          ${queryEmbedding ? `(cs.embedding <=> $${paramIndex - 1}::vector) as similarity_score` : "0 as similarity_score"}
        FROM conversation_segments cs
        LEFT JOIN channels c ON cs.channel_id = c.id
        WHERE ${whereConditions.join(" AND ")}
        ORDER BY ${orderByClause}
        LIMIT $${paramIndex}
        `,
        [...queryParams, limit]
      );

      if (!result.success || !result.data || result.data.length === 0) {
        return {
          success: true,
          summary: "No conversations found matching your query",
          data: {
            formatted: "No matching conversations found",
            conversations: [],
            count: 0,
          },
        };
      }

      const conversations = result.data;

      // Get participant display names
      const allParticipantIds = [
        ...new Set(conversations.flatMap((c: any) => c.participants || [])),
      ];

      const namesResult = await context.db.query(
        `SELECT user_id, display_name, username
         FROM members
         WHERE user_id = ANY($1::text[]) AND guild_id = $2 AND active = true`,
        [allParticipantIds, context.guildId]
      );

      const nameMap = new Map();
      if (namesResult.success && namesResult.data) {
        for (const member of namesResult.data) {
          nameMap.set(member.user_id, member.display_name || member.username);
        }
      }

      // Format results
      const formatted = conversations
        .map((conv: any, idx: number) => {
          const participantNames = (conv.participants || [])
            .map((id: string) => nameMap.get(id) || id)
            .join(", ");
          const date = new Date(conv.start_time).toLocaleDateString();
          const time = new Date(conv.start_time).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          const summary = conv.summary || "(no summary)";
          const simScore = queryEmbedding
            ? `(similarity: ${(1 - conv.similarity_score).toFixed(2)})`
            : "";

          return `${idx + 1}. [#${conv.channel_name || "unknown"}] ${date} ${time} ${simScore}
   Participants: ${participantNames}
   Summary: ${summary}
   ${conv.message_count} messages`;
        })
        .join("\n\n");

      return {
        success: true,
        summary: `Found ${conversations.length} conversation(s) matching "${query}"`,
        data: {
          formatted,
          conversations,
          count: conversations.length,
          usedEmbedding: !!queryEmbedding,
        },
      };
    } catch (error) {
      console.error("🔸 Error in searchConversationsSemantic:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to search conversations",
      };
    }
  },
};

/**
 * Export all conversation tools for registration
 */
export const conversationTools: DatabaseTool[] = [
  getConversationsBetweenTool,
  getConversationDetailsTool,
  getRecentConversationsTool,
  getConversationMessagesTool,
  analyzeConversationPatternsTool,
  searchConversationsSemanticTool,
];
