import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function testDirectInsert() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test direct INSERT INTO
		console.log("🔹 Testing direct INSERT INTO messages...");
		try {
			const result = await db.db.query(`
				INSERT INTO messages (id, channel_id, guild_id, author_id, content, timestamp, attachments, embeds, created_at, updated_at, active)
				VALUES ('test-insert-123', '1430111461547446402', '1254694808228986912', '99195129516007424', 'Direct insert test', '${new Date().toISOString()}', [], [], '${new Date().toISOString()}', '${new Date().toISOString()}', true)
			`);
			console.log("🔹 INSERT result:", result);
		} catch (error) {
			console.log("🔸 INSERT failed:", error.message);
		}

		// Test direct INSERT without specifying ID
		console.log("🔹 Testing INSERT without ID...");
		try {
			const result = await db.db.query(`
				INSERT INTO messages (channel_id, guild_id, author_id, content, timestamp, attachments, embeds, created_at, updated_at, active)
				VALUES ('1430111461547446402', '1254694808228986912', '99195129516007424', 'Auto ID test', '${new Date().toISOString()}', [], [], '${new Date().toISOString()}', '${new Date().toISOString()}', true)
			`);
			console.log("🔹 INSERT without ID result:", result);
		} catch (error) {
			console.log("🔸 INSERT without ID failed:", error.message);
		}

		// Query all messages
		console.log("🔹 Querying all messages...");
		const allMessages = await db.db.query("SELECT * FROM messages");
		console.log("🔹 All messages count:", allMessages[0]?.result?.length || 0);
		console.log("🔹 All messages:", allMessages[0]?.result);

		// Count messages
		console.log("🔹 Counting messages...");
		const countResult = await db.db.query("SELECT count() FROM messages");
		console.log(
			"🔹 Message count:",
			countResult[0]?.result?.[0]?.["count()"] || 0,
		);
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testDirectInsert().catch(console.error);
