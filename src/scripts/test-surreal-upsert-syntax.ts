import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function testSurrealDBUpsertSyntax() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test 1: Try ON DUPLICATE KEY UPDATE syntax
		console.log("🔹 Test 1: Testing ON DUPLICATE KEY UPDATE syntax...");
		try {
			const result1 = await db.db.query(`
				INSERT INTO messages (id, channel_id, guild_id, author_id, content, timestamp, attachments, embeds, created_at, updated_at, active)
				VALUES ('test-upsert-1', '1430111461547446402', '1254694808228986912', '99195129516007424', 'Test message 1', '${new Date().toISOString()}', [], [], '${new Date().toISOString()}', '${new Date().toISOString()}', true)
				ON DUPLICATE KEY UPDATE
					content = 'Updated message 1',
					updated_at = '${new Date().toISOString()}'
			`);
			console.log("🔹 ON DUPLICATE KEY UPDATE result:", result1);
		} catch (error) {
			console.log("🔸 ON DUPLICATE KEY UPDATE failed:", error.message);
		}

		// Test 2: Try ON CONFLICT syntax
		console.log("🔹 Test 2: Testing ON CONFLICT syntax...");
		try {
			const result2 = await db.db.query(`
				INSERT INTO messages (id, channel_id, guild_id, author_id, content, timestamp, attachments, embeds, created_at, updated_at, active)
				VALUES ('test-upsert-2', '1430111461547446402', '1254694808228986912', '99195129516007424', 'Test message 2', '${new Date().toISOString()}', [], [], '${new Date().toISOString()}', '${new Date().toISOString()}', true)
				ON CONFLICT DO UPDATE SET
					content = 'Updated message 2',
					updated_at = '${new Date().toISOString()}'
			`);
			console.log("🔹 ON CONFLICT result:", result2);
		} catch (error) {
			console.log("🔸 ON CONFLICT failed:", error.message);
		}

		// Test 3: Try simple INSERT (should work)
		console.log("🔹 Test 3: Testing simple INSERT...");
		try {
			const result3 = await db.db.query(`
				INSERT INTO messages (id, channel_id, guild_id, author_id, content, timestamp, attachments, embeds, created_at, updated_at, active)
				VALUES ('test-simple-insert', '1430111461547446402', '1254694808228986912', '99195129516007424', 'Simple insert message', '${new Date().toISOString()}', [], [], '${new Date().toISOString()}', '${new Date().toISOString()}', true)
			`);
			console.log("🔹 Simple INSERT result:", result3);
		} catch (error) {
			console.log("🔸 Simple INSERT failed:", error.message);
		}

		// Test 4: Query all messages
		console.log("🔹 Test 4: Querying all messages...");
		const allMessages = await db.db.query("SELECT * FROM messages");
		console.log("🔹 All messages count:", allMessages[0]?.length || 0);
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testSurrealDBUpsertSyntax().catch(console.error);
