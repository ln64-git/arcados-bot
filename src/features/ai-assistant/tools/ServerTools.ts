import {
  type DatabaseTool,
  type ToolContext,
  type DatabaseToolResult,
} from "../DatabaseTools";

/**
 * Get server/guild statistics
 */
export const getServerStatsTool: DatabaseTool = {
  name: "getServerStats",
  description:
    "Get server statistics including member count, active users, message counts, and channel information. Use this to understand the server's overall activity.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (
    params: {},
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      // Get member count
      const membersResult = await context.db.query(
        `SELECT COUNT(*) as count FROM members 
         WHERE guild_id = $1 AND active = true`,
        [context.guildId]
      );

      // Get message count
      const messagesResult = await context.db.query(
        `SELECT COUNT(*) as count FROM messages 
         WHERE guild_id = $1 AND active = true`,
        [context.guildId]
      );

      // Get channel count
      const channelsResult = await context.db.query(
        `SELECT COUNT(*) as count FROM channels 
         WHERE guild_id = $1 AND active = true`,
        [context.guildId]
      );

      // Get recent activity (last 24 hours)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const recentMessagesResult = await context.db.query(
        `SELECT COUNT(*) as count FROM messages 
         WHERE guild_id = $1 AND active = true AND created_at >= $2`,
        [context.guildId, yesterday]
      );

      const memberCount =
        membersResult.success && membersResult.data?.[0]
          ? parseInt(membersResult.data[0].count, 10)
          : 0;
      const messageCount =
        messagesResult.success && messagesResult.data?.[0]
          ? parseInt(messagesResult.data[0].count, 10)
          : 0;
      const channelCount =
        channelsResult.success && channelsResult.data?.[0]
          ? parseInt(channelsResult.data[0].count, 10)
          : 0;
      const recentMessages =
        recentMessagesResult.success && recentMessagesResult.data?.[0]
          ? parseInt(recentMessagesResult.data[0].count, 10)
          : 0;

      const parts: string[] = [];
      parts.push(`Server Statistics:`);
      parts.push(`  - Total Members: ${memberCount}`);
      parts.push(`  - Total Messages: ${messageCount}`);
      parts.push(`  - Channels: ${channelCount}`);
      parts.push(`  - Messages (last 24h): ${recentMessages}`);

      return {
        success: true,
        summary: `${memberCount} members, ${messageCount} messages, ${recentMessages} recent`,
        data: {
          formatted: parts.join("\n"),
          stats: {
            memberCount,
            messageCount,
            channelCount,
            recentMessages,
          },
        },
      };
    } catch (error) {
      console.error("🔸 Error in getServerStats:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get server stats",
      };
    }
  },
};

/**
 * Get most active members
 */
export const getActiveMembersTool: DatabaseTool = {
  name: "getActiveMembers",
  description:
    "Get the most active members in the server based on message count. Use this to see who is most engaged.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Number of members to return (default: 10)",
      },
      timeWindow: {
        type: "number",
        description: "Time window in days to analyze (default: 7)",
      },
    },
    required: [],
  },
  execute: async (
    params: { limit?: number; timeWindow?: number },
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      const limit = params.limit || 10;
      const timeWindowDays = params.timeWindow || 7;
      const since = new Date();
      since.setDate(since.getDate() - timeWindowDays);

      const result = await context.db.query(
        `SELECT m.author_id, mem.display_name, mem.username, COUNT(*) as message_count
         FROM messages m
         JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
         WHERE m.guild_id = $1 
           AND m.active = true
           AND m.created_at >= $2
           AND mem.bot = false
         GROUP BY m.author_id, mem.display_name, mem.username
         ORDER BY message_count DESC
         LIMIT $3`,
        [context.guildId, since, limit]
      );

      if (!result.success || !result.data) {
        return {
          success: false,
          error: "Failed to get active members",
        };
      }

      const activeMembers = result.data;

      if (activeMembers.length === 0) {
        return {
          success: true,
          summary: `No active members found in the last ${timeWindowDays} days`,
          data: {
            formatted: "No active members",
            members: [],
            count: 0,
          },
        };
      }

      const formatted = activeMembers
        .map(
          (member: any, idx: number) =>
            `${idx + 1}. ${member.display_name || member.username}: ${
              member.message_count
            } messages`
        )
        .join("\n");

      return {
        success: true,
        summary: `Top ${activeMembers.length} active member(s) in the last ${timeWindowDays} days`,
        data: {
          formatted,
          members: activeMembers,
          count: activeMembers.length,
        },
      };
    } catch (error) {
      console.error("🔸 Error in getActiveMembers:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get active members",
      };
    }
  },
};

