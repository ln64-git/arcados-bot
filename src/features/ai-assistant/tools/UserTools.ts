import {
  type DatabaseTool,
  type ToolContext,
  type DatabaseToolResult,
  formatUserInfo,
} from "../DatabaseTools";
import type { MemberData } from "../../database/PostgreSQLManager";

/**
 * Get complete user profile information
 */
export const getUserInfoTool: DatabaseTool = {
  name: "getUserInfo",
  description:
    "Get comprehensive user information including profile, summary, keywords, roles, and activity. If no userId is provided, use the requesting user (for prompts like 'who am I').",
  parameters: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        description: "Discord user ID to query",
      },
    },
    required: [],
  },
  execute: async (
    params: { userId?: string },
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      const targetUserId = params.userId || context.userId;
      const result = await context.db.query(
        `SELECT * FROM members 
         WHERE user_id = $1 AND guild_id = $2 AND active = true
         LIMIT 1`,
        [targetUserId, context.guildId]
      );

      if (!result.success || !result.data || result.data.length === 0) {
        // Try inactive members
        const fallbackResult = await context.db.query(
          `SELECT * FROM members 
           WHERE user_id = $1 AND guild_id = $2 AND active = false
           LIMIT 1`,
          [targetUserId, context.guildId]
        );

        if (
          fallbackResult.success &&
          fallbackResult.data &&
          fallbackResult.data.length > 0
        ) {
          const member = fallbackResult.data[0] as MemberData;
          const formatted = formatUserInfo(member);
          return {
            success: true,
            summary: `${member.display_name} - ${
              member.summary || "Member of this server"
            }`,
            data: { formatted, member },
          };
        }

        return {
          success: false,
          error: `User ${targetUserId} not found in this server`,
        };
      }

      const member = result.data[0] as MemberData;

      // Get role names (not just IDs)
      let roleNames: string[] = [];
      if (member.roles && member.roles.length > 0) {
        const rolesResult = await context.db.query(
          `SELECT name FROM roles 
           WHERE id = ANY($1::text[]) AND guild_id = $2 AND active = true
           ORDER BY name`,
          [member.roles, context.guildId]
        );
        if (rolesResult.success && rolesResult.data) {
          roleNames = rolesResult.data.map((r: any) => r.name);
        }
      }

      // Get message count and activity context
      const messageStatsResult = await context.db.query(
        `SELECT COUNT(*) as message_count, 
                MIN(created_at) as first_message,
                MAX(created_at) as last_message
         FROM messages 
         WHERE author_id = $1 AND guild_id = $2 AND active = true`,
        [targetUserId, context.guildId]
      );

      const messageCount =
        messageStatsResult.success && messageStatsResult.data?.[0]
          ? parseInt(messageStatsResult.data[0].message_count, 10)
          : 0;
      const firstMessage =
        messageStatsResult.success &&
        messageStatsResult.data?.[0]?.first_message
          ? new Date(messageStatsResult.data[0].first_message)
          : null;

      // Get top relationships with more context
      const network = member.relationship_network || [];
      const topRelationships = network
        .sort((a, b) => b.affinity_percentage - a.affinity_percentage)
        .slice(0, 5)
        .map(
          (r) =>
            `  - ${
              r.display_name || r.username || r.user_id
            }: ${r.affinity_percentage.toFixed(1)}% affinity, ${
              r.interaction_count
            } interactions${r.summary ? `, context: ${r.summary}` : ""}`
        )
        .join("\n");

      // Build rich context object
      const richContext = {
        displayName: member.display_name,
        username: member.username,
        globalName: member.global_name,
        summary: member.summary,
        keywords: member.keywords || [],
        emojis: member.emojis || [],
        roles: roleNames,
        roleCount: member.roles?.length || 0,
        joinedAt: new Date(member.joined_at),
        messageCount,
        firstMessageDate: firstMessage,
        active: member.active,
        relationships: topRelationships || "No relationships tracked",
        relationshipNetwork: network.slice(0, 10), // Top 10 for context
        notes: member.notes || [],
      };

      // Compute server-age-relative descriptor
      try {
        const guildResult = await context.db.query(
          `SELECT created_at FROM guilds WHERE id = $1 LIMIT 1`,
          [context.guildId]
        );
        if (guildResult.success && guildResult.data?.[0]?.created_at) {
          const guildCreatedAt = new Date(guildResult.data[0].created_at);
          const joinedAt = new Date(member.joined_at);
          const daysSinceJoin = Math.floor(
            (Date.now() - joinedAt.getTime()) / (1000 * 60 * 60 * 24)
          );
          const daysFromStart = Math.floor(
            (joinedAt.getTime() - guildCreatedAt.getTime()) /
              (1000 * 60 * 60 * 24)
          );

          let serverMembershipDescriptor = "";
          if (daysFromStart <= 14) {
            serverMembershipDescriptor = "here since the start";
          } else if (daysSinceJoin < 30) {
            serverMembershipDescriptor = "a new member";
          } else if (daysSinceJoin < 180) {
            const months = Math.max(1, Math.round(daysSinceJoin / 30));
            serverMembershipDescriptor = `here for a few months (about ${months} months)`;
          } else if (daysSinceJoin < 365) {
            const months = Math.round(daysSinceJoin / 30);
            serverMembershipDescriptor = `here for a while (about ${months} months)`;
          } else {
            const years = Math.floor(daysSinceJoin / 365);
            serverMembershipDescriptor = `around ${years} year${
              years > 1 ? "s" : ""
            }`;
          }

          (richContext as any).serverMembershipDescriptor =
            serverMembershipDescriptor;
        }
      } catch {
        // Non-fatal if guild date unavailable
      }

      const formatted = formatUserInfo(member);

      return {
        success: true,
        summary: `${member.display_name} - ${
          member.summary || "Member of this server"
        }`,
        data: {
          formatted,
          richContext, // Pass full rich context object
          relationships: topRelationships || "No relationships tracked",
          topKeywords: member.keywords?.slice(0, 5) || [],
          roleNames, // Explicitly include role names
          messageCount,
          member,
        },
      };
    } catch (error) {
      console.error("🔸 Error in getUserInfo:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get user info",
      };
    }
  },
};

