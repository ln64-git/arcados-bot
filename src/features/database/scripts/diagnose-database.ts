import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";
import path from "path";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function diagnoseDatabase() {
	console.log("🔹 Diagnosing database structure and data...");

	const db = new SurrealDBManager();
	const connected = await db.connect();

	if (!connected) {
		console.error("❌ Failed to connect to database");
		return;
	}

	console.log("✅ Connected to database");

	try {
		// Check all tables
		console.log("\n🔹 Checking all tables...");
		const tables = await db.query("INFO FOR DB");
		console.log("Database info:", JSON.stringify(tables, null, 2));

		// Check messages table specifically
		console.log("\n🔹 Checking messages table...");
		const messageInfo = await db.query("INFO FOR TABLE messages");
		console.log("Messages table info:", JSON.stringify(messageInfo, null, 2));

		// Try different query approaches
		console.log("\n🔹 Testing different query approaches...");

		// Approach 1: Direct SELECT
		console.log("1. Direct SELECT * FROM messages LIMIT 3:");
		const directSelect = await db.query("SELECT * FROM messages LIMIT 3");
		console.log("Result:", JSON.stringify(directSelect, null, 2));

		// Approach 2: SELECT with specific fields
		console.log("\n2. SELECT id, content FROM messages LIMIT 3:");
		const fieldSelect = await db.query(
			"SELECT id, content FROM messages LIMIT 3",
		);
		console.log("Result:", JSON.stringify(fieldSelect, null, 2));

		// Approach 3: COUNT query
		console.log("\n3. SELECT count() FROM messages:");
		const countSelect = await db.query("SELECT count() FROM messages");
		console.log("Result:", JSON.stringify(countSelect, null, 2));

		// Approach 4: Query by guild_id
		console.log(
			'\n4. SELECT * FROM messages WHERE guild_id = "1254694808228986912" LIMIT 3:',
		);
		const guildSelect = await db.query(
			'SELECT * FROM messages WHERE guild_id = "1254694808228986912" LIMIT 3',
		);
		console.log("Result:", JSON.stringify(guildSelect, null, 2));

		// Approach 5: Query by channel_id
		console.log(
			'\n5. SELECT * FROM messages WHERE channel_id = "1254697312052187178" LIMIT 3:',
		);
		const channelSelect = await db.query(
			'SELECT * FROM messages WHERE channel_id = "1254697312052187178" LIMIT 3',
		);
		console.log("Result:", JSON.stringify(channelSelect, null, 2));

		// Check if there are any records at all
		console.log("\n🔹 Checking for any records in any table...");
		const allRecords = await db.query("SELECT * FROM messages");
		console.log("All records count:", allRecords.length);
		if (allRecords.length > 0) {
			console.log("First record:", JSON.stringify(allRecords[0], null, 2));
		}
	} catch (error) {
		console.error("❌ Error during diagnosis:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from database");
	}
}

diagnoseDatabase().catch(console.error);
