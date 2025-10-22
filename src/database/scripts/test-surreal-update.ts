import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function testSurrealDBUpdate() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Test a simple update query
		console.log("🔹 Testing simple update query...");
		
		const testResult = await db.query(
			"UPDATE actions SET executed = true WHERE id = 'actions:0gscyer57dbdnumlm16k'"
		);
		
		console.log("🔹 Test update result:", testResult);

		// Check if the update worked
		const checkResult = await db.query(
			"SELECT executed FROM actions WHERE id = 'actions:0gscyer57dbdnumlm16k'"
		);
		
		console.log("🔹 Check result:", checkResult);

		console.log("🔹 Test completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

testSurrealDBUpdate();
