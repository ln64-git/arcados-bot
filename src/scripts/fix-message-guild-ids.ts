import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function fixMessageGuildIds() {
	const db = new SurrealDBManager();

	try {
		console.log("🔹 Connecting to SurrealDB...");
		await db.connect();
		console.log("🔹 Connected successfully");

		const guildId = process.env.GUILD_ID;
		if (!guildId) {
			console.error("🔸 GUILD_ID not set in .env file.");
			return;
		}

		console.log(`🔹 Fixing guild_id for messages in guild: ${guildId}`);

		// Get all messages that have empty or undefined guild_id
		const result = await db.db.query(
			`SELECT id FROM messages WHERE guild_id = "" OR guild_id = NONE`,
		);

		if (result && result[0] && Array.isArray(result[0])) {
			const messageIds = result[0].map((row: any) => row.id);
			console.log(
				`🔹 Found ${messageIds.length} messages with missing guild_id`,
			);

			let fixed = 0;
			for (const messageId of messageIds) {
				try {
					await db.db.merge(`messages:${messageId}`, {
						guild_id: guildId,
						updated_at: new Date(),
					});
					fixed++;
					if (fixed % 50 === 0) {
						console.log(`🔹 Fixed ${fixed}/${messageIds.length} messages`);
					}
				} catch (error) {
					console.error(`🔸 Error fixing message ${messageId}:`, error);
				}
			}

			console.log(`🔹 Fixed ${fixed} messages with guild_id`);
		} else {
			console.log("🔹 No messages found with missing guild_id");
		}

		// Test the query again
		console.log("🔹 Testing query after fix...");
		const testResult = await db.db.query(
			`SELECT id FROM messages WHERE guild_id = '${guildId}' AND active = true LIMIT 10`,
		);
		console.log(
			`🔹 Found ${testResult?.[0]?.length || 0} messages with correct guild_id`,
		);
	} catch (error) {
		console.error("🔸 Error during fix:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

fixMessageGuildIds().catch(console.error);
