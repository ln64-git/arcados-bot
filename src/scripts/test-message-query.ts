import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function testMessageQuery() {
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

		console.log(`🔹 Testing message queries for guild: ${guildId}`);

		// Test 1: Direct SQL query
		console.log("🔹 Test 1: Direct SQL query");
		try {
			const result = await db.db.query(
				`SELECT id FROM messages WHERE guild_id = '${guildId}' AND active = true LIMIT 10`,
			);
			console.log("🔹 SQL Query result:", result);
		} catch (error) {
			console.error("🔸 SQL Query error:", error);
		}

		// Test 2: Using getExistingMessageIds method
		console.log("🔹 Test 2: Using getExistingMessageIds method");
		const messageIds = await db.getExistingMessageIds(guildId);
		console.log(
			`🔹 Found ${messageIds.length} message IDs:`,
			messageIds.slice(0, 5),
		);

		// Test 3: Count all messages
		console.log("🔹 Test 3: Count all messages");
		try {
			const countResult = await db.db.query(`SELECT count() FROM messages`);
			console.log("🔹 Total message count:", countResult);
		} catch (error) {
			console.error("🔸 Count query error:", error);
		}

		// Test 4: Get a few sample messages
		console.log("🔹 Test 4: Get sample messages");
		try {
			const sampleResult = await db.db.query(
				`SELECT id, guild_id, active FROM messages LIMIT 5`,
			);
			console.log("🔹 Sample messages:", sampleResult);
		} catch (error) {
			console.error("🔸 Sample query error:", error);
		}
	} catch (error) {
		console.error("🔸 Error during test:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testMessageQuery().catch(console.error);
