import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function deleteOldActions() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Get all pending actions
		const pendingResult = await db.getPendingActions();
		if (pendingResult.success && pendingResult.data) {
			console.log(`🔹 Found ${pendingResult.data.length} pending actions`);
			
			let deletedCount = 0;
			const cutoffTime = Date.now() - 60 * 60 * 1000; // 1 hour ago
			
			for (const action of pendingResult.data) {
				const actionTime = new Date(action.created_at).getTime();
				
				// Only delete old actions that would cause mass channel creation
				if (actionTime < cutoffTime && (action.type === 'voice_channel_create' || action.type === 'voice_channel_update')) {
					let cleanId: string;
					if (typeof action.id === 'string') {
						cleanId = action.id.replace(/^actions:/, '');
					} else {
						cleanId = action.id.id;
					}
					
					try {
						// Delete the action entirely
						await db.db.delete(`actions:${cleanId}`);
						deletedCount++;
						
						if (deletedCount % 10 === 0) {
							console.log(`🔹 Deleted ${deletedCount} actions...`);
						}
					} catch (error) {
						console.error(`🔸 Failed to delete action ${cleanId}:`, error);
					}
				}
			}
			
			console.log(`🔹 Deleted ${deletedCount} old actions`);
		}

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

		console.log("🔹 Action deletion cleanup completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

deleteOldActions();
