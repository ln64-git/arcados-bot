/**
 * Regroup conversations using keyword-based topic matching
 *
 * This script identifies orphaned messages and conversation segments that should
 * be merged based on keyword overlap and topic similarity.
 *
 * Strategy:
 * 1. Find all conversation segments with keywords
 * 2. Identify orphaned messages (single-message conversations)
 * 3. Calculate keyword overlap between orphans and nearby conversations
 * 4. Merge segments with high keyword overlap (>0.6 weighted similarity)
 * 5. Re-score and re-finalize merged conversations
 *
 * Usage:
 *   GUILD_ID=xxx npm run conversations:regroup-keywords
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

interface MergeCandidate {
	orphanId: string;
	targetId: string;
	keywordOverlap: number;
	timeDiffMinutes: number;
	sharedParticipants: number;
}

async function main() {
	console.log("🔄 Regrouping conversations with keyword-based matching...\n");

	const db = new PostgreSQLManager({
		connectionString: config.postgresUrl || "postgresql://localhost:5432/arcados",
	});

	try {
		await db.connect();
		console.log("✅ Connected to PostgreSQL\n");

		const keywordExtractor = new KeywordExtractor(db);
		const targetGuildId = process.env.GUILD_ID;

		if (!targetGuildId) {
			console.error("❌ GUILD_ID environment variable required");
			process.exit(1);
		}

		console.log(`📊 Analyzing conversations for guild ${targetGuildId}...\n`);

		// Step 1: Fetch all finalized conversation segments with keywords
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
      ORDER BY channel_id, start_time
    `, [targetGuildId]);

		if (!segmentsResult.success || !segmentsResult.data) {
			console.error("❌ Failed to fetch conversation segments");
			process.exit(1);
		}

		const segments = segmentsResult.data;
		console.log(`Found ${segments.length} conversation segments with keywords\n`);

		// Step 2: Identify orphaned messages (conversations with only 1-2 messages)
		const orphans = segments.filter((s) => s.message_count <= 2);
		const conversations = segments.filter((s) => s.message_count > 2);

		console.log(`   Orphaned segments: ${orphans.length}`);
		console.log(`   Full conversations: ${conversations.length}\n`);

		if (orphans.length === 0) {
			console.log("✅ No orphaned segments to process");
			return;
		}

		// Step 3: Find merge candidates based on keyword overlap
		console.log("🔍 Analyzing keyword overlap...\n");

		const mergeCandidates: MergeCandidate[] = [];
		const KEYWORD_THRESHOLD = Number.parseFloat(
			process.env.MIN_OVERLAP || "0.4",
		); // Minimum weighted keyword overlap
		const TIME_WINDOW_MINUTES = Number.parseInt(
			process.env.TIME_WINDOW || "1440",
			10,
		); // Max time gap to consider (default: 24 hours)

		console.log(`   Keyword threshold: ${(KEYWORD_THRESHOLD * 100).toFixed(0)}%`);
		console.log(`   Time window: ${TIME_WINDOW_MINUTES} minutes\n`);

		for (const orphan of orphans) {
			if (!orphan.features.keywords?.terms.length) continue;

			// Find nearby conversations in the same channel
			const nearbyConversations = conversations.filter((conv) => {
				if (conv.channel_id !== orphan.channel_id) return false;

				const timeDiff = Math.abs(
					new Date(orphan.start_time).getTime() -
						new Date(conv.end_time).getTime(),
				);
				const timeDiffMinutes = timeDiff / (1000 * 60);

				return timeDiffMinutes <= TIME_WINDOW_MINUTES;
			});

			// Calculate keyword overlap with each nearby conversation
			for (const conv of nearbyConversations) {
				if (!conv.features.keywords?.terms.length) continue;

				const overlap = keywordExtractor.calculateKeywordOverlap(
					orphan.features.keywords,
					conv.features.keywords,
					true, // weighted
				);

				if (overlap >= KEYWORD_THRESHOLD) {
					const timeDiff = Math.abs(
						new Date(orphan.start_time).getTime() -
							new Date(conv.end_time).getTime(),
					);
					const timeDiffMinutes = timeDiff / (1000 * 60);

					const sharedParticipants = orphan.participants.filter((p) =>
						conv.participants.includes(p),
					).length;

					mergeCandidates.push({
						orphanId: orphan.id,
						targetId: conv.id,
						keywordOverlap: overlap,
						timeDiffMinutes,
						sharedParticipants,
					});
				}
			}
		}

		console.log(`Found ${mergeCandidates.length} merge candidates\n`);

		if (mergeCandidates.length === 0) {
			console.log("✅ No merge candidates found");
			return;
		}

		// Step 4: Sort candidates by quality (overlap * shared participants / time)
		mergeCandidates.sort((a, b) => {
			const scoreA =
				(a.keywordOverlap * (1 + a.sharedParticipants)) /
				(1 + a.timeDiffMinutes / 10);
			const scoreB =
				(b.keywordOverlap * (1 + b.sharedParticipants)) /
				(1 + b.timeDiffMinutes / 10);
			return scoreB - scoreA;
		});

		// Step 5: Display top merge candidates
		console.log("🎯 Top 20 Merge Candidates:\n");
		console.log(
			"Orphan ID".padEnd(30) +
				"Target ID".padEnd(30) +
				"Overlap".padEnd(10) +
				"Time".padEnd(12) +
				"Shared",
		);
		console.log("─".repeat(92));

		for (const candidate of mergeCandidates.slice(0, 20)) {
			console.log(
				candidate.orphanId.substring(0, 28).padEnd(30) +
					candidate.targetId.substring(0, 28).padEnd(30) +
					`${(candidate.keywordOverlap * 100).toFixed(1)}%`.padEnd(10) +
					`${candidate.timeDiffMinutes.toFixed(1)}m`.padEnd(12) +
					candidate.sharedParticipants,
			);
		}

		console.log("\n📊 Merge Candidate Statistics:\n");
		console.log(`   Total candidates: ${mergeCandidates.length}`);
		console.log(
			`   High overlap (>70%): ${mergeCandidates.filter((c) => c.keywordOverlap > 0.7).length}`,
		);
		console.log(
			`   Medium overlap (40-70%): ${mergeCandidates.filter((c) => c.keywordOverlap >= 0.4 && c.keywordOverlap <= 0.7).length}`,
		);
		console.log(
			`   With shared participants: ${mergeCandidates.filter((c) => c.sharedParticipants > 0).length}`,
		);
		console.log(
			`   Within 5 minutes: ${mergeCandidates.filter((c) => c.timeDiffMinutes <= 5).length}`,
		);

		// Step 6: Ask for confirmation before merging
		console.log("\n⚠️  Review the merge candidates above.");
		console.log(
			"    To actually perform the merges, add --execute flag to this script.\n",
		);

		const shouldExecute = process.argv.includes("--execute");

		if (!shouldExecute) {
			console.log("ℹ️  Dry run complete. No changes made.");
			console.log("   Run with --execute to perform merges.");
			return;
		}

		// Step 7: Execute merges
		console.log("\n🔨 Executing merges...\n");

		let mergeCount = 0;
		const processedOrphans = new Set<string>();

		for (const candidate of mergeCandidates) {
			// Skip if orphan already merged
			if (processedOrphans.has(candidate.orphanId)) continue;

			try {
				// Merge orphan into target conversation
				await mergeConversations(
					db,
					candidate.orphanId,
					candidate.targetId,
				);

				processedOrphans.add(candidate.orphanId);
				mergeCount++;

				console.log(
					`   ✅ Merged ${candidate.orphanId.substring(0, 8)}... into ${candidate.targetId.substring(0, 8)}... (${(candidate.keywordOverlap * 100).toFixed(1)}% overlap)`,
				);
			} catch (error) {
				console.error(
					`   ❌ Failed to merge ${candidate.orphanId}: ${error}`,
				);
			}
		}

		console.log(`\n✅ Merge complete! Merged ${mergeCount} orphaned segments.`);

		// Step 8: Suggest re-scoring
		console.log("\n💡 Next steps:");
		console.log("   1. Run conversation scoring to update affinity scores");
		console.log("   2. Consider re-extracting keywords for merged segments");
		console.log(
			"   3. Run analyze:conversations to verify conversation quality\n",
		);
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

/**
 * Merge orphan conversation into target conversation
 */
