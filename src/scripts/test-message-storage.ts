import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function testMessageStorage() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test 1: Store a message with a simple ID (no colon)
		console.log("🔹 Test 1: Storing message with simple ID...");
		const simpleMessage = {
			id: "simple-message-123",
			guild_id: "1254694808228986912",
			channel_id: "1430111461547446402",
			author_id: "99195129516007424",
			content: "Simple message content",
			created_at: new Date(),
			updated_at: new Date(),
		};

		const result1 = await db.upsertMessage(simpleMessage);
		console.log("🔹 Simple message result:", result1.success ? "Success" : result1.error);

		// Test 2: Store a message with the full record ID format
		console.log("🔹 Test 2: Storing message with full record ID...");
		const fullMessage = {
			id: "messages:full-message-123",
			guild_id: "1254694808228986912",
			channel_id: "1430111461547446402",
			author_id: "99195129516007424",
			content: "Full message content",
			created_at: new Date(),
			updated_at: new Date(),
		};

		const result2 = await db.upsertMessage(fullMessage);
		console.log("🔹 Full message result:", result2.success ? "Success" : result2.error);

		// Test 3: Query all messages
		console.log("🔹 Test 3: Querying all messages...");
		const allMessages = await db.db.query("SELECT * FROM messages");
		console.log("🔹 All messages count:", allMessages[0]?.length || 0);

		// Test 4: Try different query approaches
		console.log("🔹 Test 4: Trying different query approaches...");
		
		// Query by guild_id
		const guildMessages = await db.db.query("SELECT * FROM messages WHERE guild_id = '1254694808228986912'");
		console.log("🔹 Guild messages count:", guildMessages[0]?.length || 0);
		
		// Query by author_id
		const authorMessages = await db.db.query("SELECT * FROM messages WHERE author_id = '99195129516007424'");
		console.log("🔹 Author messages count:", authorMessages[0]?.length || 0);

		// Test 5: Direct select both messages
		console.log("🔹 Test 5: Direct select both messages...");
		const direct1 = await db.db.select("messages:simple-message-123");
		const direct2 = await db.db.select("messages:full-message-123");
		console.log("🔹 Direct select simple:", direct1.length > 0 ? "Found" : "Not found");
		console.log("🔹 Direct select full:", direct2.length > 0 ? "Found" : "Not found");

	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testMessageStorage().catch(console.error);
