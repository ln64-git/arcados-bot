import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function testSimpleMessageInsert() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test with minimal fields
		console.log("🔹 Testing minimal message insert...");
		try {
			const result = await db.db.query(`
				CREATE messages:test_minimal SET
					content = 'Minimal test message',
					active = true
			`);
			console.log("🔹 Minimal insert result:", result);
		} catch (error) {
			console.log("🔸 Minimal insert failed:", error.message);
		}

		// Test with snake_case fields
		console.log("🔹 Testing snake_case fields...");
		try {
			const result = await db.db.query(`
				CREATE messages:test_snake_case SET
					channel_id = '1430111461547446402',
					guild_id = '1254694808228986912',
					author_id = '99195129516007424',
					content = 'Snake case test message',
					created_at = '${new Date().toISOString()}',
					updated_at = '${new Date().toISOString()}',
					active = true
			`);
			console.log("🔹 Snake case result:", result);
		} catch (error) {
			console.log("🔸 Snake case failed:", error.message);
		}

		// Test with camelCase fields
		console.log("🔹 Testing camelCase fields...");
		try {
			const result = await db.db.query(`
				CREATE messages:test_camel_case SET
					channelId = '1430111461547446402',
					guildId = '1254694808228986912',
					authorId = '99195129516007424',
					content = 'Camel case test message',
					createdAt = '${new Date().toISOString()}',
					updatedAt = '${new Date().toISOString()}',
					active = true
			`);
			console.log("🔹 Camel case result:", result);
		} catch (error) {
			console.log("🔸 Camel case failed:", error.message);
		}

		// Query all messages
		console.log("🔹 Querying all messages...");
		const allMessages = await db.db.query("SELECT * FROM messages");
		console.log("🔹 All messages count:", allMessages[0]?.length || 0);

	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testSimpleMessageInsert().catch(console.error);
