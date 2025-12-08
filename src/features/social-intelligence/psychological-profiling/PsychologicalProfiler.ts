/**
 * Psychological Profiler
 *
 * Main coordinator for user psychological profiling. Orchestrates:
 * 1. Data gathering (messages, conversations, relationships)
 * 2. Statistical analysis (communication, temporal, response patterns)
 * 3. AI-powered trait estimation (Big Five)
 * 4. Database updates (psych_profile, behavior_patterns, temporal_profile)
 * 5. Staleness tracking
 */

import type { PostgreSQLManager } from "../../../database/PostgreSQLManager";
import { pgvector } from "../../../database/PostgreSQLManager.js";
import type { AIEngine } from "../../../ai/core/AIEngine";
import { CommunicationStyleAnalyzer } from "./analyzers/CommunicationStyleAnalyzer";
import { TemporalPatternAnalyzer } from "./analyzers/TemporalPatternAnalyzer";
import { ResponsePatternAnalyzer } from "./analyzers/ResponsePatternAnalyzer";
import { BigFiveEstimator } from "./analyzers/BigFiveEstimator";
import { MBTIEstimator } from "./analyzers/MBTIEstimator";
import type {
	ProfilingStats,
	UserAnalysisData,
	PsychProfile,
	BehaviorPatterns,
	TemporalProfile,
	MessageData,
	EmojiSignature,
} from "./types";

export interface PsychologicalProfilerConfig {
	minMessagesForProfiling?: number; // Minimum messages needed (default: 10)
	stalenessThreshold?: number; // Messages before re-analysis (default: 50)
	batchSize?: number; // Users per batch (default: 10)
	sleepBetweenBatchesMs?: number; // Sleep between batches (default: 1000)
	skipBigFive?: boolean; // Skip Big Five AI analysis for testing (default: false)
	skipMBTI?: boolean; // Skip MBTI analysis for testing (default: false)
}

export class PsychologicalProfiler {
	private db: PostgreSQLManager;
	private aiEngine: AIEngine | null;
	private bigFiveEstimator: BigFiveEstimator | null;
	private mbtiEstimator: MBTIEstimator;
	private config: Required<PsychologicalProfilerConfig>;
	private stats: ProfilingStats;

	constructor(
		db: PostgreSQLManager,
		aiEngine?: AIEngine,
		config: PsychologicalProfilerConfig = {}
	) {
		this.db = db;
		this.aiEngine = aiEngine || null;
		this.bigFiveEstimator = aiEngine ? new BigFiveEstimator(aiEngine) : null;
		this.mbtiEstimator = new MBTIEstimator(aiEngine);

		this.config = {
			minMessagesForProfiling: config.minMessagesForProfiling ?? 10,
			stalenessThreshold: config.stalenessThreshold ?? 50,
			batchSize: config.batchSize ?? 10,
			sleepBetweenBatchesMs: config.sleepBetweenBatchesMs ?? 1000,
			skipBigFive: config.skipBigFive ?? false,
			skipMBTI: config.skipMBTI ?? false,
		};

		this.stats = {
			users_processed: 0,
			profiles_created: 0,
			profiles_updated: 0,
			errors: 0,
			api_calls_made: 0,
			start_time: new Date(),
		};
	}

