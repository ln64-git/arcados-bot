import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

async function analyzeConversationGrouping() {
	const db = new PostgreSQLManager();

	try {
		console.log("🔹 Connecting to database...");
		const connected = await db.connect();
		if (!connected) {
			console.error("🔸 Failed to connect");
			return;
		}

		const guildId = process.argv[2] || process.env.GUILD_ID;
		if (!guildId) {
			console.error("🔸 Usage: npx tsx src/scripts/analyze-conversation-grouping.ts <guild_id>");
			return;
		}

		console.log(`\n🔍 Analyzing conversation grouping for guild ${guildId}...\n`);

		// Get the largest conversation segments
		const largestSegments = await db.query(
			`
			SELECT
				id,
				participants,
				message_ids,
				start_time,
				end_time,
				message_count,
				EXTRACT(EPOCH FROM (end_time - start_time)) / 60 as duration_minutes,
				channel_id,
				status
			FROM conversation_segments
			WHERE guild_id = $1
			ORDER BY message_count DESC
			LIMIT 10
			`,
			[guildId]
		);

		if (!largestSegments.success || !largestSegments.data || largestSegments.data.length === 0) {
			console.log("🔸 No conversation segments found");
			await db.disconnect();
			return;
		}

		console.log("━".repeat(80));
		console.log("📊 LARGEST CONVERSATION SEGMENTS ANALYSIS");
		console.log("━".repeat(80));

		for (let i = 0; i < largestSegments.data.length; i++) {
			const segment = largestSegments.data[i];

			console.log(`\n${i + 1}. Segment ${segment.id.substring(0, 12)}...`);
			console.log(`   Channel: ${segment.channel_id}`);
			console.log(`   Participants: ${segment.participants.length}`);
			console.log(`   Messages: ${segment.message_count}`);
			console.log(`   Duration: ${Math.round(segment.duration_minutes)} minutes (${(segment.duration_minutes / 60).toFixed(1)} hours)`);
			console.log(`   Start: ${new Date(segment.start_time).toLocaleString()}`);
			console.log(`   End: ${new Date(segment.end_time).toLocaleString()}`);
			console.log(`   Status: ${segment.status}`);

			// Get actual messages from this segment to analyze time gaps
			const messagesResult = await db.query(
				`
				SELECT
					id,
					author_id,
					created_at,
					content,
					referenced_message_id
				FROM messages
				WHERE id = ANY($1::TEXT[])
				ORDER BY created_at ASC
				`,
				[segment.message_ids]
			);

			if (messagesResult.success && messagesResult.data && messagesResult.data.length > 0) {
				const messages = messagesResult.data;

				// Calculate time gaps between consecutive messages
				const timeGaps: number[] = [];
				for (let j = 1; j < messages.length; j++) {
					const gap = (new Date(messages[j].created_at).getTime() - new Date(messages[j - 1].created_at).getTime()) / (1000 * 60);
					timeGaps.push(gap);
				}

				// Find large gaps (> 1 hour = 60 minutes)
				const largeGaps = timeGaps.filter(gap => gap > 60);
				const avgGap = timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length;
				const maxGap = Math.max(...timeGaps);

				console.log(`\n   📈 Time Gap Analysis:`);
				console.log(`      Average gap: ${avgGap.toFixed(1)} minutes`);
				console.log(`      Max gap: ${maxGap.toFixed(1)} minutes (${(maxGap / 60).toFixed(1)} hours)`);
				console.log(`      Gaps > 1 hour: ${largeGaps.length}`);
				console.log(`      Gaps > 6 hours: ${largeGaps.filter(g => g > 360).length}`);
				console.log(`      Gaps > 24 hours: ${largeGaps.filter(g => g > 1440).length}`);

				// Count replies vs non-replies
				const repliesCount = messages.filter(m => m.referenced_message_id).length;
				const nonRepliesCount = messages.length - repliesCount;

				console.log(`\n   💬 Message Structure:`);
				console.log(`      Replies: ${repliesCount} (${((repliesCount / messages.length) * 100).toFixed(1)}%)`);
				console.log(`      Non-replies: ${nonRepliesCount} (${((nonRepliesCount / messages.length) * 100).toFixed(1)}%)`);

				// Show participant distribution
				const authorCounts = new Map<string, number>();
				for (const msg of messages) {
					authorCounts.set(msg.author_id, (authorCounts.get(msg.author_id) || 0) + 1);
				}

				console.log(`\n   👥 Participant Distribution:`);
				const sortedAuthors = Array.from(authorCounts.entries())
					.sort((a, b) => b[1] - a[1])
					.slice(0, 5);

				for (const [authorId, count] of sortedAuthors) {
					console.log(`      ${authorId}: ${count} messages (${((count / messages.length) * 100).toFixed(1)}%)`);
				}

				// If there are large gaps, show where they are
				if (largeGaps.length > 0) {
					console.log(`\n   ⚠️  LARGE TIME GAPS DETECTED:`);
					let gapIndex = 0;
					for (let j = 1; j < messages.length && gapIndex < 5; j++) {
						const gap = (new Date(messages[j].created_at).getTime() - new Date(messages[j - 1].created_at).getTime()) / (1000 * 60);
						if (gap > 60) {
							console.log(`      Gap ${gapIndex + 1}: ${gap.toFixed(0)} minutes (${(gap / 60).toFixed(1)} hours)`);
							console.log(`         Before: ${new Date(messages[j - 1].created_at).toLocaleString()}`);
							console.log(`         After:  ${new Date(messages[j].created_at).toLocaleString()}`);
							gapIndex++;
						}
					}
				}

				// Check if this looks like multiple conversations merged together
				const suspiciouslyLong = segment.duration_minutes > 1440; // > 24 hours
				const hasLargeGaps = largeGaps.length > 3;
				const lowReplyRate = (repliesCount / messages.length) < 0.3;

				if (suspiciouslyLong || hasLargeGaps) {
					console.log(`\n   🚨 POTENTIAL ISSUE: This segment may contain multiple unrelated conversations!`);
					if (suspiciouslyLong) {
						console.log(`      - Duration spans ${(segment.duration_minutes / 1440).toFixed(1)} days`);
					}
					if (hasLargeGaps) {
						console.log(`      - Contains ${largeGaps.length} gaps > 1 hour`);
					}
					if (lowReplyRate) {
						console.log(`      - Low reply rate (${((repliesCount / messages.length) * 100).toFixed(1)}%) suggests weak connection`);
					}
				}
			}

			console.log(`\n` + "─".repeat(80));
		}

		console.log(`\n✅ Analysis complete\n`);

		await db.disconnect();
	} catch (error) {
		console.error("🔸 Error:", error);
	}
}

analyzeConversationGrouping();
