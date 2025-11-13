import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { ConversationManager } from "../features/relationship-network/ConversationManager";
import { AIManager } from "../features/ai-assistant/AIManager";
import { TopicDriftDetector } from "../features/relationship-network/TopicDriftDetector";

const GUILD_ID = process.env.GUILD_ID || "1254694808228986912";
const DAYS_LOOKBACK = parseInt(process.env.DAYS || "7", 10);
const MIN_MESSAGES = parseInt(process.env.MIN_MESSAGES || "20", 10);
const MIN_DURATION_MINUTES = parseInt(process.env.MIN_DURATION || "60", 10);

interface ConversationSegment {
	id: string;
	channel_id: string;
	participants: string[];
	start_time: Date;
	end_time: Date;
	message_ids: string[];
	message_count: number;
	summary?: string;
	topic_label?: string;
	topic_confidence?: number;
}

async function main() {
	console.log("\n🔹 Split Conversations by Topic - Post-Processing");
	console.log("━".repeat(80));
	console.log(`Guild ID: ${GUILD_ID}`);
	console.log(`Lookback: ${DAYS_LOOKBACK} days`);
	console.log(`Analyzing conversations with ${MIN_MESSAGES}+ messages or ${MIN_DURATION_MINUTES}+ min duration`);
	console.log("━".repeat(80));

	const db = new PostgreSQLManager();
	await db.connect();

	try {
		// Initialize AI Manager and Topic Drift Detector
		const aiManager = AIManager.getInstance();
		const driftDetector = new TopicDriftDetector(db, { aiManager });

		// Get conversations from past N days
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - DAYS_LOOKBACK);

		console.log(`\n📊 Loading conversations since ${cutoffDate.toISOString()}...`);

		const conversationsResult = await db.query<ConversationSegment>(
			`SELECT 
				id,
				channel_id,
				participants,
				start_time,
				end_time,
				message_ids,
				message_count,
				summary,
				topic_label,
				topic_confidence
			FROM conversation_segments
			WHERE guild_id = $1
				AND start_time >= $2
				AND status = 'finalized'
				AND (message_count >= $3 OR EXTRACT(EPOCH FROM (end_time - start_time)) / 60 >= $4)
			ORDER BY start_time DESC`,
			[GUILD_ID, cutoffDate, MIN_MESSAGES, MIN_DURATION_MINUTES]
		);

		if (!conversationsResult.success || !conversationsResult.data) {
			console.error("❌ Failed to load conversations");
			process.exit(1);
		}

		const conversations = conversationsResult.data;
		console.log(`✓ Found ${conversations.length} conversations to analyze`);

		if (conversations.length === 0) {
			console.log("\n✓ No conversations to process");
			await db.disconnect();
			return;
		}

		let splitCount = 0;
		let analyzedCount = 0;

		for (const conv of conversations) {
			analyzedCount++;
			console.log(
				`\n[${analyzedCount}/${conversations.length}] Analyzing conversation ${conv.id}...`
			);
			console.log(
				`  Messages: ${conv.message_count}, Duration: ${Math.round((conv.end_time.getTime() - conv.start_time.getTime()) / (1000 * 60))} min`
			);

			// Load messages for this conversation
			const messagesResult = await db.query(
				`SELECT 
					id,
					author_id,
					content,
					created_at,
					embedding
				FROM messages
				WHERE id = ANY($1::text[])
					AND guild_id = $2
					AND active = true
				ORDER BY created_at ASC`,
				[conv.message_ids, GUILD_ID]
			);

			if (!messagesResult.success || !messagesResult.data) {
				console.log("  ⚠️  Failed to load messages, skipping");
				continue;
			}

			const messages = messagesResult.data.map((m: any) => ({
				id: m.id,
				author_id: m.author_id,
				content: m.content || "",
				created_at: m.created_at,
				embedding: m.embedding,
			}));

			// Analyze for topic splits
			try {
				const splits = await driftDetector.analyzeConversationForSplits(
					messages,
					GUILD_ID,
					"system"
				);

				if (splits.length === 0) {
					console.log("  ✓ No topic drift detected");
					
					// Generate topic label if missing
					if (!conv.topic_label) {
						const topicLabel = await driftDetector.generateTopicLabel(
							messages,
							GUILD_ID,
							"system"
						);
						
						await db.query(
							`UPDATE conversation_segments
							SET topic_label = $1, topic_confidence = $2
							WHERE id = $3`,
							[topicLabel.label, topicLabel.confidence, conv.id]
						);
						
						console.log(`  ✓ Generated topic label: "${topicLabel.label}"`);
					}
					continue;
				}

				console.log(`  🔸 Detected ${splits.length} split point(s):`);
				for (const split of splits) {
					console.log(
						`    - At message ${split.splitIndex}: "${split.beforeTopic}" → "${split.afterTopic}"`
					);
				}

				// Create split segments
				let segmentStart = 0;
				const newSegments: Array<{
					messageIds: string[];
					startTime: Date;
					endTime: Date;
					topicLabel: string;
					splitReason: string;
				}> = [];

				for (let i = 0; i < splits.length; i++) {
					const split = splits[i]!;
					const segmentMessages = messages.slice(segmentStart, split.splitIndex);

					if (segmentMessages.length >= 3) {
						newSegments.push({
							messageIds: segmentMessages.map((m) => m.id),
							startTime: segmentMessages[0]!.created_at,
							endTime: segmentMessages[segmentMessages.length - 1]!.created_at,
							topicLabel: split.beforeTopic,
							splitReason: split.reason,
						});
					}

					segmentStart = split.splitIndex;
				}

				// Add final segment
				const finalMessages = messages.slice(segmentStart);
				if (finalMessages.length >= 3) {
					const lastSplit = splits[splits.length - 1]!;
					newSegments.push({
						messageIds: finalMessages.map((m) => m.id),
						startTime: finalMessages[0]!.created_at,
						endTime: finalMessages[finalMessages.length - 1]!.created_at,
						topicLabel: lastSplit.afterTopic,
						splitReason: `Final segment after split at ${lastSplit.splitIndex}`,
					});
				}

				if (newSegments.length < 2) {
					console.log("  ⚠️  Not enough valid segments after split, keeping original");
					continue;
				}

				// Mark original conversation as parent
				await db.query(
					`UPDATE conversation_segments
					SET split_reason = $1
					WHERE id = $2`,
					[`Split into ${newSegments.length} segments by topic drift`, conv.id]
				);

				// Insert new segments
				for (let i = 0; i < newSegments.length; i++) {
					const segment = newSegments[i]!;
					const segmentId = `${conv.id}_topic_${i + 1}`;

					// Get unique participants
					const participantSet = new Set<string>();
					for (const msgId of segment.messageIds) {
						const msg = messages.find((m) => m.id === msgId);
						if (msg) participantSet.add(msg.author_id);
					}
					const participants = Array.from(participantSet);

					await db.query(
						`INSERT INTO conversation_segments (
							id,
							guild_id,
							channel_id,
							participants,
							start_time,
							end_time,
							message_ids,
							message_count,
							topic_label,
							topic_confidence,
							parent_segment_id,
							split_reason,
							status,
							features
						) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'finalized', '{}'::jsonb)`,
						[
							segmentId,
							GUILD_ID,
							conv.channel_id,
							participants,
							segment.startTime,
							segment.endTime,
							segment.messageIds,
							segment.messageIds.length,
							segment.topicLabel,
							splits[Math.min(i, splits.length - 1)]!.confidence,
							conv.id,
							segment.splitReason,
						]
					);

					console.log(
						`  ✓ Created segment ${i + 1}/${newSegments.length}: "${segment.topicLabel}" (${segment.messageIds.length} messages)`
					);
				}

				splitCount++;
			} catch (error) {
				console.error(`  ❌ Error analyzing conversation:`, error);
			}
		}

		console.log("\n" + "━".repeat(80));
		console.log("✓ Analysis complete!");
		console.log(`  Analyzed: ${analyzedCount} conversations`);
		console.log(`  Split: ${splitCount} conversations`);
		console.log(
			`  Unchanged: ${analyzedCount - splitCount} conversations`
		);
		console.log("━".repeat(80));
	} catch (error) {
		console.error("\n❌ Fatal error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

main().catch((err) => {
	console.error("💥 Uncaught error:", err);
	process.exit(1);
});
