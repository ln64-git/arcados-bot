#!/usr/bin/env bun
/**
 * Regenerate Conversations Script
 *
 * Processes existing messages in the database to create conversation segments.
 * This is useful when:
 * - The bot was offline and missed messages
 * - You want to reprocess historical messages with updated algorithms
 * - The conversation tables need to be rebuilt
 */

import { PostgreSQLManager } from "../../../../database/PostgreSQLManager";
import { ConversationDetector } from "../ConversationDetector";
import { config } from "../../../../config/index.js";

interface Message {
	id: string;
	author_id: string;
	content: string;
	created_at: Date;
	guild_id: string;
	channel_id: string;
	referenced_message_id: string | null;
}

const db = new PostgreSQLManager();

async function main() {
	// Parse command line arguments
	const args = process.argv.slice(2);
	const hoursBack = args[0] ? Number.parseInt(args[0], 10) : 24;
	const clearExisting = args.includes("--clear");

	console.log("🔄 Regenerating Conversations");
	console.log("=".repeat(80));
	console.log(`Time window: Past ${hoursBack} hours`);
	console.log(`Clear existing: ${clearExisting ? "YES" : "NO"}`);
	console.log("=".repeat(80));

	const connected = await db.connect();
	if (!connected) {
		console.error("❌ Failed to connect to database");
		console.error("💡 Make sure POSTGRES_URL is set in your .env file");
		process.exit(1);
	}

	const guildId = config.guildId;
	if (!guildId) {
		console.error("❌ No guild ID configured");
		console.error("💡 Set GUILD_ID in your .env file");
		await db.disconnect();
		process.exit(1);
	}

	// Clear existing conversations if requested
	if (clearExisting) {
		console.log("\n🗑️  Clearing existing conversations...");
		await db.query(
			"DELETE FROM streaming_conversations WHERE guild_id = $1",
			[guildId]
		);
		await db.query("DELETE FROM conversation_segments WHERE guild_id = $1", [
			guildId,
		]);
		console.log("✅ Cleared existing conversations");
	}

	// Initialize conversation detector
	console.log("\n🔧 Initializing conversation detector...");
	const detector = new ConversationDetector(db);

	// Fetch all messages from the specified time window
	console.log(
		`\n📥 Fetching messages from the past ${hoursBack} hours...`
	);
	const messagesResult = await db.query(
		`
    SELECT
      m.id,
      m.author_id,
      m.content,
      m.created_at,
      m.guild_id,
      m.channel_id,
      m.referenced_message_id
    FROM messages m
    LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
    LEFT JOIN channels c ON m.channel_id = c.id
    WHERE m.guild_id = $1
      AND m.created_at > NOW() - INTERVAL '${hoursBack} hours'
      AND m.active = true
      AND COALESCE(mem.bot, false) = false
      AND COALESCE(c.name, '') NOT IN ('vc-logs', 'mod-logs', 'server-logs', 'audit-logs')
    ORDER BY m.created_at ASC
    `,
		[guildId]
	);

	if (!messagesResult.success) {
		console.error("❌ Failed to fetch messages:", messagesResult.error);
		await db.disconnect();
		process.exit(1);
	}

	const messages: Message[] = messagesResult.data || [];
	console.log(`✅ Found ${messages.length} messages to process`);

	if (messages.length === 0) {
		console.log("\n⚠️  No messages found in the specified time window");
		await db.disconnect();
		process.exit(0);
	}

	// Process messages in chronological order
	console.log("\n⚙️  Processing messages into conversations...");
	let processedCount = 0;
	const batchSize = 100;

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (!message) continue;

		try {
			await detector.addMessageToStream({
				id: message.id,
				author_id: message.author_id,
				content: message.content || "",
				created_at: message.created_at,
				guild_id: message.guild_id,
				channel_id: message.channel_id,
				referenced_message_id: message.referenced_message_id || undefined,
				mentioned_user_ids: [],
			});

			processedCount++;

			// Show progress every 100 messages
			if (processedCount % batchSize === 0) {
				const progress = Math.round((processedCount / messages.length) * 100);
				console.log(
					`   📊 Progress: ${processedCount}/${messages.length} (${progress}%)`
				);
			}
		} catch (error) {
			console.error(`⚠️  Failed to process message ${message.id}:`, error);
		}
	}

	console.log(
		`✅ Processed ${processedCount}/${messages.length} messages`
	);

	// Flush all inactive buffers to finalize conversations
	console.log("\n🔄 Finalizing conversations...");
	await detector.flushInactiveBuffers();
	console.log("✅ Conversations finalized");

	// Show summary statistics
	const streamingResult = await db.query(
		`SELECT COUNT(*) as count FROM streaming_conversations WHERE guild_id = $1`,
		[guildId]
	);
	const finalizedResult = await db.query(
		`SELECT COUNT(*) as count FROM conversation_segments WHERE guild_id = $1`,
		[guildId]
	);

	const streamingCount =
		streamingResult.success && streamingResult.data?.[0]?.count
			? streamingResult.data[0].count
			: 0;
	const finalizedCount =
		finalizedResult.success && finalizedResult.data?.[0]?.count
			? finalizedResult.data[0].count
			: 0;

	console.log("\n📊 SUMMARY");
	console.log("=".repeat(80));
	console.log(`Messages processed: ${processedCount}`);
	console.log(`Streaming conversations: ${streamingCount}`);
	console.log(`Finalized conversations: ${finalizedCount}`);
	console.log(
		`Total conversations: ${Number(streamingCount) + Number(finalizedCount)}`
	);
	console.log("=".repeat(80));

	console.log("\n✅ Regeneration complete");
	console.log(
		"💡 Run 'npm run view-conversations' to view the results\n"
	);

	await db.disconnect();
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});