	/**
	 * Profile a single user
	 */
	async profileUser(userId: string, guildId: string): Promise<boolean> {
		try {
			console.log(`   [User ${userId.slice(0, 8)}] Profiling...`);

			// 1. Gather user data
			const data = await this.gatherUserData(userId, guildId);

			if (!data) {
				console.log(`   [User ${userId.slice(0, 8)}] ⚠️  Insufficient data`);
				return false;
			}

			// 2. Run statistical analyzers
			const communicationStyle = await CommunicationStyleAnalyzer.analyze(
				data.messages
			);
			const temporalProfile = await TemporalPatternAnalyzer.analyze(
				data.messages
			);
			const responsePatterns = await ResponsePatternAnalyzer.analyze(
				userId,
				data.messages,
				data.conversations
			);

			// 3. Extract emoji signature
			const emojiSignature = this.extractEmojiSignature(data.messages);

			// 4. Run Big Five estimator (AI)
			let bigFive = undefined;
			if (!this.config.skipBigFive && this.bigFiveEstimator) {
				const result = await this.bigFiveEstimator.estimate(
					data,
					communicationStyle.data,
					responsePatterns.data,
					emojiSignature
				);

				if (result.success && result.data) {
					bigFive = result.data;
					this.stats.api_calls_made++;
				} else {
					console.warn(
						`   [User ${userId.slice(0, 8)}] ⚠️  Big Five estimation failed: ${result.error}`
					);
				}
			}

			// 4.5. Run MBTI estimator (hybrid: derive from Big Five + behavioral validation)
			let mbtiType = undefined;
			if (!this.config.skipMBTI && bigFive) {
				const mbtiResult = await this.mbtiEstimator.estimate(
					bigFive,
					communicationStyle.data,
					responsePatterns.data,
					temporalProfile.data,
					data
				);

				if (mbtiResult.success && mbtiResult.data) {
					mbtiType = mbtiResult.data;
					// Only increment API calls if AI validation was actually used
					// (MBTIEstimator only calls AI for low-confidence cases < 0.5)
					if (mbtiResult.data.confidence < 0.5 && data.messages.length >= 100) {
						this.stats.api_calls_made++;
					}
				} else {
					console.warn(
						`   [User ${userId.slice(0, 8)}] ⚠️  MBTI estimation failed: ${mbtiResult.error}`
					);
				}
			}

			// 5. Build profiles
			const psychProfile: PsychProfile = {
				big_five_proxies: bigFive,
				mbti_type: mbtiType,
				communication_style: communicationStyle.data,
				topic_affinity: this.buildTopicAffinity(data),
				profile_metadata: {
					message_count_at_analysis: data.messages.length,
					confidence_overall:
						(communicationStyle.confidence || 0 + temporalProfile.confidence || 0 + responsePatterns.confidence || 0) /
						3,
					last_updated: new Date().toISOString(),
					staleness_threshold: this.config.stalenessThreshold,
				},
			};

			const behaviorPatterns: BehaviorPatterns = {
				response_patterns: responsePatterns.data,
				emoji_signature: emojiSignature,
				interaction_style: this.buildInteractionStyle(data),
			};

			const temporal: TemporalProfile = temporalProfile.data || {};

			// 6. Update database
			const updated = await this.updateDatabase(
				userId,
				guildId,
				psychProfile,
				behaviorPatterns,
				temporal
			);

			if (updated) {
				console.log(
					`   [User ${userId.slice(0, 8)}] 🔹 Profile updated (confidence: ${(psychProfile.profile_metadata.confidence_overall * 100).toFixed(0)}%)`
				);
				this.stats.profiles_updated++;
				return true;
			}

			this.stats.errors++;
			return false;
		} catch (error) {
			console.error(`   [User ${userId.slice(0, 8)}] ❌ Error: ${error}`);
			this.stats.errors++;
			return false;
		}
	}

	/**
	 * Profile a batch of users with rate limiting
	 */
	async profileBatch(guildId: string, userIds: string[]): Promise<number> {
		console.log(`\n📊 Profiling ${userIds.length} users in batches of ${this.config.batchSize}...\n`);

		this.stats = {
			users_processed: 0,
			profiles_created: 0,
			profiles_updated: 0,
			errors: 0,
			api_calls_made: 0,
			start_time: new Date(),
		};

		let successCount = 0;

		for (let i = 0; i < userIds.length; i += this.config.batchSize) {
			const batch = userIds.slice(i, i + this.config.batchSize);
			console.log(`   [Batch ${Math.floor(i / this.config.batchSize) + 1}/${Math.ceil(userIds.length / this.config.batchSize)}]`);

			for (const userId of batch) {
				const success = await this.profileUser(userId, guildId);
				if (success) successCount++;
				this.stats.users_processed++;
			}

			// Sleep between batches (rate limiting)
			if (i + this.config.batchSize < userIds.length) {
				await this.sleep(this.config.sleepBetweenBatchesMs);
			}
		}

		this.stats.end_time = new Date();
		this.stats.duration_seconds =
			(this.stats.end_time.getTime() - this.stats.start_time.getTime()) / 1000;

		this.printSummary();

		return successCount;
	}

