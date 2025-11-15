import "dotenv/config";
import { config } from "../config/index.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { ConversationManager } from "../features/relationship-network/ConversationManager.js";
import { KNOWN_BOT_USER_IDS } from "../features/relationship-network/constants.js";
import { AIManager } from "../features/ai-assistant/AIManager.js";

async function regenerateConversationsAdvanced() {
	const db = new PostgreSQLManager();
	const conversationManager = new ConversationManager(db);
	if (config.enableTopicSplitting) {
		conversationManager.setAIManager(AIManager.getInstance());
	}

	try {
		console.log("🔹 Connecting to database...");
		const connected = await db.connect();
		if (!connected) {
			console.error("🔸 Failed to connect");
			return;
		}

		console.log("✅ Connected\n");

		// Get guild ID and optional channel ID from command line args or env
		const guildId = process.argv[2] || process.env.GUILD_ID;
		const channelId = process.argv[3]; // Optional: regenerate single channel

		if (!guildId) {
			console.error("🔸 Usage: npm run regenerate:conversations:advanced <guild_id> [channel_id]");
			console.error("   Or set GUILD_ID in .env");
			return;
		}

		console.log(
			`🔹 Regenerating conversations for guild: ${guildId}${channelId ? ` (channel: ${channelId})` : ""}\n`
		);

		// Clear existing conversation segments
		console.log("🗑️  Clearing existing conversation segments...");
		const clearQuery = channelId
			? "DELETE FROM conversation_segments WHERE guild_id = $1 AND channel_id = $2"
			: "DELETE FROM conversation_segments WHERE guild_id = $1";
		const clearParams = channelId ? [guildId, channelId] : [guildId];

		const clearResult = await db.query(clearQuery, clearParams);
		if (clearResult.success) {
			const rowCount = (clearResult.data as any)?.rowCount || 0;
			console.log(
				`   ✅ Cleared ${rowCount} conversation segments\n`
			);
		} else {
			console.error(
				`   🔸 Failed to clear segments: ${clearResult.error}`
			);
			return;
		}

		// Fetch channels to process
		const channelsQuery = channelId
			? "SELECT DISTINCT channel_id FROM messages WHERE guild_id = $1 AND channel_id = $2 AND active = true"
			: "SELECT DISTINCT channel_id FROM messages WHERE guild_id = $1 AND active = true";
		const channelsParams = channelId ? [guildId, channelId] : [guildId];

		const channelsResult = await db.query(channelsQuery, channelsParams);
		if (!channelsResult.success || !channelsResult.data) {
			console.error("🔸 Failed to fetch channels:", channelsResult.error);
			return;
		}

		const channels = channelsResult.data as Array<{ channel_id: string }>;
		console.log(`🔹 Found ${channels.length} channel(s) to process\n`);

		let totalConversations = 0;
		let totalMessages = 0;

		// Process each channel
		for (const channel of channels) {
			const chId = channel.channel_id;
			console.log(`\n📍 Processing channel: ${chId}`);

			// Fetch all messages for this channel with embeddings
			// Exclude messages from known bots
			console.log("   🔹 Fetching messages with embeddings...");
			const messagesResult = await db.query(
				`
				SELECT id, author_id, content, created_at, referenced_message_id, embedding
				FROM messages
				WHERE guild_id = $1 AND channel_id = $2 AND active = true AND author_id != ALL($3::TEXT[])
				ORDER BY created_at ASC
			`,
				[guildId, chId, KNOWN_BOT_USER_IDS]
			);

			if (!messagesResult.success || !messagesResult.data) {
				console.error(`   🔸 Failed to fetch messages: ${messagesResult.error}`);
				continue;
			}

			const messages = messagesResult.data as Array<{
				id: string;
				author_id: string;
				content: string;
				created_at: Date;
				referenced_message_id?: string | null;
				embedding?: number[] | null;
			}>;

			console.log(`   🔹 Found ${messages.length} messages`);

			if (messages.length === 0) {
				console.log("   🔸 No messages to process");
				continue;
			}

			// Parse embeddings
			const parsedMessages = messages.map(m => {
				let embedding: number[] | undefined = undefined;
				if (m.embedding) {
					if (Array.isArray(m.embedding)) {
						embedding = m.embedding as number[];
					} else if (typeof m.embedding === 'string') {
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
					content: m.content,
					created_at: new Date(m.created_at),
					referenced_message_id: m.referenced_message_id || undefined,
					embedding
				};
			});

			// Count messages with embeddings
			const embeddingCount = parsedMessages.filter(m => m.embedding).length;
			const embeddingPercent = ((embeddingCount / parsedMessages.length) * 100).toFixed(1);
			console.log(`   📊 Embeddings: ${embeddingCount}/${parsedMessages.length} (${embeddingPercent}%)`);

			// Use advanced regeneration method
			console.log("   🔹 Processing with advanced algorithm...");
			const conversationsResult = await conversationManager.regenerateConversationsAdvanced(
				chId,
				guildId,
				parsedMessages
			);

			if (!conversationsResult.success || !conversationsResult.data) {
				console.error(`   🔸 Failed to process channel: ${conversationsResult.error}`);
				continue;
			}

			const conversations = conversationsResult.data;
			console.log(`   ✅ Generated ${conversations.length} conversations`);

			// Insert conversations into database
			console.log("   🔹 Inserting conversations into database...");
			let inserted = 0;
			for (const convo of conversations) {
				// Generate unique ID
				const segmentId = `seg_${chId}_${convo.start_time.getTime()}_${Math.random().toString(36).substring(7)}`;

				const insertResult = await db.query(
					`
					INSERT INTO conversation_segments (
						id, guild_id, channel_id, start_time, end_time,
						message_count, message_ids, participants, status
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				`,
					[
						segmentId,
						guildId,
						chId,
						convo.start_time,
						convo.end_time,
						convo.message_count,
						convo.message_ids,
						convo.participants,
						'finalized'
					]
				);

				if (insertResult.success) {
					inserted++;
				}
			}

			console.log(`   ✅ Inserted ${inserted}/${conversations.length} conversations`);

			totalConversations += inserted;
			totalMessages += parsedMessages.length;
		}

		console.log("\n" + "=".repeat(60));
		console.log("📊 Final Summary:");
		console.log(`   💬 Total conversations: ${totalConversations}`);
		console.log(`   📝 Total messages processed: ${totalMessages}`);
		console.log(`   📍 Channels processed: ${channels.length}`);
		if (totalMessages > 0) {
			const avgMsgsPerConvo = (totalMessages / totalConversations).toFixed(1);
			console.log(`   📈 Avg messages per conversation: ${avgMsgsPerConvo}`);
		}
		console.log("=".repeat(60));
		console.log("\n✅ Advanced regeneration complete!");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

regenerateConversationsAdvanced();