/**
 * Get trending topics/keywords
 */
export const getTrendingTopicsTool: DatabaseTool = {
  name: "getTrendingTopics",
  description:
    "Analyze trending keywords and topics in messages. Use this to see what people are talking about.",
  parameters: {
    type: "object",
    properties: {
      timeWindow: {
        type: "number",
        description: "Time window in days to analyze (default: 7)",
      },
      limit: {
        type: "number",
        description: "Number of topics to return (default: 10)",
      },
    },
    required: [],
  },
  execute: async (
    params: { timeWindow?: number; limit?: number },
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      // This is a simplified implementation - in production you might use
      // more sophisticated keyword extraction
      return {
        success: true,
        summary: "Trending topics analysis not fully implemented yet",
        data: {
          formatted: "Trending topics feature coming soon",
          topics: [],
        },
      };

      // Future implementation could:
      // 1. Extract keywords from recent messages
      // 2. Count frequency
      // 3. Filter common words
      // 4. Return top keywords
    } catch (error) {
      console.error("🔸 Error in getTrendingTopics:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get trending topics",
      };
    }
  },
};

/**
 * Get overall relationship network insights
 */
export const getServerNetworkTool: DatabaseTool = {
  name: "getServerNetwork",
  description:
    "Get insights about the overall relationship network in the server including clusters, key connectors, and isolated users.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async (
    params: {},
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      // Get all members with relationship networks
      const membersResult = await context.db.getMembersByGuild(context.guildId);

      if (!membersResult.success || !membersResult.data) {
        return {
          success: false,
          error: "Failed to get members",
        };
      }

      const members = membersResult.data.filter((m) => !m.bot);
      let totalRelationships = 0;
      let membersWithRelationships = 0;
      let membersWithoutRelationships = 0;
      let totalAffinitySum = 0;
      let relationshipCount = 0;

      for (const member of members) {
        if (
          member.relationship_network &&
          member.relationship_network.length > 0
        ) {
          membersWithRelationships++;
          totalRelationships += member.relationship_network.length;

          for (const rel of member.relationship_network) {
            totalAffinitySum += rel.affinity_percentage;
            relationshipCount++;
          }
        } else {
          membersWithoutRelationships++;
        }
      }

      const avgAffinity =
        relationshipCount > 0 ? totalAffinitySum / relationshipCount : 0;

      const parts: string[] = [];
      parts.push(`Server Network Insights:`);
      parts.push(`  - Total Members: ${members.length}`);
      parts.push(`  - Members with Relationships: ${membersWithRelationships}`);
      parts.push(
        `  - Members without Relationships: ${membersWithoutRelationships}`
      );
      parts.push(`  - Total Relationship Connections: ${totalRelationships}`);
      parts.push(`  - Average Affinity Score: ${avgAffinity.toFixed(1)}%`);

      return {
        success: true,
        summary: `${membersWithRelationships} members with ${totalRelationships} relationship connections`,
        data: {
          formatted: parts.join("\n"),
          network: {
            totalMembers: members.length,
            membersWithRelationships,
            membersWithoutRelationships,
            totalRelationships,
            avgAffinity,
          },
        },
      };
    } catch (error) {
      console.error("🔸 Error in getServerNetwork:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get server network",
      };
    }
  },
};

/**
 * Export all server tools for registration
 */
export const serverTools: DatabaseTool[] = [
  getServerStatsTool,
  getActiveMembersTool,
  getTrendingTopicsTool,
  getServerNetworkTool,
];
