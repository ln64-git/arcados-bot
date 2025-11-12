import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

const BOT_USER_ID = "1290873223944343714";
const WELCOME_CHANNEL = "1254698271914590208";
const MAIN_CHANNEL = "1254695279311978526";

async function debugChannelMentions(): Promise<void> {
	console.log("🔍 Debugging channel mention distribution...\n");

	const db = new PostgreSQLManager();

	try {
		await db.connect();

		// Check what channels have bot mentions
		const result = await db.query(
			`SELECT
				m.channel_id,
				c.name as channel_name,
				COUNT(*) as mention_count
			FROM messages m
			LEFT JOIN channels c ON m.channel_id = c.id AND m.guild_id = c.guild_id
			WHERE m.content LIKE '%${BOT_USER_ID}%'
				OR m.content ILIKE '%arcados%'
				OR m.content ILIKE '%@bot%'
			GROUP BY m.channel_id, c.name
			ORDER BY mention_count DESC
			LIMIT 10`,
			[]
		);

		console.log("📊 Channel breakdown:");
		console.table(result.data);

		// Check specific channels you mentioned
		const welcomeCheck = await db.query(
			`SELECT COUNT(*) as count
			FROM messages
			WHERE channel_id = $1
				AND (content LIKE '%${BOT_USER_ID}%' OR content ILIKE '%arcados%' OR content ILIKE '%@bot%')`,
			[WELCOME_CHANNEL]
		);

		const mainChannelCheck = await db.query(
			`SELECT COUNT(*) as count
			FROM messages
			WHERE channel_id = $1
				AND (content LIKE '%${BOT_USER_ID}%' OR content ILIKE '%arcados%' OR content ILIKE '%@bot%')`,
			[MAIN_CHANNEL]
		);

		console.log("\n📍 Specific channel checks:");
		console.log(
			`Welcome channel (${WELCOME_CHANNEL}):`,
			welcomeCheck.data?.[0]?.count || 0
		);
		console.log(
			`Main channel (${MAIN_CHANNEL}):`,
			mainChannelCheck.data?.[0]?.count || 0
		);

		// Check if channel names are correct
		const channelInfo = await db.query(
			`SELECT id, name, type
			FROM channels
			WHERE id = ANY($1)`,
			[[WELCOME_CHANNEL, MAIN_CHANNEL]]
		);

		console.log("\n🏷️ Channel info:");
		console.table(channelInfo.data);

		// Sample some messages from each channel
		console.log("\n📝 Sample messages from main channel:");
		const mainSamples = await db.query(
			`SELECT id, content, created_at, channel_id
			FROM messages
			WHERE channel_id = $1
				AND (content LIKE '%${BOT_USER_ID}%' OR content ILIKE '%arcados%' OR content ILIKE '%@bot%')
			ORDER BY created_at DESC
			LIMIT 5`,
			[MAIN_CHANNEL]
		);

		for (const msg of mainSamples.data || []) {
			console.log(
				`  - [${msg.created_at}] Channel: ${msg.channel_id}\n    ${msg.content.substring(0, 100)}...`
			);
		}

		console.log("\n📝 Sample messages from welcome channel:");
		const welcomeSamples = await db.query(
			`SELECT id, content, created_at, channel_id
			FROM messages
			WHERE channel_id = $1
				AND (content LIKE '%${BOT_USER_ID}%' OR content ILIKE '%arcados%' OR content ILIKE '%@bot%')
			ORDER BY created_at DESC
			LIMIT 5`,
			[WELCOME_CHANNEL]
		);

		for (const msg of welcomeSamples.data || []) {
			console.log(
				`  - [${msg.created_at}] Channel: ${msg.channel_id}\n    ${msg.content.substring(0, 100)}...`
			);
		}

		console.log("\n✅ Debug complete!\n");
	} catch (error) {
		console.error("❌ Error:", error);
	} finally {
		await db.disconnect();
	}
}

debugChannelMentions().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
