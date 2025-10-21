import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function clearActionQueue() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB Cloud");

		// Get count before clearing
		const beforeResult = await db.query(
			"SELECT count() as count FROM actions WHERE executed = false AND active = true",
		);

		console.log("🔹 Before result:", JSON.stringify(beforeResult, null, 2));

		if (beforeResult[0]) {
			const count = beforeResult[0] as Record<string, unknown>;
			console.log(`🔹 Found ${count.count} pending actions to clear`);
		}

		// Delete all pending actions
		const deleteResult = await db.query(
			"DELETE actions WHERE executed = false AND active = true",
		);

		console.log("🔹 Delete result:", JSON.stringify(deleteResult, null, 2));

		// Get count after clearing
		const afterResult = await db.query(
			"SELECT count() as count FROM actions WHERE executed = false AND active = true",
		);

		console.log("🔹 After result:", JSON.stringify(afterResult, null, 2));

		if (afterResult[0]) {
			const count = afterResult[0] as Record<string, unknown>;
			console.log(`🔹 Remaining pending actions: ${count.count}`);
		}

		console.log("🔹 Action queue cleared successfully");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

clearActionQueue();
