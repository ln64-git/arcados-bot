/**
 * RelationshipEnrichmentPipeline (Layer 3)
 *
 * Enriches relationship profiles between pairs of users based on:
 * - Shared conversations
 * - User profile updates (cascade trigger)
 * - Interaction metrics
 *
 * New implementation (no existing code to refactor).
 */

import type { PostgreSQLManager } from "../../../../database/PostgreSQLManager";
import type { AIEngine } from "../../../../ai/core/AIEngine";
import type { AIResponse } from "../../../../ai/providers/base/AIProvider";
import { AIRequestBuilder } from "../../../../ai/core/AIRequestBuilder";
import { AIContextBuilder } from "../../../../ai/core/AIContext.js";
import { EnrichmentRateLimiter } from "../EnrichmentRateLimiter";
import {
	IncrementalEnrichment,
	type EnrichmentHistory,
} from "../utils/IncrementalEnrichment";

export class RelationshipEnrichmentPipeline {
	private db: PostgreSQLManager;
	private aiEngine: AIEngine;
	private rateLimiter: EnrichmentRateLimiter;

	constructor(db: PostgreSQLManager, aiEngine: AIEngine) {
		this.db = db;
		this.aiEngine = aiEngine;
		this.rateLimiter = EnrichmentRateLimiter.getInstance();
	}

	/**
	 * Normalize user pair (ensure userA < userB lexicographically)
	 */
	private normalizeUserPair(userA: string, userB: string): [string, string] {
		return userA < userB ? [userA, userB] : [userB, userA];
	}

