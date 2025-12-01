/**
 * ServerEnrichmentPipeline (Layer 4)
 *
 * Enriches guild/server summaries based on:
 * - Top conversations (by participant count, message count, recency)
 * - Top topics from conversation keywords
 * - Enriched relationship profiles
 * - Community structure analysis (optional, Phase 5)
 *
 * New implementation.
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

export class ServerEnrichmentPipeline {
	private db: PostgreSQLManager;
	private aiEngine: AIEngine;
	private rateLimiter: EnrichmentRateLimiter;

	constructor(db: PostgreSQLManager, aiEngine: AIEngine) {
		this.db = db;
		this.aiEngine = aiEngine;
		this.rateLimiter = EnrichmentRateLimiter.getInstance();
	}

	/**
	 * Enrich guild summary
	 */
	async enrichGuild(guildId: string): Promise<void> {
		try {
			// Aggregate top conversations (last 7 days)
			const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

			const topConversationsResult = await this.db.query(
				`
				SELECT 
					cs.id,
					cs.summary,
					cs.participants,
					cs.message_count,
					cs.start_time,
					cs.features->'keywords' as keywords
				FROM conversation_segments cs
				WHERE cs.guild_id = $1
				AND cs.start_time >= $2
				AND cs.status = 'finalized'
				AND cs.ai_processing_status = 'completed'
				AND cs.summary IS NOT NULL
				ORDER BY 
					array_length(cs.participants, 1) DESC,
					cs.message_count DESC,
					cs.start_time DESC
				LIMIT 20
				`,
				[guildId, sevenDaysAgo],
			);

			if (
				!topConversationsResult.success ||
				!topConversationsResult.data ||
				topConversationsResult.data.length === 0
			) {
				console.log(`   ℹ️  No recent conversations found for guild ${guildId}`);
				return;
			}

			const topConversations = topConversationsResult.data;

			// Extract top topics from conversation keywords (weighted by recency)
			const topTopics = this.extractTopTopics(topConversations);

			// Query enriched relationship profiles
			const relationshipsResult = await this.db.query(
				`
				SELECT 
					user_a,
					user_b,
					relationship_summary,
					relationship_type
				FROM relationship_profiles
				WHERE guild_id = $1
				AND last_enriched_at IS NOT NULL
				ORDER BY last_enriched_at DESC
				LIMIT 15
				`,
				[guildId],
			);

			const topRelationships =
				relationshipsResult.success && relationshipsResult.data
					? relationshipsResult.data
					: [];

			// Estimate cost and check budget
			const costEstimate = this.rateLimiter.estimateGuildCost(
				topConversations.length,
			);
			const canAfford = await this.rateLimiter.canAffordEnrichment(
				costEstimate.estimatedCost,
			);

			if (!canAfford.canAfford) {
				console.warn(
					`⚠️  Cannot afford guild enrichment: ${canAfford.reason}`,
				);
				return;
			}

			// Get existing guild summary
			const existingSummaryResult = await this.db.query(
				`
				SELECT 
					guild_summary,
					enrichment_history,
					last_enriched_relationship_count
				FROM guild_metadata
				WHERE guild_id = $1
				`,
				[guildId],
			);

			const existingSummary =
				existingSummaryResult.success &&
				existingSummaryResult.data &&
				existingSummaryResult.data.length > 0
					? existingSummaryResult.data[0]
					: null;

			// Check if we need delta or initial summary
			const currentRelationshipCount = topRelationships.length;
			const lastEnrichedRelationshipCount =
				existingSummary?.last_enriched_relationship_count || 0;
			const needsDelta =
				existingSummary &&
				currentRelationshipCount - lastEnrichedRelationshipCount >= 10;

			let guildSummary: string;
			let enrichmentHistory: EnrichmentHistory | null = null;

			if (existingSummary && needsDelta) {
				// Generate delta using IncrementalEnrichment
				const existingHistoryJson = existingSummary.enrichment_history;
				const existingHistory = existingHistoryJson
					? IncrementalEnrichment.parseHistory(existingHistoryJson)
					: null;

				const baseSummary = existingHistory
					? IncrementalEnrichment.getCompositeSummary(existingHistory)
					: existingSummary.guild_summary || "No previous guild summary.";

				const contextRange = IncrementalEnrichment.timeContextRange(7);

				const newContext = this.buildGuildContext(
					topTopics,
					topRelationships,
					[],
				);

				const deltaPrompt = IncrementalEnrichment.createDeltaPrompt(
					"guild",
					baseSummary,
					newContext,
					contextRange,
				);

				const delta = await this.generateDelta(deltaPrompt, guildId);
				if (!delta) {
					console.warn(`⚠️  Failed to generate guild delta`);
					return;
				}

				const confidence = 0.85;
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

				guildSummary = IncrementalEnrichment.getCompositeSummary(
					enrichmentHistory,
				);
			} else {
				// Generate initial guild summary
				guildSummary = await this.generateInitialSummary(
					topTopics,
					topRelationships,
					[],
					guildId,
				);

				if (!guildSummary) {
					console.warn(`⚠️  Failed to generate initial guild summary`);
					return;
				}

				enrichmentHistory = IncrementalEnrichment.createHistory(guildSummary);
			}

			// Update guild_metadata
			await this.db.query(
				`
				UPDATE guild_metadata
				SET 
					guild_summary = $2,
					enrichment_history = $3::jsonb,
					last_enriched_relationship_count = $4,
					last_enriched_at = NOW()
				WHERE guild_id = $1
				`,
				[guildId, guildSummary, JSON.stringify(enrichmentHistory), currentRelationshipCount],
			);

			// Track cost
			await this.rateLimiter.trackCost(costEstimate.estimatedCost, "guild");

			console.log(
				`✅ Enriched guild ${guildId} (${topConversations.length} conversations, ${topRelationships.length} relationships)`,
			);
		} catch (error) {
			console.error(`❌ Error enriching guild ${guildId}:`, error);
		}
	}

	/**
	 * Extract top topics from conversations (weighted by recency)
	 */
	private extractTopTopics(conversations: any[]): Array<{
		topic: string;
		frequency: number;
		trend: "up" | "stable" | "down";
	}> {
		const topicCounts = new Map<string, number>();
		const now = Date.now();

		for (const conv of conversations) {
			const keywords = conv.keywords;
			if (!keywords) continue;

			// Weight by recency (more recent = higher weight)
			const age = now - new Date(conv.start_time).getTime();
			const recencyWeight = Math.max(0.5, 1 - age / (7 * 24 * 60 * 60 * 1000));

			const keywordArray = Array.isArray(keywords)
				? keywords
				: keywords.terms
					? keywords.terms.map((t: any) => t.word || t)
					: [];

			for (const keyword of keywordArray) {
				if (typeof keyword === "string" && keyword.length >= 3) {
					topicCounts.set(
						keyword.toLowerCase(),
						(topicCounts.get(keyword.toLowerCase()) || 0) + recencyWeight,
					);
				}
			}
		}

		const topTopics = Array.from(topicCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([topic, frequency]) => ({
				topic,
				frequency: Math.round(frequency),
				trend: "stable" as const, // Simplified - could analyze trends
			}));

		return topTopics;
	}

	/**
	 * Build guild context string for prompts
	 */
	private buildGuildContext(
		topTopics: Array<{ topic: string; frequency: number; trend: string }>,
		topRelationships: any[],
		clusters: any[],
	): string {
		let context = "";

		if (topTopics.length > 0) {
			context += `**Top Conversation Topics** (last 7 days):\n`;
			context += topTopics
				.map((t) => `- ${t.topic}: ${t.frequency} conversations, trending ${t.trend}`)
				.join("\n");
			context += "\n\n";
		}

		if (topRelationships.length > 0) {
			context += `**Top Relationships**:\n`;
			context += topRelationships
				.map(
					(r) =>
						`- ${r.user_a.slice(0, 8)} & ${r.user_b.slice(0, 8)}: ${r.relationship_summary || "No summary"}`,
				)
				.join("\n");
			context += "\n\n";
		}

		if (clusters.length > 0) {
			context += `**Community Clusters**:\n`;
			context += clusters
				.map(
					(c) =>
						`- Cluster ${c.id}: ${c.members.length} members, ${c.description || "No description"}`,
				)
				.join("\n");
		}

		return context.trim();
	}

	/**
	 * Generate initial guild summary using LLM
	 */
	private async generateInitialSummary(
		topTopics: Array<{ topic: string; frequency: number; trend: string }>,
		topRelationships: any[],
		clusters: any[],
		guildId: string,
	): Promise<string | null> {
		const context = this.buildGuildContext(topTopics, topRelationships, clusters);

		const prompt = `Summarize this Discord server based on recent activity and community structure.

${context}

**Task**: Write 3-4 sentences describing the server's focus, culture, and recent trends.

**Guild Summary**:`;

		return await this.generateDelta(prompt, guildId);
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
			console.error(`❌ Failed to generate guild summary: ${error}`);
		}

		return null;
	}
}

