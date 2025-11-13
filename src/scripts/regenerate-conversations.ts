import "dotenv/config";
import { config } from "../config/index.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { ConversationManager } from "../features/relationship-network/ConversationManager.js";
import { KNOWN_BOT_USER_IDS } from "../features/relationship-network/constants.js";
import { AIManager } from "../features/ai-assistant/AIManager.js";
import {
	extractMentionedUserIds,
	parseEmbedding,
} from "../features/relationship-network/messageUtils.js";

export async function regenerateConversationsForGuild(guildId: string): Promise<void> {
	const db = new PostgreSQLManager();
	const conversationManager = new ConversationManager(db);
	if (config.enableTopicSplitting) {
		conversationManager.setAIManager(AIManager.getInstance());
	} else {
		console.log("🔸 ENABLE_TOPIC_SPLITTING is disabled; skipping AI topic splitting.");
	}

	try {
		console.log("🔹 Connecting to database...");
		const connected = await db.connect();
		if (!connected) {
			console.error("🔸 Failed to connect");
			return;
		}

		console.log("✅ Connected\n");

		console.log(
			`🔹 Regenerating conversations for guild: ${guildId}\n`
		);

		// Clear existing conversation segments
		console.log("🗑️  Clearing existing conversation segments...");
		const clearResult = await db.query(
			"DELETE FROM conversation_segments WHERE guild_id = $1",
			[guildId]
		);
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

		// Fetch all messages for the guild with embeddings, ordered chronologically
		// Exclude messages from known bots
		console.log("🔹 Fetching messages with embeddings (excluding bot messages)...");
		const messagesResult = await db.query(
			`
			SELECT id, guild_id, channel_id, author_id, content, created_at, referenced_message_id, embedding
			FROM messages
			WHERE guild_id = $1 AND active = true AND author_id != ALL($2::TEXT[])
			ORDER BY created_at ASC
		`,
			[guildId, KNOWN_BOT_USER_IDS]
		);

		if (!messagesResult.success || !messagesResult.data) {
			console.error(
				"🔸 Failed to fetch messages:",
				messagesResult.error
			);
			return;
		}

		const messages = messagesResult.data as Array<{
			id: string;
			guild_id: string;
			channel_id: string;
			author_id: string;
			content: string;
			created_at: Date;
			referenced_message_id?: string | null;
			embedding?: number[] | null;
		}>;

		console.log(`🔹 Found ${messages.length} messages\n`);

		if (messages.length === 0) {
			console.log("🔸 No messages to process");
			return;
		}

		// Process messages chronologically through ConversationManager
		// This will group them using the hybrid approach (replies, mentions, relationships, semantic)
		console.log("🔹 Processing messages through ConversationManager...\n");

		let processed = 0;

		// Extract mentions from content for each message
		const botUserIdSet = new Set(KNOWN_BOT_USER_IDS);

		for (const message of messages) {
			const mentionedUsers = extractMentionedUserIds(
				message.content,
				botUserIdSet
			);
			const embedding = parseEmbedding(message.embedding);

			await conversationManager.addMessageToStream({
				id: message.id,
				author_id: message.author_id,
				content: message.content,
				created_at: new Date(message.created_at),
				guild_id: message.guild_id,
				channel_id: message.channel_id,
				referenced_message_id: message.referenced_message_id || undefined,
				mentioned_user_ids:
					mentionedUsers.length > 0 ? mentionedUsers : undefined,
				embedding: embedding,
			});

			processed++;

			if (processed % 1000 === 0 || processed === messages.length) {
				console.log(
					`   📊 Processed ${processed}/${messages.length} messages`
				);
			}
		}

		// Finalize all remaining buffers to create final segments
		console.log("\n🔹 Finalizing remaining conversation buffers...");
		await conversationManager.finalizeAllSegments();

		console.log(`\n✅ Processed ${processed} messages\n`);

		// Final summary
		console.log("📊 Summary:");
		const segmentCountResult = await db.query(
			"SELECT COUNT(*) as count FROM conversation_segments WHERE guild_id = $1",
			[guildId]
		);

		if (segmentCountResult.success && segmentCountResult.data) {
			console.log(
				`   💬 Conversation segments: ${segmentCountResult.data[0].count}`
			);
		}

		console.log("\n✅ Regeneration complete!");
	} catch (error) {
		console.error("🔸 Error:", error);
		throw error;
	} finally {
		await db.disconnect();
	}
}

async function runFromCli() {
	const guildId =
		process.argv[2] || process.env.GUILD_ID || config.guildId;

	if (!guildId) {
		console.error(
			"🔸 Guild ID is required. Provide it as an argument or set GUILD_ID in your environment."
		);
		process.exit(1);
	}

	try {
		await regenerateConversationsForGuild(guildId);
	} catch (error) {
		console.error("🔸 Failed to regenerate conversations:", error);
		process.exit(1);
	}
}

const invokedDirectly =
	process.argv[1]?.includes("regenerate-conversations") ?? false;

if (invokedDirectly) {
	runFromCli();
}