	/**
	 * Enrich relationship between two users
	 */
	async enrichRelationship(
		userA: string,
		userB: string,
		guildId: string,
	): Promise<void> {
		try {
			// Normalize user pair
			const [normalizedA, normalizedB] = this.normalizeUserPair(userA, userB);

			// Query shared conversations
			const sharedConversationsResult = await this.db.query(
				`
				SELECT cs.id, cs.summary, cs.participants, cs.message_count, cs.start_time, cs.end_time
				FROM conversation_segments cs
				WHERE cs.guild_id = $1
				AND $2 = ANY(cs.participants)
				AND $3 = ANY(cs.participants)
				AND cs.status = 'finalized'
				AND cs.ai_processing_status = 'completed'
				AND cs.summary IS NOT NULL
				ORDER BY cs.start_time DESC
				LIMIT 20
				`,
				[guildId, normalizedA, normalizedB],
			);

			if (
				!sharedConversationsResult.success ||
				!sharedConversationsResult.data ||
				sharedConversationsResult.data.length === 0
			) {
				console.log(
					`   ℹ️  No shared conversations found for ${normalizedA.slice(0, 8)} & ${normalizedB.slice(0, 8)}`,
				);
				return;
			}

			const sharedConversations = sharedConversationsResult.data;
			const currentSharedCount = sharedConversations.length;

			// Get user profiles
			const userAProfileResult = await this.db.getUserProfile(normalizedA, guildId);
			const userBProfileResult = await this.db.getUserProfile(normalizedB, guildId);

			if (!userAProfileResult.success || !userBProfileResult.success) {
				console.warn(
					`⚠️  Failed to get user profiles for relationship enrichment`,
				);
				return;
			}

			const userAProfile = userAProfileResult.data;
			const userBProfile = userBProfileResult.data;

			// Query interaction metrics from relationship_edges
			const edgesResult = await this.db.query(
				`
				SELECT total, msg_a_to_b, msg_b_to_a, mentions, replies
				FROM relationship_edges
				WHERE guild_id = $1
				AND user_a = $2
				AND user_b = $3
				`,
				[guildId, normalizedA, normalizedB],
			);

			const edges =
				edgesResult.success && edgesResult.data && edgesResult.data.length > 0
					? edgesResult.data[0]
					: {
							total: 0,
							msg_a_to_b: 0,
							msg_b_to_a: 0,
							mentions: 0,
							replies: 0,
						};

			// Check if relationship profile exists
			const existingProfileResult = await this.db.query(
				`
				SELECT 
					relationship_summary,
					enrichment_history,
					user_a_profile_version,
					user_b_profile_version,
					last_enriched_conversation_count
				FROM relationship_profiles
				WHERE guild_id = $1 AND user_a = $2 AND user_b = $3
				`,
				[guildId, normalizedA, normalizedB],
			);

			const existingProfile =
				existingProfileResult.success &&
				existingProfileResult.data &&
				existingProfileResult.data.length > 0
					? existingProfileResult.data[0]
					: null;

			// Estimate cost and check budget
			const costEstimate = this.rateLimiter.estimateRelationshipCost(
				sharedConversations.length,
			);
			const canAfford = await this.rateLimiter.canAffordEnrichment(
				costEstimate.estimatedCost,
			);

			if (!canAfford.canAfford) {
				console.warn(
					`⚠️  Cannot afford relationship enrichment: ${canAfford.reason}`,
				);
				return;
			}

			// Check if we need to generate delta or initial summary
			const needsDelta =
				existingProfile &&
				existingProfile.last_enriched_conversation_count &&
				currentSharedCount - existingProfile.last_enriched_conversation_count >= 3;

			let relationshipSummary: string;
			let enrichmentHistory: EnrichmentHistory | null = null;

			if (existingProfile && needsDelta) {
				// Generate delta using IncrementalEnrichment
				const existingHistoryJson = existingProfile.enrichment_history;
				const existingHistory = existingHistoryJson
					? IncrementalEnrichment.parseHistory(existingHistoryJson)
					: null;

				const baseSummary = existingHistory
					? IncrementalEnrichment.getCompositeSummary(existingHistory)
					: existingProfile.relationship_summary || "No previous relationship data.";

				const newConversations = sharedConversations.slice(
					0,
					currentSharedCount - existingProfile.last_enriched_conversation_count,
				);
				const conversationSummaries = newConversations
					.map((c: any) => c.summary)
					.filter(Boolean)
					.join("\n\n");

				const contextRange = IncrementalEnrichment.relationshipContextRange(
					existingProfile.last_enriched_conversation_count,
					currentSharedCount,
				);

				const deltaPrompt = IncrementalEnrichment.createDeltaPrompt(
					"relationship",
					baseSummary,
					conversationSummaries,
					contextRange,
				);

				const delta = await this.generateDelta(deltaPrompt, guildId);
				if (!delta) {
					console.warn(`⚠️  Failed to generate relationship delta`);
					return;
				}

				const confidence = 0.8;
				if (existingHistory) {
					enrichmentHistory = IncrementalEnrichment.appendDelta(
						existingHistory,
						contextRange,
						delta,
						confidence,
					);
				} else {
					const initialHistory = IncrementalEnrichment.createHistory(baseSummary);
					enrichmentHistory = IncrementalEnrichment.appendDelta(
						initialHistory,
						contextRange,
						delta,
						confidence,
					);
				}

				relationshipSummary = IncrementalEnrichment.getCompositeSummary(
					enrichmentHistory,
				);
			} else {
				// Generate initial relationship summary
				relationshipSummary = await this.generateInitialSummary(
					userAProfile,
					userBProfile,
					sharedConversations,
					edges,
					guildId,
				);

				if (!relationshipSummary) {
					console.warn(`⚠️  Failed to generate initial relationship summary`);
					return;
				}

				enrichmentHistory = IncrementalEnrichment.createHistory(relationshipSummary);
			}

			// Extract shared keywords (simplified - from conversation summaries)
			const sharedKeywords = this.extractSharedKeywords(sharedConversations);

			// Classify relationship type (optional - can be enhanced with LLM)
			const relationshipType = this.classifyRelationshipType(
				edges,
				sharedConversations.length,
			);

			// Get current user profile versions
			const userAProfileVersion = userAProfile?.profile_version || 0;
			const userBProfileVersion = userBProfile?.profile_version || 0;

			// Upsert relationship profile
			await this.db.query(
				`
				INSERT INTO relationship_profiles (
					guild_id, user_a, user_b,
					relationship_summary,
					enrichment_history,
					relationship_type,
					shared_keywords,
					user_a_profile_version,
					user_b_profile_version,
					last_enriched_conversation_count,
					last_enriched_at
				)
				VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, NOW())
				ON CONFLICT (guild_id, user_a, user_b)
				DO UPDATE SET
					relationship_summary = $4,
					enrichment_history = $5::jsonb,
					relationship_type = $6,
					shared_keywords = $7,
					user_a_profile_version = $8,
					user_b_profile_version = $9,
					last_enriched_conversation_count = $10,
					last_enriched_at = NOW()
				`,
				[
					guildId,
					normalizedA,
					normalizedB,
					relationshipSummary,
					JSON.stringify(enrichmentHistory),
					relationshipType,
					sharedKeywords,
					userAProfileVersion,
					userBProfileVersion,
					currentSharedCount,
				],
			);

			// Track cost
			await this.rateLimiter.trackCost(costEstimate.estimatedCost, "relationship");

			console.log(
				`🔹 Enriched relationship ${normalizedA.slice(0, 8)} & ${normalizedB.slice(0, 8)} (${currentSharedCount} shared conversations)`,
			);
		} catch (error) {
			console.error(
				`❌ Error enriching relationship ${userA.slice(0, 8)} & ${userB.slice(0, 8)}:`,
				error,
			);
		}
	}