	/**
	 * Detect users with stale profiles (50+ new messages OR 7+ days old)
	 */
	async detectStaleProfiles(guildId: string): Promise<string[]> {
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

		const result = await this.db.query(
			`
      SELECT
        m.user_id,
        m.psych_profile->'profile_metadata'->>'message_count_at_analysis' as old_count,
        m.psych_profile->'profile_metadata'->>'last_updated' as last_updated,
        COUNT(msg.id) as current_count
      FROM members m
      LEFT JOIN messages msg ON msg.author_id = m.user_id AND msg.guild_id = m.guild_id
      WHERE m.guild_id = $1
        AND m.bot = false
        AND m.active = true
        AND (
          m.psych_profile->'profile_metadata'->>'last_updated' IS NULL
          OR m.psych_profile->'profile_metadata'->>'last_updated' < $2
          OR (
            (COALESCE((m.psych_profile->'profile_metadata'->>'message_count_at_analysis')::int, 0)) + $3 <=
            (SELECT COUNT(*) FROM messages WHERE author_id = m.user_id AND guild_id = m.guild_id)
          )
        )
      GROUP BY m.user_id, m.psych_profile
      HAVING COUNT(msg.id) >= $4
      `,
			[
				guildId,
				sevenDaysAgo.toISOString(),
				this.config.stalenessThreshold,
				this.config.minMessagesForProfiling,
			]
		);

		if (result.success && result.data) {
			return result.data.map((row: any) => row.user_id);
		}

		return [];
	}

	// ============================================================================
	// Private Helper Methods
	// ============================================================================

	/**
	 * Gather all data needed for user analysis
	 */
	private async gatherUserData(
		userId: string,
		guildId: string
	): Promise<UserAnalysisData | null> {
		// Get user messages (last 200)
		const messagesResult = await this.db.query(
			`
      SELECT id, content, created_at, author_id, referenced_message_id, attachments, embeds
      FROM messages
      WHERE guild_id = $1 AND author_id = $2
      ORDER BY created_at DESC
      LIMIT 200
      `,
			[guildId, userId]
		);

		if (
			!messagesResult.success ||
			!messagesResult.data ||
			messagesResult.data.length < this.config.minMessagesForProfiling
		) {
			return null;
		}

		const messages: MessageData[] = messagesResult.data.map((row: any) => ({
			id: row.id,
			content: row.content || "",
			created_at: new Date(row.created_at),
			author_id: row.author_id,
			referenced_message_id: row.referenced_message_id,
			attachments: row.attachments,
			embeds: row.embeds,
		}));

		// Get user conversations (last 50)
		const conversationsResult = await this.db.query(
			`
      SELECT id, participants, message_count, start_time, end_time, keywords
      FROM conversations_unified
      WHERE guild_id = $1 AND $2 = ANY(participants)
      ORDER BY start_time DESC
      LIMIT 50
      `,
			[guildId, userId]
		);

		const conversations =
			conversationsResult.success && conversationsResult.data
				? conversationsResult.data.map((row: any) => ({
						id: row.id,
						participants: row.participants,
						message_count: row.message_count,
						start_time: new Date(row.start_time),
						end_time: new Date(row.end_time),
						// Keywords are stored as JSONB; they may be an array of strings
						// or a ConversationKeywords object with a `terms` array.
						keywords: Array.isArray(row.keywords)
							? row.keywords
							: row.keywords?.terms
									?.map((k: any) => k?.word)
									.filter((w: unknown): w is string => typeof w === "string") ?? [],
					}))
				: [];

		// Get user relationships and profile data (from user_profiles)
		const profileResult = await this.db.getUserProfile(userId, guildId);

		const relationships =
			profileResult.success && profileResult.data
				? (profileResult.data.relationship_network || [])
				: [];

		const keywords =
			profileResult.success && profileResult.data
				? (profileResult.data.keywords || [])
				: [];

		const emojis =
			profileResult.success && profileResult.data
				? (profileResult.data.emojis || [])
				: [];

		return {
			userId,
			guildId,
			messages,
			conversations,
			relationships,
			keywords,
			emojis,
		};
	}

