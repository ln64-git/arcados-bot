import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { AIManager } from "../features/ai-assistant/AIManager";
import { TopicDriftDetector } from "../features/relationship-network/TopicDriftDetector";

const GUILD_ID = process.env.GUILD_ID || "1254694808228986912";
const conversationId = process.argv[2];

interface Message {
	id: string;
	author_id: string;
	author_name: string;
	content: string;
	created_at: Date;
	embedding?: number[];
}

async function main() {
	if (!conversationId) {
		console.error("\n❌ Error: Conversation ID required");
		console.error("Usage: npm run analyze:topic-drift <conversation_id>\n");
		console.error("Example: npm run analyze:topic-drift conv_123456\n");
		process.exit(1);
	}

	console.log("\n🔍 Topic Drift Analysis");
	console.log("━".repeat(80));
	console.log(`Conversation ID: ${conversationId}`);
	console.log(`Guild ID: ${GUILD_ID}`);
	console.log("━".repeat(80));

	const db = new PostgreSQLManager();
	await db.connect();

	try {
		// Load conversation
		const convResult = await db.query(
			`SELECT 
				id,
				channel_id,
				participants,
				start_time,
				end_time,
				message_ids,
				message_count,
				topic_label,
				topic_confidence,
				split_reason
			FROM conversation_segments
			WHERE id = $1 AND guild_id = $2`,
			[conversationId, GUILD_ID]
		);

		if (!convResult.success || !convResult.data || convResult.data.length === 0) {
			console.error("❌ Conversation not found");
			process.exit(1);
		}

		const conversation = convResult.data[0]!;
		console.log("\n📊 Conversation Info:");
		console.log(`  Messages: ${conversation.message_count}`);
		const duration = Math.round(
			(new Date(conversation.end_time).getTime() -
				new Date(conversation.start_time).getTime()) /
				(1000 * 60)
		);
		console.log(`  Duration: ${duration} minutes`);
		console.log(`  Participants: ${conversation.participants.length}`);
		if (conversation.topic_label) {
			console.log(
				`  Current Topic: "${conversation.topic_label}" (confidence: ${(conversation.topic_confidence * 100).toFixed(0)}%)`
			);
		}
		if (conversation.split_reason) {
			console.log(`  Split Info: ${conversation.split_reason}`);
		}

		// Load messages
		const messagesResult = await db.query(
			`SELECT 
				m.id,
				m.author_id,
				m.content,
				m.created_at,
				m.embedding,
				mem.display_name as author_name
			FROM messages m
			LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
			WHERE m.id = ANY($1::text[])
				AND m.guild_id = $2
				AND m.active = true
			ORDER BY m.created_at ASC`,
			[conversation.message_ids, GUILD_ID]
		);

		if (!messagesResult.success || !messagesResult.data) {
			console.error("❌ Failed to load messages");
			process.exit(1);
		}

		const messages: Message[] = messagesResult.data.map((m: any) => {
			// Parse embedding from database (handle PostgreSQL array format)
			let embedding: number[] | undefined = undefined;
			if (m.embedding) {
				if (Array.isArray(m.embedding)) {
					embedding = m.embedding as number[];
				} else if (typeof m.embedding === 'string') {
					// Parse PostgreSQL array format: "{1,2,3}" or JSON array format: "[1,2,3]"
					try {
						const embeddingStr: string = m.embedding;
						let cleaned: string = embeddingStr.trim();
						// Convert PostgreSQL array format {1,2,3} to JSON array format [1,2,3]
						if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
							cleaned = '[' + cleaned.slice(1, -1) + ']';
						}
						embedding = JSON.parse(cleaned) as number[];
					} catch {
						// Silently skip if parsing fails
					}
				}
			}
			
			return {
				id: m.id,
				author_id: m.author_id,
				author_name: m.author_name || "Unknown",
				content: m.content || "(no content)",
				created_at: new Date(m.created_at),
				embedding: embedding,
			};
		});

		console.log(`\n✓ Loaded ${messages.length} messages`);

		// Initialize AI and drift detector
		const aiManager = AIManager.getInstance();
		const driftDetector = new TopicDriftDetector(db, { aiManager });

		// Analyze for topic drift
		console.log("\n🔍 Analyzing for topic drift...\n");

		const splits = await driftDetector.analyzeConversationForSplits(
			messages,
			GUILD_ID,
			"system"
		);

		if (splits.length === 0) {
			console.log("✓ No topic drift detected - conversation appears cohesive\n");
		} else {
			console.log(`🔸 Detected ${splits.length} potential split point(s):\n`);

			for (let i = 0; i < splits.length; i++) {
				const split = splits[i]!;
				console.log(`Split #${i + 1}:`);
				console.log(`  Position: Message ${split.splitIndex} of ${messages.length}`);
				console.log(`  Before: "${split.beforeTopic}"`);
				console.log(`  After: "${split.afterTopic}"`);
				console.log(
					`  Confidence: ${(split.confidence * 100).toFixed(0)}%`
				);
				console.log(`  Reason: ${split.reason}`);
				console.log();
			}
		}

		// Calculate semantic similarity scores across conversation
		console.log("📈 Semantic Similarity Analysis:\n");

		const windowSize = 5;
		const embeddingsWithIndexes: Array<{
			index: number;
			embedding: number[];
		}> = [];

		for (let i = 0; i < messages.length; i++) {
			if (messages[i]!.embedding) {
				embeddingsWithIndexes.push({
					index: i,
					embedding: messages[i]!.embedding!,
				});
			}
		}

		if (embeddingsWithIndexes.length < 2) {
			console.log("⚠️  Not enough embeddings to calculate similarity\n");
		} else {
			// Calculate similarity between consecutive windows
			for (let i = 0; i < embeddingsWithIndexes.length - 1; i += windowSize) {
				const start1 = i;
				const end1 = Math.min(i + windowSize, embeddingsWithIndexes.length);
				const start2 = end1;
				const end2 = Math.min(start2 + windowSize, embeddingsWithIndexes.length);

				if (start2 >= embeddingsWithIndexes.length) break;

				// Calculate average embeddings for each window
				const window1Embeddings = embeddingsWithIndexes
					.slice(start1, end1)
					.map((e) => e.embedding);
				const window2Embeddings = embeddingsWithIndexes
					.slice(start2, end2)
					.map((e) => e.embedding);

				const avg1 = calculateAverageEmbedding(window1Embeddings);
				const avg2 = calculateAverageEmbedding(window2Embeddings);

				if (avg1 && avg2) {
					const similarity = cosineSimilarity(avg1, avg2);
					const msgRange1 = `${embeddingsWithIndexes[start1]!.index + 1}-${embeddingsWithIndexes[end1 - 1]!.index + 1}`;
					const msgRange2 = `${embeddingsWithIndexes[start2]!.index + 1}-${embeddingsWithIndexes[end2 - 1]!.index + 1}`;

					const bar = "█".repeat(Math.round(similarity * 20));
					const drift = similarity < 0.65 ? " ⚠️ LOW SIMILARITY" : "";
					console.log(
						`  Messages ${msgRange1.padStart(6)} → ${msgRange2.padStart(6)}: ${bar.padEnd(20)} ${(similarity * 100).toFixed(1)}%${drift}`
					);
				}
			}
			console.log();
		}

		// Show message timeline with topic labels
		console.log("📝 Message Timeline:\n");

		let currentSegmentIndex = 0;
		const splitIndices = splits.map((s) => s.splitIndex);

		for (let i = 0; i < Math.min(messages.length, 50); i++) {
			const msg = messages[i]!;
			const time = msg.created_at.toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
			});
			const content =
				msg.content.length > 60
					? msg.content.substring(0, 60) + "..."
					: msg.content;

			// Check if this is a split point
			if (splitIndices.includes(i)) {
				const split = splits.find((s) => s.splitIndex === i)!;
				console.log();
				console.log("  " + "─".repeat(76));
				console.log(
					`  🔀 TOPIC CHANGE: "${split.beforeTopic}" → "${split.afterTopic}"`
				);
				console.log("  " + "─".repeat(76));
				console.log();
				currentSegmentIndex++;
			}

			console.log(`  [${time}] ${msg.author_name}: ${content}`);
		}

		if (messages.length > 50) {
			console.log(`\n  ... (${messages.length - 50} more messages)`);
		}

		console.log("\n" + "━".repeat(80));

		if (splits.length > 0) {
			console.log("\n💡 Recommendations:");
			console.log(
				`  This conversation could be split into ${splits.length + 1} segments:`
			);

			let segmentStart = 0;
			for (let i = 0; i <= splits.length; i++) {
				const segmentEnd =
					i < splits.length ? splits[i]!.splitIndex : messages.length;
				const segmentSize = segmentEnd - segmentStart;
				const topic =
					i < splits.length
						? splits[i]!.beforeTopic
						: splits[splits.length - 1]!.afterTopic;

				console.log(
					`  ${i + 1}. Messages ${segmentStart + 1}-${segmentEnd}: "${topic}" (${segmentSize} messages)`
				);

				segmentStart = segmentEnd;
			}

			console.log(
				`\n  To split this conversation, run: GUILD_ID=${GUILD_ID} npm run split:conversations`
			);
		} else {
			console.log("\n✓ This conversation appears cohesive - no splits recommended");
		}

		console.log();
	} catch (error) {
		console.error("\n❌ Error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

function calculateAverageEmbedding(embeddings: number[][]): number[] | null {
	if (embeddings.length === 0) return null;

	const dim = embeddings[0]!.length;
	const avg = new Array(dim).fill(0);

	for (const emb of embeddings) {
		if (emb.length !== dim) continue;
		for (let i = 0; i < dim; i++) {
			avg[i] += emb[i]!;
		}
	}

	for (let i = 0; i < dim; i++) {
		avg[i] /= embeddings.length;
	}

	return avg;
}

function cosineSimilarity(vec1: number[], vec2: number[]): number {
	if (vec1.length !== vec2.length || vec1.length === 0) return 0;

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < vec1.length; i++) {
		dotProduct += vec1[i]! * vec2[i]!;
		normA += vec1[i]! * vec1[i]!;
		normB += vec2[i]! * vec2[i]!;
	}

	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	if (denominator === 0) return 0;

	const similarity = dotProduct / denominator;
	return (similarity + 1) / 2; // Normalize to 0-1
}

main().catch((err) => {
	console.error("💥 Uncaught error:", err);
	process.exit(1);
});
