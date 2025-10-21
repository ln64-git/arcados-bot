import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function testCloudConnection() {
	const db = new SurrealDBManager();

	try {
		console.log("🔹 Attempting to connect to SurrealDB Cloud...");
		const connected = await db.connect();

		if (connected) {
			console.log("🔹 Successfully connected to SurrealDB Cloud!");

			// Test a simple query
			const result = await db.getPendingActions();
			if (result.success && result.data) {
				console.log(`🔹 Found ${result.data.length} pending actions`);
			} else {
				console.log("🔹 No pending actions found or query failed");
			}
		} else {
			console.log("🔸 Failed to connect to SurrealDB Cloud");
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

testCloudConnection();