/**
 * Get AI-generated user summary metadata
 */
export const getUserSummaryTool: DatabaseTool = {
  name: "getUserSummary",
  description:
    "Get AI-generated summary, keywords, emojis, and notes for a user. If no userId is provided, use the requesting user (e.g., 'summarize me').",
  parameters: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        description: "Discord user ID to query",
      },
    },
    required: [],
  },
  execute: async (
    params: { userId?: string },
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      const targetUserId = params.userId || context.userId;
      const result = await context.db.query(
        `SELECT summary, keywords, emojis, notes, display_name
         FROM members 
         WHERE user_id = $1 AND guild_id = $2 AND active = true
         LIMIT 1`,
        [targetUserId, context.guildId]
      );

      if (!result.success || !result.data || result.data.length === 0) {
        return {
          success: false,
          error: `User ${targetUserId} not found in this server`,
        };
      }

      const member = result.data[0];
      const parts: string[] = [];

      if (member.display_name) {
        parts.push(`User: ${member.display_name}`);
      }

      if (member.summary) {
        parts.push(`Summary: ${member.summary}`);
      } else {
        parts.push("Summary: No summary available");
      }

      if (member.keywords && member.keywords.length > 0) {
        parts.push(`Keywords: ${member.keywords.join(", ")}`);
      }

      if (member.emojis && member.emojis.length > 0) {
        parts.push(`Emojis: ${member.emojis.join(" ")}`);
      }

      if (member.notes && member.notes.length > 0) {
        parts.push(`Notes: ${member.notes.join(", ")}`);
      }

      return {
        success: true,
        summary: member.summary || "No summary available",
        data: {
          formatted: parts.join("\n"),
          summary: member.summary,
          keywords: member.keywords || [],
          emojis: member.emojis || [],
          notes: member.notes || [],
        },
      };
    } catch (error) {
      console.error("🔸 Error in getUserSummary:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get user summary",
      };
    }
  },
};

/**
 * Search users by name, username, or keyword
 */
export const searchUsersTool: DatabaseTool = {
  name: "searchUsers",
  description:
    "Search for users by display name, username, or keywords. Use this when looking for specific users or users with certain characteristics.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (name, username, or keyword)",
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default: 10)",
      },
    },
    required: ["query"],
  },
  execute: async (
    params: { query: string; limit?: number },
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      const limit = params.limit || 10;
      const searchTerm = `%${params.query.toLowerCase()}%`;

      const result = await context.db.query(
        `SELECT user_id, display_name, username, global_name, nick, summary, keywords
         FROM members 
         WHERE guild_id = $1 
           AND active = true
           AND (
             LOWER(display_name) LIKE $2
             OR LOWER(username) LIKE $2
             OR LOWER(COALESCE(global_name, '')) LIKE $2
             OR LOWER(COALESCE(nick, '')) LIKE $2
             OR EXISTS (
               SELECT 1 FROM UNNEST(keywords) AS kw 
               WHERE LOWER(kw) LIKE $2
             )
           )
         ORDER BY display_name
         LIMIT $3`,
        [context.guildId, searchTerm, limit]
      );

      if (!result.success || !result.data || result.data.length === 0) {
        return {
          success: true,
          summary: `No users found matching "${params.query}"`,
          data: { users: [] },
        };
      }

      const users = result.data.map((u: any) => {
        const parts: string[] = [];
        parts.push(`${u.display_name} (@${u.username})`);
        if (u.user_id) {
          parts.push(`ID: ${u.user_id}`);
        }
        if (u.summary) {
          parts.push(`Summary: ${u.summary}`);
        }
        return parts.join(" | ");
      });

      return {
        success: true,
        summary: `Found ${users.length} user(s) matching "${params.query}"`,
        data: {
          formatted: users.join("\n"),
          users: result.data,
          count: users.length,
        },
      };
    } catch (error) {
      console.error("🔸 Error in searchUsers:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to search users",
      };
    }
  },
};

