import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function testQueries() {
	const db = new SurrealDBManager();

	try {
		console.log("🔹 Connecting to SurrealDB...");
		await db.connect();
		console.log("🔹 Connected successfully");

		const guildId = "1004111007611895808";

		console.log("🔹 Testing different query approaches...");

		// Test 1: Direct select by ID
		console.log("🔹 Test 1: Direct select by ID");
		const test1 = await db.db.select("messages:test-message-123");
		console.log("Result 1:", test1);

		// Test 2: Query with different syntax
		console.log("🔹 Test 2: Query with different syntax");
		const test2 = await db.db.query(
			`SELECT * FROM messages WHERE guild_id = '${guildId}'`,
		);
		console.log("Result 2:", test2);

		// Test 3: Query all messages
		console.log("🔹 Test 3: Query all messages");
		const test3 = await db.db.query(`SELECT * FROM messages`);
		console.log("Result 3:", test3);

		// Test 4: Query with LIMIT
		console.log("🔹 Test 4: Query with LIMIT");
		const test4 = await db.db.query(`SELECT * FROM messages LIMIT 5`);
		console.log("Result 4:", test4);

		// Test 5: Count query
		console.log("🔹 Test 5: Count query");
		const test5 = await db.db.query(`SELECT count() FROM messages`);
		console.log("Result 5:", test5);
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testQueries().catch(console.error);
