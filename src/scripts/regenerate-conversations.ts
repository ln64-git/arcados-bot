import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { ConversationManager } from "../features/relationship-network/ConversationManager.js";

async function regenerateConversations() {
	const db = new PostgreSQLManager();
	const conversationManager = new ConversationManager(db);

	try {
		console.log("🔹 Connecting to database...");
		const connected = await db.connect();
		if (!connected) {
			console.error("🔸 Failed to connect");
			return;
		}

		console.log("✅ Connected\n");

		// Get guild ID from command line args or env
		const guildId = process.argv[2] || process.env.GUILD_ID;

		if (!guildId) {
			console.error("🔸 Usage: npm run regenerate:conversations <guild_id>");
			console.error("   Or set GUILD_ID in .env");
			return;
		}

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
		console.log("🔹 Fetching messages with embeddings...");
		const messagesResult = await db.query(
			`
			SELECT id, guild_id, channel_id, author_id, content, created_at, referenced_message_id, embedding
			FROM messages
			WHERE guild_id = $1 AND active = true
			ORDER BY created_at ASC
		`,
			[guildId]
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
		const mentionRegex = /<@!?(\d+)>/g;

		for (const message of messages) {
			const mentionedUsers: string[] = [];
			let match;
			while ((match = mentionRegex.exec(message.content)) !== null) {
				mentionedUsers.push(match[1]);
			}

			// Parse embedding from database
			// pgvector can return as array or PostgreSQL array string format
			let embedding: number[] | undefined = undefined;
			if (message.embedding) {
				if (Array.isArray(message.embedding)) {
					embedding = message.embedding as number[];
				} else if (typeof message.embedding === 'string') {
					// Parse PostgreSQL array format: "{1,2,3}" or JSON array format: "[1,2,3]"
					try {
						let cleaned = message.embedding.trim();
						// Convert PostgreSQL array format {1,2,3} to JSON array format [1,2,3]
						if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
							cleaned = '[' + cleaned.slice(1, -1) + ']';
						}
						embedding = JSON.parse(cleaned) as number[];
					} catch {
						// Silently skip if parsing fails (embedding will be undefined)
					}
				}
			}

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
	} finally {
		await db.disconnect();
	}
}

regenerateConversations();
