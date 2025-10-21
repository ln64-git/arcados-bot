import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function clearPendingActions() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB Cloud");

		// Get count before deletion
		const beforeResult = await db.query(
			"SELECT count() FROM actions WHERE executed = false AND active = true",
		);
		const beforeCount = beforeResult[0] as Record<string, unknown>;
		console.log(
			`🔹 Found ${beforeCount.count} pending actions before deletion`,
		);

		// Delete all pending actions
		const deleteResult = await db.query(
			"DELETE actions WHERE executed = false AND active = true",
		);
		console.log("🔹 Deleted all pending actions");

		// Get count after deletion
		const afterResult = await db.query(
			"SELECT count() FROM actions WHERE executed = false AND active = true",
		);
		const afterCount = afterResult[0] as Record<string, unknown>;
		console.log(`🔹 Found ${afterCount.count} pending actions after deletion`);

		console.log(`✅ Successfully cleared ${beforeCount.count} pending actions`);
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

clearPendingActions();
