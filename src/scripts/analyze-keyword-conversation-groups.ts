/**
 * Analyze conversation grouping quality using keywords
 *
 * This script identifies potential conversation groups based on keyword similarity
 * and analyzes how well the current conversation segmentation aligns with topic clusters.
 *
 * Metrics analyzed:
 * - Keyword-based topic clusters (conversations discussing similar topics)
 * - Temporal clustering (time gaps between related conversations)
 * - Participant overlap in keyword-related conversations
 * - Orphaned messages that share keywords with conversations
 *
 * Usage:
 *   GUILD_ID=xxx npm run conversations:analyze-keyword-groups
 *   GUILD_ID=xxx MIN_OVERLAP=0.5 npm run conversations:analyze-keyword-groups
 */

import { config } from "../config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { KeywordExtractor } from "../features/keywords/KeywordExtractor";
import type { ConversationKeywords } from "../features/keywords/types";

interface ConversationSegment {
	id: string;
	channel_id: string;
	message_ids: string[];
	participants: string[];
	message_count: number;
	start_time: Date;
	end_time: Date;
	features: {
		keywords?: ConversationKeywords;
	};
}

interface TopicCluster {
	keyword: string;
	conversations: Array<{
		id: string;
		channel_id: string;
		participant_count: number;
		message_count: number;
		start_time: Date;
		keywordScore: number;
	}>;
	totalConversations: number;
	avgParticipants: number;
	avgMessages: number;
	timeSpanHours: number;
}

