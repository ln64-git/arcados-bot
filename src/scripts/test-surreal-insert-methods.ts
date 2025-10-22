import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function testSurrealDBInsertMethods() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test 1: Using INSERT INTO (should work with SELECT * FROM)
		console.log("🔹 Test 1: Using INSERT INTO...");
		const insertResult = await db.db.query(`
			INSERT INTO messages (id, guild_id, channel_id, author_id, content, created_at, updated_at) 
			VALUES ('insert-test-123', '1254694808228986912', '1430111461547446402', '99195129516007424', 'INSERT test message', '${new Date().toISOString()}', '${new Date().toISOString()}')
		`);
		console.log("🔹 INSERT result:", insertResult);

		// Test 2: Using CREATE (should work with SELECT * FROM)
		console.log("🔹 Test 2: Using CREATE...");
		const createResult = await db.db.query(`
			CREATE messages:create-test-123 SET 
				guild_id = '1254694808228986912',
				channel_id = '1430111461547446402',
				author_id = '99195129516007424',
				content = 'CREATE test message',
				created_at = '${new Date().toISOString()}',
				updated_at = '${new Date().toISOString()}'
		`);
		console.log("🔹 CREATE result:", createResult);

		// Test 3: Using upsert (current method)
		console.log("🔹 Test 3: Using upsert...");
		const upsertResult = await db.db.upsert('messages:upsert-test-123', {
			guild_id: '1254694808228986912',
			channel_id: '1430111461547446402',
			author_id: '99195129516007424',
			content: 'UPSERT test message',
			created_at: new Date(),
			updated_at: new Date(),
		});
		console.log("🔹 UPSERT result:", upsertResult);

		// Test 4: Query all messages
		console.log("🔹 Test 4: Querying all messages...");
		const allMessages = await db.db.query("SELECT * FROM messages");
		console.log("🔹 All messages count:", allMessages[0]?.length || 0);
		console.log("🔹 All messages:", allMessages[0]);

		// Test 5: Direct select each message
		console.log("🔹 Test 5: Direct select each message...");
		const direct1 = await db.db.select("messages:insert-test-123");
		const direct2 = await db.db.select("messages:create-test-123");
		const direct3 = await db.db.select("messages:upsert-test-123");
		console.log("🔹 Direct select INSERT:", direct1.length > 0 ? "Found" : "Not found");
		console.log("🔹 Direct select CREATE:", direct2.length > 0 ? "Found" : "Not found");
		console.log("🔹 Direct select UPSERT:", direct3.length > 0 ? "Found" : "Not found");

	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testSurrealDBInsertMethods().catch(console.error);