	/**
	 * Generate initial relationship summary using LLM
	 */
	private async generateInitialSummary(
		userAProfile: any,
		userBProfile: any,
		sharedConversations: any[],
		edges: any,
		guildId: string,
	): Promise<string | null> {
		const userASummary = userAProfile?.summary || "No profile data available.";
		const userBSummary = userBProfile?.summary || "No profile data available.";

		const conversationSummaries = sharedConversations
			.map((c: any) => c.summary)
			.filter(Boolean)
			.join("\n\n");

		const prompt = `Analyze the relationship between these two Discord users based on their shared conversations and interaction patterns.

**User A Profile**:
${userASummary}

**User B Profile**:
${userBSummary}

**Shared Conversations (${sharedConversations.length} total)**:
${conversationSummaries}

**Interaction Metrics**:
- Total interactions: ${edges.total}
- Messages A→B: ${edges.msg_a_to_b}
- Messages B→A: ${edges.msg_b_to_a}
- Mentions: ${edges.mentions}
- Replies: ${edges.replies}

**Task**: Write 2-3 sentences describing their relationship dynamic, shared interests, and interaction patterns.

**Relationship Summary**:`;

		return await this.generateDelta(prompt, guildId);
	}

	/**
	 * Extract shared keywords from conversations
	 */
	private extractSharedKeywords(conversations: any[]): string[] {
		// Simplified: extract from conversation summaries
		// In a full implementation, this could analyze conversation keywords
		const keywords = new Set<string>();

		for (const conv of conversations) {
			if (conv.summary) {
				// Extract potential keywords (words that appear frequently)
				const words = conv.summary
					.toLowerCase()
					.replace(/[^\w\s]/g, " ")
					.split(/\s+/)
					.filter((w) => w.length >= 4);

				for (const word of words) {
					keywords.add(word);
				}
			}
		}

		return Array.from(keywords).slice(0, 10);
	}

	/**
	 * Classify relationship type based on interaction patterns
	 */
	private classifyRelationshipType(edges: any, sharedCount: number): string {
		// Simplified classification - could be enhanced with LLM
		if (edges.mentions > 20 || edges.replies > 30) {
			return "close_friends";
		}
		if (sharedCount > 10) {
			return "regular_collaborators";
		}
		if (edges.msg_a_to_b > 50 || edges.msg_b_to_a > 50) {
			return "mentor_mentee";
		}
		return "acquaintances";
	}

	/**
	 * Generate delta using LLM
	 */
	private async generateDelta(prompt: string, guildId: string): Promise<string | null> {
		let provider = "grok";
		if (!process.env.GROK_API_KEY) {
			if (process.env.OLLAMA_URL) {
				provider = "ollama";
			}
		}

		try {
			const builder = new AIRequestBuilder(this.aiEngine);
			const ctx = new AIContextBuilder()
				.user("system-enricher")
				.guild(guildId)
				.build();
			const result = await builder
				.chat()
				.blocking()
				.withContext(ctx)
				.provider(provider as "grok" | "ollama")
				.persona("casual")
				.withoutTools()
				.generate(prompt);

			const response = result as AIResponse;
			if (response.success && response.content) {
				return response.content.trim();
			}
		} catch (error) {
			console.error(`❌ Failed to generate relationship summary: ${error}`);
		}

		return null;
	}
}

