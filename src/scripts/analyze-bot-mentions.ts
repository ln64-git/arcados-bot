import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

const BOT_USER_ID = "1290873223944343714";

async function listBotMentions(): Promise<void> {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		// Query all messages mentioning the bot (by user ID only - most accurate)
		const mentionsResult = await db.query(
			`SELECT
				m.id,
				m.author_id,
				m.channel_id,
				m.content,
				m.created_at,
				m.referenced_message_id as reply_to_message_id,
				c.name as channel_name,
				mem.username,
				mem.display_name
			FROM messages m
			LEFT JOIN channels c ON m.channel_id = c.id AND m.guild_id = c.guild_id
			LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
			WHERE (m.content LIKE '%${BOT_USER_ID}%' OR m.content LIKE '%<@${BOT_USER_ID}>%')
				AND m.author_id != '${BOT_USER_ID}'
			ORDER BY m.created_at DESC`,
			[]
		);

		if (!mentionsResult.success || !mentionsResult.data) {
			console.error("❌ Failed to query mentions");
			return;
		}

		const mentions = mentionsResult.data;

		if (mentions.length === 0) {
			console.log("No mentions found.");
			return;
		}

		// List all mentions - just the message content, one per line
		for (const mention of mentions) {
			let content = mention.content || "(no content)";
			// Remove user ID mentions (both <@USER_ID> format and raw IDs)
			content = content.replace(/<@\d+>/g, '');
			content = content.replace(/\b\d{17,19}\b/g, ''); // Remove standalone user IDs (17-19 digits)
			content = content.replace(/\s+/g, ' '); // Normalize whitespace
			content = content.trim();
			console.log(content);
		}
	} catch (error) {
		console.error("❌ Error listing mentions:", error);
	} finally {
		await db.disconnect();
	}
}

// Run the listing
listBotMentions().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
