import { SurrealDBManager } from "../database/SurrealDBManager";

async function testDatabaseConnection() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test a simple query
		console.log("🔹 Testing simple query...");
		const testResult = await db.query("SELECT * FROM channels LIMIT 5");
		console.log("🔹 Test query result:", JSON.stringify(testResult, null, 2));

		// Test inserting a test record
		console.log("\n🔹 Testing insert...");
		const insertResult = await db.query(
			"INSERT INTO channels (id, name, guild_id, active) VALUES ('test-channel-123', 'Test Channel', '1254694808228986912', true)",
		);
		console.log("🔹 Insert result:", JSON.stringify(insertResult, null, 2));

		// Test querying the test record
		console.log("\n🔹 Testing query after insert...");
		const queryResult = await db.query(
			"SELECT * FROM channels WHERE id = 'test-channel-123'",
		);
		console.log("🔹 Query result:", JSON.stringify(queryResult, null, 2));

		// Clean up test record
		console.log("\n🔹 Cleaning up test record...");
		await db.query("DELETE FROM channels WHERE id = 'test-channel-123'");
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

testDatabaseConnection();
