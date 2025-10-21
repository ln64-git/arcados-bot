import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function directDatabaseCleanup() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Direct SQL update to mark all old actions as executed
		console.log("🔹 EMERGENCY: Directly updating database to mark old actions as executed...");
		
		// Mark all voice_channel_create actions older than 1 hour as executed
		const createResult = await db.query(
			"UPDATE actions SET executed = true, updated_at = $now WHERE type = 'voice_channel_create' AND created_at < $cutoff",
			{ 
				cutoff: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
				now: new Date().toISOString()
			}
		);
		console.log("🔹 Marked old voice_channel_create actions as executed");

		// Mark all voice_channel_update actions older than 1 hour as executed
		const updateResult = await db.query(
			"UPDATE actions SET executed = true, updated_at = $now WHERE type = 'voice_channel_update' AND created_at < $cutoff",
			{ 
				cutoff: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
				now: new Date().toISOString()
			}
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

		console.log("🔹 Direct database cleanup completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

directDatabaseCleanup();
