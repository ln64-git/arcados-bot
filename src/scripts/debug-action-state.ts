import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function debugActionState() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Check a specific action that we just updated
		const testActionId = "actions:0gscyer57dbdnumlm16k";
		console.log(`🔹 Checking action ${testActionId}...`);
		
		const checkResult = await db.query(
			"SELECT * FROM actions WHERE id = $id",
			{ id: testActionId }
		);
		
		console.log("🔹 Check result:", JSON.stringify(checkResult, null, 2));

		// Check what getPendingActions actually queries
		console.log("🔹 Testing getPendingActions query directly...");
		
		const directResult = await db.query(
			"SELECT * FROM actions WHERE executed = false AND active = true LIMIT 5"
		);
		
		console.log("🔹 Direct query result:", JSON.stringify(directResult, null, 2));

		console.log("🔹 Debug completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

debugActionState();
