import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function testMessageQueries() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test different query approaches
		console.log("🔹 Test 1: SELECT * FROM messages");
		const query1 = await db.db.query("SELECT * FROM messages");
		console.log(
			"🔹 Query 1 result:",
			query1[0]?.result?.length || 0,
			"messages",
		);

		console.log("🔹 Test 2: SELECT * FROM messages LIMIT 10");
		const query2 = await db.db.query("SELECT * FROM messages LIMIT 10");
		console.log(
			"🔹 Query 2 result:",
			query2[0]?.result?.length || 0,
			"messages",
		);

		console.log("🔹 Test 3: SELECT count() FROM messages");
		const query3 = await db.db.query("SELECT count() FROM messages");
		console.log(
			"🔹 Query 3 result:",
			query3[0]?.result?.[0]?.["count()"] || 0,
			"messages",
		);

		console.log("🔹 Test 4: Direct select by ID");
		const direct = await db.db.select("messages:test-message-123");
		console.log(
			"🔹 Direct select result:",
			direct.length > 0 ? "Found" : "Not found",
		);

		console.log("🔹 Test 5: Query by specific ID");
		const query5 = await db.db.query(
			"SELECT * FROM messages WHERE id = 'messages:test-message-123'",
		);
		console.log(
			"🔹 Query 5 result:",
			query5[0]?.result?.length || 0,
			"messages",
		);

		console.log("🔹 Test 6: Query by guild_id");
		const query6 = await db.db.query(
			"SELECT * FROM messages WHERE guild_id = '1254694808228986912'",
		);
		console.log(
			"🔹 Query 6 result:",
			query6[0]?.result?.length || 0,
			"messages",
		);

		console.log("🔹 Test 7: Query by author_id");
		const query7 = await db.db.query(
			"SELECT * FROM messages WHERE author_id = '99195129516007424'",
		);
		console.log(
			"🔹 Query 7 result:",
			query7[0]?.result?.length || 0,
			"messages",
		);
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testMessageQueries().catch(console.error);