async function mergeConversations(
	db: PostgreSQLManager,
	orphanId: string,
	targetId: string,
): Promise<void> {
	// Fetch both segments
	const orphanResult = await db.query<ConversationSegment>(
		"SELECT * FROM conversation_segments WHERE id = $1",
		[orphanId],
	);

	const targetResult = await db.query<ConversationSegment>(
		"SELECT * FROM conversation_segments WHERE id = $1",
		[targetId],
	);

	if (
		!orphanResult.success ||
		!orphanResult.data?.[0] ||
		!targetResult.success ||
		!targetResult.data?.[0]
	) {
		throw new Error("Failed to fetch segments for merge");
	}

	const orphan = orphanResult.data[0];
	const target = targetResult.data[0];

	// Merge data
	const mergedMessageIds = [...target.message_ids, ...orphan.message_ids].sort();
	const mergedParticipantIds = [
		...new Set([...target.participants, ...orphan.participants]),
	];
	const mergedMessageCount = mergedMessageIds.length;
	const mergedStartTime =
		new Date(target.start_time) < new Date(orphan.start_time)
			? target.start_time
			: orphan.start_time;
	const mergedEndTime =
		new Date(target.end_time) > new Date(orphan.end_time)
			? target.end_time
			: orphan.end_time;

	// Update target conversation
	await db.query(
		`
    UPDATE conversation_segments
    SET
      message_ids = $1,
      participants = $2,
      message_count = $3,
      start_time = $4,
      end_time = $5,
      features = features - 'keywords'  -- Clear keywords for re-extraction
    WHERE id = $6
  `,
		[
			mergedMessageIds,
			mergedParticipantIds,
			mergedMessageCount,
			mergedStartTime,
			mergedEndTime,
			targetId,
		],
	);

	// Delete orphan segment
	await db.query("DELETE FROM conversation_segments WHERE id = $1", [
		orphanId,
	]);
}

main();
