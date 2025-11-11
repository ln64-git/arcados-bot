import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

async function checkChannelMessages() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		const channelId = process.argv[2] || "1254694808228986912";
		const guildId = process.env.GUILD_ID;

		console.log(`\nChecking channel: ${channelId}`);
		console.log(`Guild: ${guildId}\n`);

		// Check if channel exists
		const channelResult = await db.query("SELECT id, name FROM channels WHERE id = $1", [
			channelId,
		]);
		console.log("Channel:", channelResult.data?.[0] || "❌ Not found");

		// Check messages in last 24h
		const twentyFourHoursAgo = new Date();
		twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

		const msgResult = await db.query(
			"SELECT COUNT(*) as count FROM messages WHERE channel_id = $1 AND created_at >= $2 AND active = true",
			[channelId, twentyFourHoursAgo]
		);
		console.log("Messages in last 24h:", msgResult.data?.[0]?.count || 0);

		// Check all messages for this channel
		const allMsgResult = await db.query(
			"SELECT COUNT(*) as count FROM messages WHERE channel_id = $1 AND active = true",
			[channelId]
		);
		console.log("Total messages ever:", allMsgResult.data?.[0]?.count || 0);

		// Get a sample message
		const sampleResult = await db.query(
			"SELECT id, created_at, content FROM messages WHERE channel_id = $1 AND active = true ORDER BY created_at DESC LIMIT 1",
			[channelId]
		);
		console.log("Latest message:", sampleResult.data?.[0] || "None");

		// Check segments for this channel
		const segmentResult = await db.query(
			"SELECT COUNT(*) as count FROM conversation_segments WHERE channel_id = $1",
			[channelId]
		);
		console.log("\nConversation segments:", segmentResult.data?.[0]?.count || 0);

		await db.disconnect();
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		await db.disconnect();
	}
}

checkChannelMessages();
