import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function cleanupActionBacklog() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Get all pending actions
		const pendingResult = await db.getPendingActions();
		if (pendingResult.success && pendingResult.data) {
			console.log(`🔹 Found ${pendingResult.data.length} pending actions`);
			
			// Count by type
			const actionCounts: Record<string, number> = {};
			for (const action of pendingResult.data) {
				actionCounts[action.type] = (actionCounts[action.type] || 0) + 1;
			}
			
			console.log("🔹 Action counts by type:");
			for (const [type, count] of Object.entries(actionCounts)) {
				console.log(`  - ${type}: ${count}`);
			}

			// Mark old actions as inactive to prevent mass execution
			// Keep only the most recent actions of each type
			const cutoffDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
			console.log(`🔹 Marking actions older than ${cutoffDate.toISOString()} as inactive...`);
			
			let markedCount = 0;
			for (const action of pendingResult.data) {
				const actionDate = new Date(action.created_at);
				if (actionDate < cutoffDate) {
					// Mark old actions as inactive
					let cleanId: string;
					if (typeof action.id === 'string') {
						cleanId = action.id.replace(/^actions:/, '');
					} else {
						cleanId = action.id.id;
					}
					
					await db.query(
						"UPDATE actions SET active = false WHERE id = $id",
						{ id: `actions:${cleanId}` }
					);
					markedCount++;
				}
			}
			
			console.log(`🔹 Marked ${markedCount} old actions as inactive`);
			
			// Check remaining active actions
			const remainingResult = await db.getPendingActions();
			if (remainingResult.success && remainingResult.data) {
				console.log(`🔹 Remaining active actions: ${remainingResult.data.length}`);
			}
		}

		console.log("🔹 Action backlog cleanup completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

cleanupActionBacklog();
