import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function debugPendingActions() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Check all actions (not just pending ones)
		const allActionsResult = await db.query(
			"SELECT * FROM actions WHERE type = 'voice_user_leave' ORDER BY created_at DESC LIMIT 5",
		);

		if (allActionsResult[0]) {
			console.log(
				`🔹 Found ${(allActionsResult[0] as any[]).length} voice_user_leave actions:`,
			);
			for (const action of allActionsResult[0] as any[]) {
				console.log(`  - ${action.id}`);
				console.log(`    executed: ${action.executed}`);
				console.log(`    active: ${action.active}`);
				console.log(`    created: ${action.created_at}`);
			}
		}

		// Check what getPendingActions actually returns
		console.log("\n🔹 What getPendingActions returns:");
		const pendingResult = await db.getPendingActions();
		if (pendingResult.success && pendingResult.data) {
			console.log(`🔹 Found ${pendingResult.data.length} pending actions:`);
			for (const action of pendingResult.data) {
				console.log(`  - ${action.type} (${action.id})`);
				console.log(`    executed: ${action.executed}`);
				console.log(`    active: ${action.active}`);
			}
		}

		console.log("🔹 Debug completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

debugPendingActions();
