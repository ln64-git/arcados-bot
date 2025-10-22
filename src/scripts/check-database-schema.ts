import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function checkDatabaseSchema() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Check the actual table structure
		console.log("🔹 Checking messages table structure...");
		const tableInfo = await db.db.query("INFO FOR TABLE messages");
		console.log("🔹 Messages table info:", JSON.stringify(tableInfo, null, 2));

		// Try to insert a message with the correct field names
		console.log("🔹 Testing INSERT with correct field names...");
		try {
			const result = await db.db.query(`
				INSERT INTO messages SET
					id = 'test-correct-fields',
					channel_id = '1430111461547446402',
					guild_id = '1254694808228986912',
					author_id = '99195129516007424',
					content = 'Test with correct fields',
					timestamp = '${new Date().toISOString()}',
					attachments = [],
					embeds = [],
					created_at = '${new Date().toISOString()}',
					updated_at = '${new Date().toISOString()}',
					active = true
			`);
			console.log("🔹 INSERT result:", result);
		} catch (error) {
			console.log("🔸 INSERT failed:", error.message);
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

checkDatabaseSchema().catch(console.error);
