import type { PostgreSQLManager } from "../database/PostgreSQLManager";
import type {
  DatabaseResult,
  RelationshipEntry,
} from "../database/PostgreSQLManager";
import type {
  AffinityScoreResult,
  MessageInteraction,
  UserInteractionSummary,
} from "./types";
import { ConversationManager } from "./ConversationManager.js";

export class RelationshipNetworkManager {
  private db: PostgreSQLManager;
  private conversationManager: ConversationManager;

  constructor(db: PostgreSQLManager) {
    this.db = db;
    this.conversationManager = new ConversationManager(db);
  }

  /**
   * Calculate affinity score between two users based on message interactions and conversations
   */
  async calculateAffinityScore(
    user1Id: string,
    user2Id: string,
    guildId: string
  ): Promise<AffinityScoreResult> {
    try {
      // Check if either user is a bot - if so, return zero score
      const [user1Result, user2Result] = await Promise.all([
        this.db.query(
          "SELECT bot FROM members WHERE user_id = $1 AND guild_id = $2 AND active = true",
          [user1Id, guildId]
        ),
        this.db.query(
          "SELECT bot FROM members WHERE user_id = $1 AND guild_id = $2 AND active = true",
          [user2Id, guildId]
        ),
      ]);

      if (
        user1Result.success &&
        user1Result.data &&
        user1Result.data.length > 0 &&
        user1Result.data[0].bot
      ) {
        return this.createZeroAffinityResult(user2Id);
      }

      if (
        user2Result.success &&
        user2Result.data &&
        user2Result.data.length > 0 &&
        user2Result.data[0].bot
      ) {
        return this.createZeroAffinityResult(user2Id);
      }

      // Get message interactions between the two users
      const interactionsResult = await this.db.getMessageInteractions(
        user1Id,
        user2Id,
        guildId,
        5 // 5 minute time window
      );

      if (!interactionsResult.success) {
        throw new Error(
          `Failed to get message interactions: ${interactionsResult.error}`
        );
      }

      const interactions = interactionsResult.data || [];

      // Calculate interaction summary (legacy)
      const summary = this.calculateInteractionSummary(user2Id, interactions);

      // Get conversations for enhanced scoring
      const conversationsResult =
        await this.conversationManager.detectConversations(
          user1Id,
          user2Id,
          guildId,
          5
        );

      const conversations = conversationsResult.success
        ? conversationsResult.data || []
        : [];

      // Calculate enhanced affinity score
      const enhancedBreakdown = this.calculateEnhancedAffinity(
        conversations,
        user1Id,
        user2Id
      );

      return {
        raw_points:
          enhancedBreakdown.conversation_points +
          enhancedBreakdown.message_points +
          enhancedBreakdown.interaction_bonuses,
        interaction_summary: summary,
        computed_at: new Date(),
        enhanced_breakdown: enhancedBreakdown,
        relevance_percentage: 0, // Will be calculated by buildRelationshipNetwork
      };
    } catch (error) {
      throw new Error(
        `Failed to calculate affinity score: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Build complete relationship network for a user using relative percentages
   */
  async buildRelationshipNetwork(
    userId: string,
    guildId: string
  ): Promise<RelationshipEntry[]> {
    try {
      // Get all members in the guild
      const membersResult = await this.db.getMembersByGuild(guildId);
      if (!membersResult.success) {
        throw new Error(`Failed to get guild members: ${membersResult.error}`);
      }

      const members = membersResult.data || [];

      // Calculate total interaction points for this user across all other users
      let totalInteractionPoints = 0;
      const rawInteractions: Array<{
        user_id: string;
        points: number;
        interaction_count: number;
        last_interaction: Date;
      }> = [];

      // Calculate affinity with each other member (excluding bots)
      for (const member of members) {
        if (member.user_id === userId) continue; // Skip self
        if (member.bot) continue; // Skip bots

        try {
          const affinityResult = await this.calculateAffinityScore(
            userId,
            member.user_id,
            guildId
          );

          const points = affinityResult.raw_points;
          if (points > 0) {
            totalInteractionPoints += points;
            rawInteractions.push({
              user_id: member.user_id,
              points: points,
              interaction_count:
                affinityResult.interaction_summary.interaction_count,
              last_interaction:
                affinityResult.interaction_summary.last_interaction ||
                new Date(),
            });
          }
        } catch (error) {
          console.warn(
            `🔸 Failed to calculate affinity for ${member.user_id}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
          // Continue with other members even if one fails
        }
      }

      // Calculate percentage-based relevance scores and add conversations
      const relationships: RelationshipEntry[] = [];

      for (const raw of rawInteractions) {
        // Get conversations for this relationship
        const conversationsResult =
          await this.conversationManager.detectConversations(
            userId,
            raw.user_id,
            guildId,
            5 // 5 minute time window
          );

        const conversations = conversationsResult.success
          ? conversationsResult.data || []
          : [];

        // Calculate percentage of total interaction time/attention
        const relevancePercentage =
          totalInteractionPoints > 0
            ? (raw.points / totalInteractionPoints) * 100
            : 0;

        // Get member info for display - use the original members array
        const member = members.find((m) => m.user_id === raw.user_id);
        const totalMessages = conversations.reduce(
          (sum, conv) => sum + conv.message_count,
          0
        );

        const relationshipEntry: RelationshipEntry = {
          user_id: raw.user_id,
          affinity_percentage: relevancePercentage, // This is now the relevance percentage
          interaction_count: raw.interaction_count,
          last_interaction: raw.last_interaction,
          conversations: conversations,
          display_name: member?.display_name,
          username: member?.username,
          raw_points: raw.points,
          total_messages: totalMessages,
        };

        // Clean up empty optional fields to avoid storing empty arrays/null values
        const cleanedEntry = this.cleanRelationshipEntry(relationshipEntry);
        relationships.push(cleanedEntry);
      }

      // Sort by percentage descending and limit to top 50
      relationships.sort(
        (a, b) => b.affinity_percentage - a.affinity_percentage
      );
      return relationships.slice(0, 50);
    } catch (error) {
      throw new Error(
        `Failed to build relationship network: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Update member's relationship network in database
   */
  async updateMemberRelationships(
    userId: string,
    guildId: string
  ): Promise<DatabaseResult<void>> {
    try {
      const startTime = Date.now();

      // Build relationship network
      const relationships = await this.buildRelationshipNetwork(
        userId,
        guildId
      );

      // Update member record - database uses underscore format
      const memberId = `${guildId}_${userId}`;
      const updateResult = await this.db.updateMemberRelationshipNetwork(
        memberId,
        relationships
      );

      if (!updateResult.success) {
        throw new Error(
          `Failed to update member relationships: ${updateResult.error}`
        );
      }

      const duration = Date.now() - startTime;
      console.log(
        `🔹 Updated relationship network for ${userId}: ${relationships.length} relationships computed in ${duration}ms`
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get top relationships for a user
   */
  async getTopRelationships(
    userId: string,
    guildId: string,
    limit = 10
  ): Promise<DatabaseResult<RelationshipEntry[]>> {
    try {
      // Get existing relationships from database
      const existingResult = await this.db.getMemberRelationshipNetwork(
        userId,
        guildId
      );

      if (
        existingResult.success &&
        existingResult.data &&
        existingResult.data.length > 0
      ) {
        return {
          success: true,
          data: existingResult.data.slice(0, limit),
        };
      }

      // No existing relationships, compute fresh ones
      console.log(`🔹 Computing fresh relationship network for ${userId}`);
      const relationships = await this.buildRelationshipNetwork(
        userId,
        guildId
      );

      // Update database with fresh relationships
      await this.updateMemberRelationships(userId, guildId);

      return {
        success: true,
        data: relationships.slice(0, limit),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Calculate interaction summary from message interactions
   */
  private calculateInteractionSummary(
    otherUserId: string,
    interactions: MessageInteraction[]
  ): UserInteractionSummary {
    let totalPoints = 0;
    let sameChannelCount = 0;
    let mentionCount = 0;
    let replyCount = 0;
    let lastInteraction: Date | undefined;

    for (const interaction of interactions) {
      totalPoints += interaction.points;

      switch (interaction.interaction_type) {
        case "same_channel":
          sameChannelCount++;
          break;
        case "mention":
          mentionCount++;
          break;
        case "reply":
          replyCount++;
          break;
      }

      // Track most recent interaction
      if (!lastInteraction || interaction.timestamp > lastInteraction) {
        lastInteraction = interaction.timestamp;
      }
    }

    return {
      user_id: otherUserId,
      total_points: totalPoints,
      interaction_count: interactions.length,
      last_interaction: lastInteraction,
      breakdown: {
        same_channel: sameChannelCount,
        mentions: mentionCount,
        replies: replyCount,
      },
    };
  }

  /**
   * Create a zero affinity result for bot users
   */
  private createZeroAffinityResult(targetUserId: string): AffinityScoreResult {
    return {
      raw_points: 0,
      interaction_summary: {
        user_id: targetUserId,
        total_points: 0,
        interaction_count: 0,
        last_interaction: new Date(),
        breakdown: {
          same_channel: 0,
          mentions: 0,
          replies: 0,
        },
      },
      computed_at: new Date(),
      enhanced_breakdown: {
        conversation_points: 0,
        message_points: 0,
        interaction_bonuses: 0,
        total_conversations: 0,
        total_messages: 0,
        name_interactions: 0,
        mention_interactions: 0,
      },
      relevance_percentage: 0, // Bots get 0% relevance
    };
  }

  /**
   * Calculate relevance percentage for a specific relationship
   * This shows what percentage of total interaction time/attention this relationship represents
   */
  async calculateRelevancePercentage(
    user1Id: string,
    user2Id: string,
    guildId: string
  ): Promise<number> {
    try {
      // Get all relationships for user1 to calculate total points
      const membersResult = await this.db.getMembersByGuild(guildId);
      if (!membersResult.success || !membersResult.data) {
        return 0;
      }

      const members = membersResult.data.filter(
        (m) => m.user_id !== user1Id && !m.bot
      );
      let totalPoints = 0;
      let targetPoints = 0;

      // Calculate total points across all relationships
      for (const member of members) {
        try {
          const affinityResult = await this.calculateAffinityScore(
            user1Id,
            member.user_id,
            guildId
          );

          const points = affinityResult.raw_points;
          totalPoints += points;

          if (member.user_id === user2Id) {
            targetPoints = points;
          }
        } catch (error) {
          // Skip errors silently
        }
      }

      // Calculate percentage
      return totalPoints > 0 ? (targetPoints / totalPoints) * 100 : 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate enhanced affinity score based on conversations
   * Formula: (conversations * 1) + (total_messages * 0.05) + interaction_bonuses
   */
  private calculateEnhancedAffinity(
    conversations: import("./types").ConversationEntry[],
    user1Id: string,
    user2Id: string
  ): import("./types").EnhancedAffinityBreakdown {
    if (conversations.length === 0) {
      return {
        conversation_points: 0,
        message_points: 0,
        interaction_bonuses: 0,
        total_conversations: 0,
        total_messages: 0,
        name_interactions: 0,
        mention_interactions: 0,
      };
    }

    // Count conversations (1 point each - more conservative)
    const conversationPoints = conversations.length * 1;

    // Count total messages in all conversations (0.05 points each - more conservative)
    const totalMessages = conversations.reduce(
      (sum, conv) => sum + conv.message_count,
      0
    );
    const messagePoints = totalMessages * 0.05;

    // Count direct interactions across all conversations
    let nameInteractionCount = 0;
    let mentionInteractionCount = 0;

    conversations.forEach((conv) => {
      // Count mentions
      if (conv.interaction_types.includes("mention")) {
        mentionInteractionCount++;
      }

      // Count name interactions - only if names were actually used
      if (conv.has_name_usage) {
        nameInteractionCount++;
      }
    });

    // Calculate interaction bonuses (more conservative)
    // Name-based: +1 point each, Mentions: +1 point each
    const interactionBonuses =
      nameInteractionCount * 1 + mentionInteractionCount * 1;

    return {
      conversation_points: conversationPoints,
      message_points: messagePoints,
      interaction_bonuses: interactionBonuses,
      total_conversations: conversations.length,
      total_messages: totalMessages,
      name_interactions: nameInteractionCount,
      mention_interactions: mentionInteractionCount,
    };
  }

  /**
   * Clean relationship entry by removing empty optional fields
   */
  private cleanRelationshipEntry(entry: RelationshipEntry): RelationshipEntry {
    const cleaned: RelationshipEntry = {
      user_id: entry.user_id,
      affinity_percentage: entry.affinity_percentage,
      interaction_count: entry.interaction_count,
      last_interaction: entry.last_interaction,
    };

    // Only include optional fields if they have meaningful values
    if (entry.summary && entry.summary.trim().length > 0) {
      cleaned.summary = entry.summary;
    }

    if (entry.keywords && entry.keywords.length > 0) {
      cleaned.keywords = entry.keywords;
    }

    if (entry.emojis && entry.emojis.length > 0) {
      cleaned.emojis = entry.emojis;
    }

    if (entry.notes && entry.notes.length > 0) {
      cleaned.notes = entry.notes;
    }

    if (entry.conversations && entry.conversations.length > 0) {
      cleaned.conversations = entry.conversations;
    }

    if (entry.display_name) {
      cleaned.display_name = entry.display_name;
    }

    if (entry.username) {
      cleaned.username = entry.username;
    }

    if (entry.raw_points !== undefined) {
      cleaned.raw_points = entry.raw_points;
    }

    if (entry.total_messages !== undefined) {
      cleaned.total_messages = entry.total_messages;
    }

    return cleaned;
  }

  /**
   * Normalize affinity score using logarithmic scaling
   */
  private normalizeAffinityScore(points: number): number {
    if (points === 0) return 0;

    // Apply logarithmic scaling: score = min(100, log10(points + 1) * 25)
    const score = Math.min(100, Math.log10(points + 1) * 25);
    return Math.round(score * 100) / 100; // Round to 2 decimal places
  }

  // ============================================================================
  // Incremental Realtime Methods
  // ============================================================================

  /**
   * Record a single interaction event (O(1) update)
   */
  async recordInteraction(
    guildId: string,
    authorId: string,
    otherId: string,
    kind: "message" | "mention" | "reply" | "reaction",
    direction: "a_to_b" | "b_to_a",
    timestamp: Date
  ): Promise<DatabaseResult<void>> {
    try {
      const delta: any = {
        total: 1,
      };

      if (kind === "message") {
        if (direction === "a_to_b") {
          delta.msg_a_to_b = 1;
        } else {
          delta.msg_b_to_a = 1;
        }
      } else if (kind === "mention") {
        delta.mentions = 1;
      } else if (kind === "reply") {
        delta.replies = 1;
      } else if (kind === "reaction") {
        delta.reactions = 1;
      }

      const result = await this.db.upsertEdgeCounters(
        guildId,
        authorId,
        otherId,
        delta
      );

      if (!result.success) {
        throw new Error(`Failed to record interaction: ${result.error}`);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Roll up edges to member's relationship_network JSONB (top-N format)
   */
  async rollupEdgesToMemberNetwork(
    userId: string,
    guildId: string,
    limit: number = 50
  ): Promise<DatabaseResult<void>> {
    try {
      const edgesResult = await this.db.getEdgesForUser(guildId, userId, limit * 2);
      if (!edgesResult.success || !edgesResult.data) {
        throw new Error(`Failed to get edges: ${edgesResult.error}`);
      }

      const edges = edgesResult.data;
      const totalInteractions = edges.reduce((sum, e) => sum + (e.total || 0), 0);

      const relationships: RelationshipEntry[] = [];

      for (const edge of edges) {
        const otherUserId = edge.user_a === userId ? edge.user_b : edge.user_a;
        
        if (otherUserId === userId) continue; // Skip self

        const relevancePercentage =
          totalInteractions > 0
            ? ((edge.total || 0) / totalInteractions) * 100
            : 0;

        const interactionCount =
          (edge.user_a === userId ? edge.msg_a_to_b : edge.msg_b_to_a) +
          (edge.mentions || 0) +
          (edge.replies || 0);

        const relationship: RelationshipEntry = {
          user_id: otherUserId,
          affinity_percentage: Math.round(relevancePercentage * 100) / 100,
          interaction_count: interactionCount,
          last_interaction: new Date(edge.last_interaction),
          raw_points: edge.total || 0,
          total_messages: interactionCount,
        };

        relationships.push(relationship);
      }

      relationships.sort(
        (a, b) => b.affinity_percentage - a.affinity_percentage
      );
      const topRelationships = relationships.slice(0, limit);

      const memberId = `${guildId}_${userId}`;
      const updateResult = await this.db.updateMemberRelationshipNetwork(
        memberId,
        topRelationships
      );

      if (!updateResult.success) {
        throw new Error(`Failed to update network: ${updateResult.error}`);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get dyad summary (both directions) for two users
   */
  async getDyadSummary(
    userA: string,
    userB: string,
    guildId: string
  ): Promise<DatabaseResult<{
    a_to_b: RelationshipEntry | null;
    b_to_a: RelationshipEntry | null;
  }>> {
    try {
      const [edgeAB, edgeBA] = await Promise.all([
        this.db.getEdgeForPair(guildId, userA, userB),
        this.db.getEdgeForPair(guildId, userB, userA),
      ]);

      const aToB = edgeAB.success && edgeAB.data
        ? {
            user_id: userB,
            affinity_percentage: 0,
            interaction_count: (edgeAB.data.msg_a_to_b || 0) + (edgeAB.data.mentions || 0) + (edgeAB.data.replies || 0),
            last_interaction: new Date(edgeAB.data.last_interaction),
            raw_points: edgeAB.data.total || 0,
          }
        : null;

      const bToA = edgeBA.success && edgeBA.data
        ? {
            user_id: userA,
            affinity_percentage: 0,
            interaction_count: (edgeBA.data.msg_b_to_a || 0) + (edgeBA.data.mentions || 0) + (edgeBA.data.replies || 0),
            last_interaction: new Date(edgeBA.data.last_interaction),
            raw_points: edgeBA.data.total || 0,
          }
        : null;

      return {
        success: true,
        data: { a_to_b: aToB, b_to_a: bToA },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get peer matrix - relationships between multiple users in conversation
   */
  async getPeerMatrix(
    participantIds: string[],
    guildId: string
  ): Promise<DatabaseResult<Record<string, RelationshipEntry>>> {
    try {
      const matrix: Record<string, RelationshipEntry> = {};

      for (let i = 0; i < participantIds.length; i++) {
        for (let j = i + 1; j < participantIds.length; j++) {
          const userA = participantIds[i];
          const userB = participantIds[j];

          const edgesResult = await this.db.getEdgesForUser(guildId, userA, 100);
          if (!edgesResult.success || !edgesResult.data) continue;

          const edge = edgesResult.data.find(
            (e) => e.user_a === userA && e.user_b === userB ||
                   e.user_a === userB && e.user_b === userA
          );

          if (edge) {
            const key = `${userA}:${userB}`;
            matrix[key] = {
              user_id: userB,
              affinity_percentage: 0,
              interaction_count: (edge.msg_a_to_b || 0) + (edge.msg_b_to_a || 0) + (edge.mentions || 0) + (edge.replies || 0),
              last_interaction: new Date(edge.last_interaction),
              raw_points: edge.total || 0,
            };
          }
        }
      }

      return { success: true, data: matrix };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
