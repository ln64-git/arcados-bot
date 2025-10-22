import type { SurrealDBManager } from "../../database/SurrealDBManager";
import type {
	DatabaseResult,
	RelationshipEntry,
	SurrealMember,
	SurrealMessage,
} from "../../database/schema";
import type {
	AffinityScoreResult,
	AffinityWeights,
	MessageInteraction,
	RelationshipComputeOptions,
	RelationshipNetworkResult,
	UserInteractionSummary,
} from "./types";
import {
	AffinityCalculationError,
	DEFAULT_AFFINITY_WEIGHTS,
	DEFAULT_COMPUTE_OPTIONS,
	NetworkComputationError,
	generateAffinityCacheKey,
	generateCacheKey,
} from "./types";

export class RelationshipNetworkManager {
	private db: SurrealDBManager;
	private weights: AffinityWeights;
	private options: RelationshipComputeOptions;

	constructor(
		db: SurrealDBManager,
		weights: AffinityWeights = DEFAULT_AFFINITY_WEIGHTS,
		options: RelationshipComputeOptions = DEFAULT_COMPUTE_OPTIONS,
	) {
		this.db = db;
		this.weights = weights;
		this.options = options;
	}

	/**
	 * Calculate affinity score between two users based on message interactions
	 */
	async calculateAffinityScore(
		user1Id: string,
		user2Id: string,
		guildId: string,
	): Promise<AffinityScoreResult> {
		try {
			// Get message interactions between the two users
			const interactionsResult = await this.db.getMessageInteractions(
				user1Id,
				user2Id,
				guildId,
				this.options.timeWindowMinutes,
			);

			if (!interactionsResult.success) {
				throw new AffinityCalculationError(
					`Failed to get message interactions: ${interactionsResult.error}`,
				);
			}

			const interactions = interactionsResult.data || [];

			// Calculate interaction summary
			const summary = this.calculateInteractionSummary(user2Id, interactions);

			// Apply logarithmic scaling to get final score
			const score = this.normalizeAffinityScore(summary.total_points);

			return {
				score,
				interaction_summary: summary,
				computed_at: new Date(),
			};
		} catch (error) {
			throw new AffinityCalculationError(
				`Failed to calculate affinity score: ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
			);
		}
	}

	/**
	 * Build complete relationship network for a user
	 */
	async buildRelationshipNetwork(
		userId: string,
		guildId: string,
	): Promise<RelationshipEntry[]> {
		try {
			// Get all members in the guild
			const membersResult = await this.db.getMembersByGuild(guildId);
			if (!membersResult.success) {
				throw new NetworkComputationError(
					`Failed to get guild members: ${membersResult.error}`,
				);
			}

			const members = membersResult.data || [];
			const relationships: RelationshipEntry[] = [];

			// Calculate affinity with each other member
			for (const member of members) {
				if (member.user_id === userId) continue; // Skip self

				try {
					const affinityResult = await this.calculateAffinityScore(
						userId,
						member.user_id,
						guildId,
					);

					// Only include relationships above minimum threshold
					if (affinityResult.score >= this.options.minAffinityScore) {
						relationships.push({
							user_id: member.user_id,
							affinity_score: affinityResult.score,
							last_interaction:
								affinityResult.interaction_summary.last_interaction,
							interaction_count:
								affinityResult.interaction_summary.interaction_count,
						});
					}
				} catch (error) {
					console.warn(
						`🔸 Failed to calculate affinity for ${member.user_id}: ${
							error instanceof Error ? error.message : "Unknown error"
						}`,
					);
					// Continue with other members even if one fails
				}
			}

			// Sort by affinity score descending
			relationships.sort((a, b) => b.affinity_score - a.affinity_score);

			// Limit to maximum relationships
			return relationships.slice(0, this.options.maxRelationships);
		} catch (error) {
			throw new NetworkComputationError(
				`Failed to build relationship network: ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
			);
		}
	}

	/**
	 * Update member's relationship network in database
	 */
	async updateMemberRelationships(
		userId: string,
		guildId: string,
	): Promise<DatabaseResult<void>> {
		try {
			const startTime = Date.now();

			// Build relationship network
			const relationships = await this.buildRelationshipNetwork(
				userId,
				guildId,
			);

			// Update member record
			const memberId = `${guildId}:${userId}`;
			const updateResult = await this.db.updateMemberRelationshipNetwork(
				memberId,
				relationships,
			);

			if (!updateResult.success) {
				throw new NetworkComputationError(
					`Failed to update member relationships: ${updateResult.error}`,
				);
			}

			const duration = Date.now() - startTime;
			console.log(
				`🔹 Updated relationship network for ${userId}: ${relationships.length} relationships computed in ${duration}ms`,
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
	 * Get top relationships for a user (with on-demand computation)
	 */
	async getTopRelationships(
		userId: string,
		guildId: string,
		limit = 10,
	): Promise<DatabaseResult<RelationshipEntry[]>> {
		try {
			// First try to get existing relationships from database
			const existingResult = await this.db.getMemberRelationshipNetwork(
				userId,
				guildId,
			);

			if (existingResult.success && existingResult.data) {
				const relationships = existingResult.data;
				// Check if relationships are recent enough (within cache TTL)
				const memberResult = await this.db.getMember(`${guildId}:${userId}`);
				if (memberResult.success && memberResult.data) {
					const lastUpdate = memberResult.data.updated_at;
					const cacheAge = Date.now() - lastUpdate.getTime();
					const cacheTTLMs = this.options.cacheTTLMinutes * 60 * 1000;

					if (cacheAge < cacheTTLMs) {
						// Return cached relationships
						return {
							success: true,
							data: relationships.slice(0, limit),
						};
					}
				}
			}

			// Cache is stale or missing, compute fresh relationships
			console.log(`🔹 Computing fresh relationship network for ${userId}`);
			const relationships = await this.buildRelationshipNetwork(
				userId,
				guildId,
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
		interactions: MessageInteraction[],
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

	/**
	 * Update affinity scoring weights
	 */
	setWeights(weights: AffinityWeights): void {
		this.weights = weights;
	}

	/**
	 * Update computation options
	 */
	setOptions(options: RelationshipComputeOptions): void {
		this.options = { ...this.options, ...options };
	}

	/**
	 * Get current weights
	 */
	getWeights(): AffinityWeights {
		return { ...this.weights };
	}

	/**
	 * Get current options
	 */
	getOptions(): RelationshipComputeOptions {
		return { ...this.options };
	}
}
