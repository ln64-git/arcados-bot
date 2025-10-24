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

export class RelationshipNetworkManager {
  private db: PostgreSQLManager;

  constructor(db: PostgreSQLManager) {
    this.db = db;
  }

  /**
   * Calculate affinity score between two users based on message interactions
   */
  async calculateAffinityScore(
    user1Id: string,
    user2Id: string,
    guildId: string
  ): Promise<AffinityScoreResult> {
    try {
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

      // Calculate interaction summary
      const summary = this.calculateInteractionSummary(user2Id, interactions);

      return {
        raw_points: summary.total_points,
        interaction_summary: summary,
        computed_at: new Date(),
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

      // Calculate affinity with each other member
      for (const member of members) {
        if (member.user_id === userId) continue; // Skip self

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

      // Calculate percentages
      const relationships: RelationshipEntry[] = rawInteractions.map((raw) => ({
        user_id: raw.user_id,
        affinity_percentage:
          totalInteractionPoints > 0
            ? (raw.points / totalInteractionPoints) * 100
            : 0,
        interaction_count: raw.interaction_count,
        last_interaction: raw.last_interaction,
      }));

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

      // Update member record
      const memberId = `${guildId}:${userId}`;
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
   * Normalize affinity score using logarithmic scaling
   */
  private normalizeAffinityScore(points: number): number {
    if (points === 0) return 0;

    // Apply logarithmic scaling: score = min(100, log10(points + 1) * 25)
    const score = Math.min(100, Math.log10(points + 1) * 25);
    return Math.round(score * 100) / 100; // Round to 2 decimal places
  }
}