async function main() {
	console.log("📊 Analyzing keyword-based conversation grouping...\n");

	const db = new PostgreSQLManager({
		connectionString: config.postgresUrl || "postgresql://localhost:5432/arcados",
	});

	try {
		await db.connect();
		console.log("✅ Connected to PostgreSQL\n");

		const keywordExtractor = new KeywordExtractor(db);
		const targetGuildId = process.env.GUILD_ID;
		const minOverlap = Number.parseFloat(process.env.MIN_OVERLAP || "0.4");

		if (!targetGuildId) {
			console.error("❌ GUILD_ID environment variable required");
			process.exit(1);
		}

		console.log(`Analyzing conversations for guild ${targetGuildId}`);
		console.log(`Minimum keyword overlap threshold: ${minOverlap}\n`);

		// Fetch all conversation segments with keywords
		const segmentsResult = await db.query<ConversationSegment>(`
      SELECT
        id,
        channel_id,
        message_ids,
        participants,
        message_count,
        start_time,
        end_time,
        features
      FROM conversation_segments
      WHERE guild_id = $1
        AND status = 'finalized'
        AND features ? 'keywords'
      ORDER BY start_time DESC
    `, [targetGuildId]);

		if (!segmentsResult.success || !segmentsResult.data) {
			console.error("❌ Failed to fetch conversation segments");
			process.exit(1);
		}

		const segments = segmentsResult.data;
		console.log(`Found ${segments.length} conversation segments with keywords\n`);

		// Build keyword index (keyword -> conversations containing it)
		const keywordIndex = new Map<
			string,
			Array<{ segment: ConversationSegment; score: number }>
		>();

		for (const segment of segments) {
			const keywords = segment.features.keywords?.terms || [];
			for (const kw of keywords) {
				if (!keywordIndex.has(kw.word)) {
					keywordIndex.set(kw.word, []);
				}
				keywordIndex.get(kw.word)!.push({
					segment,
					score: kw.score,
				});
			}
		}

		console.log(`Indexed ${keywordIndex.size} unique keywords\n`);

		// Identify top topic clusters (keywords appearing in multiple conversations)
		const topicClusters: TopicCluster[] = [];

		for (const [keyword, conversations] of keywordIndex.entries()) {
			if (conversations.length < 2) continue; // Skip keywords in single conversation

			const convs = conversations.map((c) => ({
				id: c.segment.id,
				channel_id: c.segment.channel_id,
				participant_count: c.segment.participants.length,
				message_count: c.segment.message_count,
				start_time: c.segment.start_time,
				keywordScore: c.score,
			}));

			const avgParticipants =
				convs.reduce((sum, c) => sum + c.participant_count, 0) /
				convs.length;
			const avgMessages =
				convs.reduce((sum, c) => sum + c.message_count, 0) / convs.length;

			const times = convs.map((c) => new Date(c.start_time).getTime());
			const timeSpanMs = Math.max(...times) - Math.min(...times);
			const timeSpanHours = timeSpanMs / (1000 * 60 * 60);

			topicClusters.push({
				keyword,
				conversations: convs,
				totalConversations: conversations.length,
				avgParticipants,
				avgMessages,
				timeSpanHours,
			});
		}

		// Sort by conversation count
		topicClusters.sort((a, b) => b.totalConversations - a.totalConversations);

		// Display top topic clusters
		console.log("═══════════════════════════════════════════════════");
		console.log("         TOP RECURRING CONVERSATION TOPICS         ");
		console.log("═══════════════════════════════════════════════════\n");

		console.log(
			"Keyword".padEnd(20) +
				"Convs".padEnd(8) +
				"Avg Parts".padEnd(12) +
				"Avg Msgs".padEnd(12) +
				"Time Span",
		);
		console.log("─".repeat(62));

		for (const cluster of topicClusters.slice(0, 30)) {
			const timeSpan =
				cluster.timeSpanHours < 24
					? `${cluster.timeSpanHours.toFixed(1)}h`
					: `${(cluster.timeSpanHours / 24).toFixed(1)}d`;

			console.log(
				cluster.keyword.substring(0, 18).padEnd(20) +
					cluster.totalConversations.toString().padEnd(8) +
					cluster.avgParticipants.toFixed(1).padEnd(12) +
					cluster.avgMessages.toFixed(1).padEnd(12) +
					timeSpan,
			);
		}

		// Analyze conversation overlap patterns
		console.log("\n═══════════════════════════════════════════════════");
		console.log("        CONVERSATION OVERLAP ANALYSIS              ");
		console.log("═══════════════════════════════════════════════════\n");

		const overlapMatrix: Array<{
			conv1: string;
			conv2: string;
			overlap: number;
			timeDiffMinutes: number;
			sameChannel: boolean;
			sharedParticipants: number;
		}> = [];

		for (let i = 0; i < segments.length; i++) {
			for (let j = i + 1; j < segments.length; j++) {
				const seg1 = segments[i];
				const seg2 = segments[j];

				if (!seg1.features.keywords || !seg2.features.keywords) continue;

				const overlap = keywordExtractor.calculateKeywordOverlap(
					seg1.features.keywords,
					seg2.features.keywords,
					true,
				);

				if (overlap >= minOverlap) {
					const timeDiff = Math.abs(
						new Date(seg1.start_time).getTime() -
							new Date(seg2.start_time).getTime(),
					);
					const timeDiffMinutes = timeDiff / (1000 * 60);

					const sharedParticipants = seg1.participants.filter((p) =>
						seg2.participants.includes(p),
					).length;

					overlapMatrix.push({
						conv1: seg1.id,
						conv2: seg2.id,
						overlap,
						timeDiffMinutes,
						sameChannel: seg1.channel_id === seg2.channel_id,
						sharedParticipants,
					});
				}
			}
		}

		console.log(`Found ${overlapMatrix.length} conversation pairs with >${(minOverlap * 100).toFixed(0)}% keyword overlap\n`);

		// Categorize overlaps
		const categories = {
			highOverlap: overlapMatrix.filter((o) => o.overlap > 0.7).length,
			sameChannel: overlapMatrix.filter((o) => o.sameChannel).length,
			withinHour: overlapMatrix.filter((o) => o.timeDiffMinutes <= 60)
				.length,
			withinDay: overlapMatrix.filter(
				(o) => o.timeDiffMinutes > 60 && o.timeDiffMinutes <= 1440,
			).length,
			multiDay: overlapMatrix.filter((o) => o.timeDiffMinutes > 1440).length,
			sharedParticipants: overlapMatrix.filter((o) => o.sharedParticipants > 0)
				.length,
		};

		console.log("📊 Overlap Categories:\n");
		console.log(`   High overlap (>70%): ${categories.highOverlap}`);
		console.log(`   Same channel: ${categories.sameChannel}`);
		console.log(`   Within 1 hour: ${categories.withinHour}`);
		console.log(`   Within 24 hours: ${categories.withinDay}`);
		console.log(`   Multi-day gap: ${categories.multiDay}`);
		console.log(`   Shared participants: ${categories.sharedParticipants}`);

		// Show top overlap pairs
		console.log("\n🔗 Top 15 Most Similar Conversation Pairs:\n");
		console.log(
			"Conv 1".padEnd(10) +
				"Conv 2".padEnd(10) +
				"Overlap".padEnd(10) +
				"Time Gap".padEnd(15) +
				"Channel".padEnd(10) +
				"Shared",
		);
		console.log("─".repeat(65));

		const sortedOverlaps = overlapMatrix.sort((a, b) => b.overlap - a.overlap);

		for (const pair of sortedOverlaps.slice(0, 15)) {
			const timeGap =
				pair.timeDiffMinutes < 60
					? `${pair.timeDiffMinutes.toFixed(0)}m`
					: pair.timeDiffMinutes < 1440
						? `${(pair.timeDiffMinutes / 60).toFixed(1)}h`
						: `${(pair.timeDiffMinutes / 1440).toFixed(1)}d`;

			console.log(
				pair.conv1.substring(0, 8).padEnd(10) +
					pair.conv2.substring(0, 8).padEnd(10) +
					`${(pair.overlap * 100).toFixed(1)}%`.padEnd(10) +
					timeGap.padEnd(15) +
					(pair.sameChannel ? "Same" : "Different").padEnd(10) +
					pair.sharedParticipants,
			);
		}

		// Analyze orphan potential
		console.log("\n═══════════════════════════════════════════════════");
		console.log("           ORPHANED MESSAGE ANALYSIS               ");
		console.log("═══════════════════════════════════════════════════\n");

		const orphans = segments.filter((s) => s.message_count <= 2);
		const orphansWithMatches = orphans.filter((orphan) => {
			if (!orphan.features.keywords?.terms.length) return false;

			// Check if this orphan has keyword overlap with any full conversation
			for (const conv of segments) {
				if (conv.id === orphan.id) continue;
				if (conv.message_count <= 2) continue;
				if (!conv.features.keywords) continue;

				const overlap = keywordExtractor.calculateKeywordOverlap(
					orphan.features.keywords,
					conv.features.keywords,
					true,
				);

				if (overlap >= minOverlap) return true;
			}
			return false;
		});

		console.log(`Total orphaned segments (≤2 messages): ${orphans.length}`);
		console.log(
			`Orphans with keyword matches: ${orphansWithMatches.length} (${((orphansWithMatches.length / orphans.length) * 100).toFixed(1)}%)`,
		);
		console.log(
			`Potential merges available: ${orphansWithMatches.length}\n`,
		);

		// Summary statistics
		console.log("═══════════════════════════════════════════════════");
		console.log("                    SUMMARY                        ");
		console.log("═══════════════════════════════════════════════════\n");

		console.log("🎯 Key Insights:\n");
		console.log(
			`   1. ${topicClusters.filter((c) => c.totalConversations >= 3).length} recurring topics (3+ conversations)`,
		);
		console.log(
			`   2. ${overlapMatrix.filter((o) => o.overlap > 0.7 && o.timeDiffMinutes <= 60).length} high-overlap pairs within 1 hour`,
		);
		console.log(
			`   3. ${orphansWithMatches.length} orphaned messages could be merged`,
		);
		console.log(
			`   4. ${overlapMatrix.filter((o) => o.sameChannel && o.sharedParticipants === 0).length} topic continuations without participant overlap\n`,
		);

		console.log("💡 Recommendations:\n");

		if (orphansWithMatches.length > 10) {
			console.log(
				`   • Run conversations:regroup-keywords to merge ${orphansWithMatches.length} orphaned segments`,
			);
		}

		if (overlapMatrix.filter((o) => o.overlap > 0.8).length > 5) {
			console.log(
				"   • Consider adjusting conversation timeout (high topic continuity detected)",
			);
		}

		if (topicClusters.filter((c) => c.timeSpanHours > 168).length > 3) {
			console.log(
				"   • Long-running topics detected - consider topic tracking features",
			);
		}

		console.log("");
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

main();
