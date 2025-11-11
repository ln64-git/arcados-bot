import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

async function listActiveChannels() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		const guildId = process.env.GUILD_ID;
		if (!guildId) {
			console.error("\n❌ Error: GUILD_ID required in .env");
			return;
		}

		const twentyFourHoursAgo = new Date();
		twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

		console.log("\n📊 Active Channels (Past 24 Hours)\n");
		console.log("═".repeat(80));

		// Get channels with messages in the last 24 hours
		const result = await db.query(
			`SELECT
				c.id,
				c.name,
				c.type,
				COUNT(m.id) as message_count,
				COUNT(DISTINCT m.author_id) as unique_authors,
				MIN(m.created_at) as first_message,
				MAX(m.created_at) as last_message
			FROM channels c
			JOIN messages m ON m.channel_id = c.id AND m.active = true
			WHERE c.guild_id = $1
				AND m.created_at >= $2
			GROUP BY c.id, c.name, c.type
			ORDER BY message_count DESC
			LIMIT 20`,
			[guildId, twentyFourHoursAgo]
		);

		if (!result.success || !result.data || result.data.length === 0) {
			console.log("No active channels found in the past 24 hours\n");
			await db.disconnect();
			return;
		}

		for (const channel of result.data) {
			console.log(`\n📍 ${channel.name || "Unknown"}`);
			console.log(`   Channel ID: ${channel.id}`);
			console.log(`   Type: ${channel.type || "text"}`);
			console.log(`   Messages: ${channel.message_count}`);
			console.log(`   Unique Authors: ${channel.unique_authors}`);
			console.log(
				`   First: ${new Date(channel.first_message).toLocaleString()}`
			);
			console.log(
				`   Last: ${new Date(channel.last_message).toLocaleString()}`
			);
		}

		console.log("\n═".repeat(80));
		console.log(
			"\nTo analyze a channel, run:\nnpm run analyze:conversation-accuracy <channel_id>\n"
		);

		await db.disconnect();
	} catch (error) {
		console.error(
			`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`
		);
		await db.disconnect();
		process.exit(1);
	}
}

listActiveChannels();