	/**
	 * Extract emoji signature from messages
	 */
	private extractEmojiSignature(messages: MessageData[]): EmojiSignature {
		const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
		const emojiCounts: Record<string, number> = {};
		let totalEmojis = 0;

		for (const msg of messages) {
			const emojis = msg.content.match(emojiRegex) || [];
			totalEmojis += emojis.length;

			for (const emoji of emojis) {
				emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
			}
		}

		// Get top emojis
		const topEmojis: Record<string, number> = {};
		const sorted = Object.entries(emojiCounts)
			.sort(([, a], [, b]) => b - a)
			.slice(0, 10);

		for (const [emoji, count] of sorted) {
			topEmojis[emoji] = count;
		}

		// Determine timing (simplified)
		const emojiTiming: "reactive" | "proactive" | "mixed" = "mixed";

		return {
			top_emojis: topEmojis,
			emoji_per_message: messages.length > 0 ? totalEmojis / messages.length : 0,
			emoji_timing: emojiTiming,
		};
	}

	/**
	 * Build topic affinity map from keywords
	 */
	private buildTopicAffinity(data: UserAnalysisData): any {
		// Simplified: use top keywords as topics
		const topicAffinity: any = {};

		const topKeywords = (data.keywords || []).slice(0, 10);
		for (const keyword of topKeywords) {
			topicAffinity[keyword] = {
				frequency: Math.floor(Math.random() * 50), // Placeholder
				consistency: Math.random() * 0.5 + 0.5, // Placeholder 0.5-1.0
				expertise_level: "enthusiast" as const,
			};
		}

		return topicAffinity;
	}

	/**
	 * Build interaction style metrics
	 */
	private buildInteractionStyle(data: UserAnalysisData): any {
		const totalMessages = data.messages.length;

		return {
			mentions_given_per_100msg:
				(data.messages.filter((m) => /<@\d+>/.test(m.content)).length /
					totalMessages) *
				100,
			reactions_given_per_100msg: 0, // Placeholder (need reaction data)
			avg_conversation_length_messages:
				data.conversations.length > 0
					? data.conversations.reduce((sum, c) => sum + c.message_count, 0) /
						data.conversations.length
					: 0,
			solo_message_rate: 0.2, // Placeholder
		};
	}

	/**
	 * Update database with profiles
	 */
	private async updateDatabase(
		userId: string,
		guildId: string,
		psychProfile: PsychProfile,
		behaviorPatterns: BehaviorPatterns,
		temporalProfile: TemporalProfile
	): Promise<boolean> {
		const result = await this.db.updateUserProfilePsych(
			userId,
			guildId,
			psychProfile,
			behaviorPatterns,
			temporalProfile
		);

		return result.success;
	}

	/**
	 * Sleep for specified milliseconds
	 */
	private async sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Print profiling summary
	 */
	private printSummary(): void {
		const duration = this.stats.duration_seconds || 0;

		console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log("📊 PSYCHOLOGICAL PROFILING SUMMARY");
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log(`   Users Processed:     ${this.stats.users_processed}`);
		console.log(`   Profiles Updated:    ${this.stats.profiles_updated}`);
		console.log(`   API Calls Made:      ${this.stats.api_calls_made}`);
		console.log(`   Errors:              ${this.stats.errors}`);
		console.log(`   Duration:            ${duration.toFixed(1)}s`);
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
	}

	/**
	 * Get current stats
	 */
	getStats(): ProfilingStats {
		return { ...this.stats };
	}
}
