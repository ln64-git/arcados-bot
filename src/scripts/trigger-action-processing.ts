import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function triggerActionProcessing() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Get pending actions
		const pendingResult = await db.getPendingActions();
		if (pendingResult.success && pendingResult.data) {
			console.log(`🔹 Found ${pendingResult.data.length} pending actions`);

			// Show the first few actions
			for (let i = 0; i < Math.min(3, pendingResult.data.length); i++) {
				const action = pendingResult.data[i];
				console.log(`🔹 Action ${i + 1}: ${action.type} (${action.id})`);
				console.log(`   Created: ${action.created_at}`);
				console.log(`   Executed: ${action.executed}`);
			}
		} else {
			console.log("🔹 No pending actions found");
		}

		console.log("🔹 Action processing check completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

triggerActionProcessing();
