import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function debugMessageData() {
	const db = new SurrealDBManager();

	try {
		console.log("🔹 Connecting to SurrealDB...");
		await db.connect();
		console.log("🔹 Connected successfully");

		const guildId = "1004111007611895808"; // The Hearth guild (the one being synced)
		if (!guildId) {
			console.error("🔸 GUILD_ID not set in .env file.");
			return;
		}

		console.log(`🔹 Debugging message data for guild: ${guildId}`);

		// Test different query variations
		console.log("🔹 Test 1: Query with exact guild_id");
		const test1 = await db.db.query(
			`SELECT id, guild_id FROM messages WHERE guild_id = '${guildId}' LIMIT 5`,
		);
		console.log("Result 1:", test1);

		console.log("🔹 Test 2: Query with guild_id containing the value");
		const test2 = await db.db.query(
			`SELECT id, guild_id FROM messages WHERE guild_id CONTAINS '${guildId}' LIMIT 5`,
		);
		console.log("Result 2:", test2);

		console.log("🔹 Test 3: Get all messages and check guild_id values");
		const test3 = await db.db.query(
			`SELECT id, guild_id FROM messages LIMIT 10`,
		);
		console.log("Result 3:", test3);

		console.log("🔹 Test 4: Check if guild_id field exists");
		const test4 = await db.db.query(
			`SELECT id, guild_id FROM messages WHERE guild_id IS NOT NONE LIMIT 5`,
		);
		console.log("Result 4:", test4);
	} catch (error) {
		console.error("🔸 Error during debug:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

debugMessageData().catch(console.error);
