import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";
import path from "path";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function debugDatabase() {
	console.log("🔹 Debugging database message storage...");

	const db = new SurrealDBManager();
	const connected = await db.connect();

	if (!connected) {
		console.error("❌ Failed to connect to database");
		return;
	}

	console.log("✅ Connected to database");

	try {
		// Test 1: Check if messages table exists
		console.log("\n🔹 Test 1: Checking messages table structure...");
		const tableInfo = await db.query("INFO FOR TABLE messages");
		console.log("Table info:", JSON.stringify(tableInfo, null, 2));

		// Test 2: Try to insert a test message
		console.log("\n🔹 Test 2: Inserting test message...");
		const testMessage = {
			id: "1234567890123456789",
			guild_id: "1254694808228986912",
			channel_id: "1254697312052187178",
			author_id: "1160946148832444558",
			content: "Test message content",
			timestamp: new Date(),
			attachments: [],
			embeds: [],
			created_at: new Date(),
			updated_at: new Date(),
			active: true,
		};

		const insertResult = await db.upsertMessage(testMessage);
		console.log("Insert result:", insertResult);

		// Test 3: Try to query the test message
		console.log("\n🔹 Test 3: Querying test message...");
		const queryResult = await db.query(
			"SELECT * FROM messages WHERE id = $id",
			{ id: "1234567890123456789" },
		);
		console.log("Query result:", JSON.stringify(queryResult, null, 2));

		// Test 4: Try to query all messages
		console.log("\n🔹 Test 4: Querying all messages...");
		const allMessages = await db.query("SELECT * FROM messages LIMIT 5");
		console.log("All messages:", JSON.stringify(allMessages, null, 2));

		// Test 5: Try to count messages
		console.log("\n🔹 Test 5: Counting messages...");
		const messageCount = await db.query("SELECT count() FROM messages");
		console.log("Message count:", JSON.stringify(messageCount, null, 2));

		// Test 6: Try to query by guild_id
		console.log("\n🔹 Test 6: Querying by guild_id...");
		const guildMessages = await db.query(
			"SELECT * FROM messages WHERE guild_id = $guild_id LIMIT 5",
			{ guild_id: "1254694808228986912" },
		);
		console.log("Guild messages:", JSON.stringify(guildMessages, null, 2));
	} catch (error) {
		console.error("❌ Error during debug:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from database");
	}
}

debugDatabase().catch(console.error);