/**
 * Get user activity statistics
 */
export const getUserActivityTool: DatabaseTool = {
  name: "getUserActivity",
  description:
    "Get user activity statistics including message count, last active time, and presence status. If no userId is provided, use the requesting user.",
  parameters: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        description: "Discord user ID to query",
      },
    },
    required: [],
  },
  execute: async (
    params: { userId?: string },
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      const targetUserId = params.userId || context.userId;
      // Get member data
      const memberResult = await context.db.query(
        `SELECT display_name, status, activities, joined_at, updated_at
         FROM members 
         WHERE user_id = $1 AND guild_id = $2 AND active = true
         LIMIT 1`,
        [targetUserId, context.guildId]
      );

      if (
        !memberResult.success ||
        !memberResult.data ||
        memberResult.data.length === 0
      ) {
        return {
          success: false,
          error: `User ${targetUserId} not found in this server`,
        };
      }

      const member = memberResult.data[0];

      // Get message count
      const messageResult = await context.db.query(
        `SELECT COUNT(*) as count, MAX(created_at) as last_message
         FROM messages 
         WHERE author_id = $1 AND guild_id = $2 AND active = true`,
        [targetUserId, context.guildId]
      );

      const messageCount =
        messageResult.success && messageResult.data?.[0]
          ? parseInt(messageResult.data[0].count, 10)
          : 0;
      const lastMessage =
        messageResult.success && messageResult.data?.[0]?.last_message
          ? new Date(messageResult.data[0].last_message)
          : null;

      const parts: string[] = [];
      parts.push(`Activity for ${member.display_name}:`);
      parts.push(`  - Total messages: ${messageCount}`);
      parts.push(
        `  - Joined: ${new Date(member.joined_at).toLocaleDateString()}`
      );

      if (lastMessage) {
        parts.push(`  - Last message: ${lastMessage.toLocaleDateString()}`);
      }

      if (member.status) {
        parts.push(`  - Status: ${member.status}`);
      }

      return {
        success: true,
        summary: `${member.display_name} has sent ${messageCount} messages`,
        data: {
          formatted: parts.join("\n"),
          messageCount,
          lastMessage,
          status: member.status,
          joinedAt: member.joined_at,
        },
      };
    } catch (error) {
      console.error("🔸 Error in getUserActivity:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get user activity",
      };
    }
  },
};

/**
 * Get user's roles and permissions
 */
export const getUserRolesTool: DatabaseTool = {
  name: "getUserRoles",
  description:
    "Get user's Discord roles and permissions. If no userId is provided, use the requesting user.",
  parameters: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        description: "Discord user ID to query",
      },
    },
    required: [],
  },
  execute: async (
    params: { userId?: string },
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      const targetUserId = params.userId || context.userId;
      const result = await context.db.query(
        `SELECT display_name, roles, permissions
         FROM members 
         WHERE user_id = $1 AND guild_id = $2 AND active = true
         LIMIT 1`,
        [targetUserId, context.guildId]
      );

      if (!result.success || !result.data || result.data.length === 0) {
        return {
          success: false,
          error: `User ${targetUserId} not found in this server`,
        };
      }

      const member = result.data[0];
      const roleIds = member.roles || [];

      // Get role names
      let roleNames: string[] = [];
      if (roleIds.length > 0) {
        const rolesResult = await context.db.query(
          `SELECT name FROM roles 
           WHERE id = ANY($1::text[]) AND guild_id = $2 AND active = true`,
          [roleIds, context.guildId]
        );

        if (rolesResult.success && rolesResult.data) {
          roleNames = rolesResult.data.map((r: any) => r.name);
        }
      }

      const parts: string[] = [];
      parts.push(`Roles for ${member.display_name}:`);

      if (roleNames.length > 0) {
        parts.push(`  - ${roleNames.join(", ")}`);
      } else {
        parts.push(`  - No roles assigned`);
      }

      parts.push(`  - Total roles: ${roleIds.length}`);
      parts.push(`  - Permissions: ${member.permissions || "0"}`);

      return {
        success: true,
        summary: `${member.display_name} has ${roleIds.length} role(s)`,
        data: {
          formatted: parts.join("\n"),
          roles: roleNames,
          roleIds,
          permissions: member.permissions,
        },
      };
    } catch (error) {
      console.error("🔸 Error in getUserRoles:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get user roles",
      };
    }
  },
};

/**
 * Export all user tools for registration
 */
export const userTools: DatabaseTool[] = [
  getUserInfoTool,
  getUserSummaryTool,
  searchUsersTool,
  getUserActivityTool,
  getUserRolesTool,
];
