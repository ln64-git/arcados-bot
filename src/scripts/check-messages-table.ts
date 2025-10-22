import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function checkMessagesTable() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Check if messages table exists
		console.log("🔹 Checking if messages table exists...");
		try {
			const tableInfo = await db.db.query("INFO FOR TABLE messages");
			console.log(
				"🔹 Messages table info:",
				JSON.stringify(tableInfo, null, 2),
			);
		} catch (error) {
			console.log("🔸 Messages table not found:", error.message);
		}

		// Try to create the messages table
		console.log("🔹 Creating messages table...");
		try {
			await db.db.query("DEFINE TABLE messages SCHEMAFULL");
			console.log("🔹 Messages table created");
		} catch (error) {
			console.log("🔸 Error creating messages table:", error.message);
		}

		// Define message fields
		console.log("🔹 Defining message fields...");
		const fields = [
			"DEFINE FIELD id ON messages TYPE string;",
			"DEFINE FIELD channel_id ON messages TYPE string;",
			"DEFINE FIELD guild_id ON messages TYPE string;",
			"DEFINE FIELD author_id ON messages TYPE string;",
			"DEFINE FIELD content ON messages TYPE string;",
			"DEFINE FIELD timestamp ON messages TYPE datetime;",
			"DEFINE FIELD attachments ON messages TYPE array<object> DEFAULT [];",
			"DEFINE FIELD embeds ON messages TYPE array<object> DEFAULT [];",
			"DEFINE FIELD created_at ON messages TYPE datetime;",
			"DEFINE FIELD updated_at ON messages TYPE datetime;",
			"DEFINE FIELD active ON messages TYPE bool DEFAULT true;",
		];

		for (const field of fields) {
			try {
				await db.db.query(field);
				console.log(`🔹 Defined field: ${field}`);
			} catch (error) {
				console.log(`🔸 Error defining field "${field}":`, error.message);
			}
		}

		// Test inserting a message
		console.log("🔹 Testing message insertion...");
		try {
			const result = await db.db.query(`
				INSERT INTO messages (id, channel_id, guild_id, author_id, content, timestamp, attachments, embeds, created_at, updated_at, active)
				VALUES ('test-final-123', '1430111461547446402', '1254694808228986912', '99195129516007424', 'Final test message', '${new Date().toISOString()}', [], [], '${new Date().toISOString()}', '${new Date().toISOString()}', true)
			`);
			console.log("🔹 Insert result:", result);
		} catch (error) {
			console.log("🔸 Insert failed:", error.message);
		}

		// Query all messages
		console.log("🔹 Querying all messages...");
		try {
			const allMessages = await db.db.query("SELECT * FROM messages");
			console.log(
				"🔹 All messages count:",
				allMessages[0]?.result?.length || 0,
			);
			console.log("🔹 All messages:", allMessages[0]?.result);
		} catch (error) {
			console.log("🔸 Query failed:", error.message);
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

checkMessagesTable().catch(console.error);
