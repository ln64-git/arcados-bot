import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function debugQueryResults() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Run the exact same query as getPendingActions
		const result = await db.query(
			"SELECT * FROM actions WHERE executed = false AND active = true",
		);

		console.log("🔹 Raw query result:");
		console.log(JSON.stringify(result, null, 2));

		// Check the parsing logic
		const rawData = (result[0] as Record<string, unknown>)?.[0];
		console.log("\n🔹 rawData:");
		console.log(JSON.stringify(rawData, null, 2));

		if (Array.isArray(rawData)) {
			console.log(`🔹 rawData is array with ${rawData.length} items`);
		} else if (rawData && typeof rawData === "object") {
			console.log("🔹 rawData is single object");
		} else {
			console.log("🔹 rawData is empty or invalid");
		}

		console.log("🔹 Debug completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

debugQueryResults();
