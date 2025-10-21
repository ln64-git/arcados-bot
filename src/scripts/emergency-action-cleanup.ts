import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function emergencyActionCleanup() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// EMERGENCY: Mark all old voice_channel_create actions as executed to prevent mass channel creation
		console.log("🔹 EMERGENCY: Marking all old voice_channel_create actions as executed...");
		
		const result = await db.query(
			"UPDATE actions SET executed = true WHERE type = 'voice_channel_create' AND created_at < $cutoff",
			{ cutoff: new Date(Date.now() - 30 * 60 * 1000).toISOString() } // 30 minutes ago
		);
		
		console.log("🔹 Marked old voice_channel_create actions as executed");

		// Also mark old voice_channel_update actions as executed
		console.log("🔹 Marking old voice_channel_update actions as executed...");
		
		await db.query(
			"UPDATE actions SET executed = true WHERE type = 'voice_channel_update' AND created_at < $cutoff",
			{ cutoff: new Date(Date.now() - 30 * 60 * 1000).toISOString() }
		);
		
		console.log("🔹 Marked old voice_channel_update actions as executed");

		// Check remaining actions
		const remainingResult = await db.getPendingActions();
		if (remainingResult.success && remainingResult.data) {
			console.log(`🔹 Remaining active actions: ${remainingResult.data.length}`);
			
			// Count by type
			const actionCounts: Record<string, number> = {};
			for (const action of remainingResult.data) {
				actionCounts[action.type] = (actionCounts[action.type] || 0) + 1;
			}
			
			console.log("🔹 Remaining action counts by type:");
			for (const [type, count] of Object.entries(actionCounts)) {
				console.log(`  - ${type}: ${count}`);
			}
		}

		console.log("🔹 Emergency action cleanup completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

emergencyActionCleanup();
