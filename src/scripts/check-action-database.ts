import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function checkActionInDatabase() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Check the most recent action
		const result = await db.query(
			"SELECT * FROM actions ORDER BY created_at DESC LIMIT 1",
		);

		console.log("🔹 Most recent action:", JSON.stringify(result, null, 2));

		// Check pending actions specifically
		const pendingResult = await db.getPendingActions();
		console.log(
			"🔹 Pending actions result:",
			JSON.stringify(pendingResult, null, 2),
		);
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

checkActionInDatabase();
