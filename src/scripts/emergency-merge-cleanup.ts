import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function emergencyMergeCleanup() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Get all pending actions
		const pendingResult = await db.getPendingActions();
		if (pendingResult.success && pendingResult.data) {
			console.log(`🔹 Found ${pendingResult.data.length} pending actions`);
			
			let processedCount = 0;
			const cutoffTime = Date.now() - 60 * 60 * 1000; // 1 hour ago
			
			for (const action of pendingResult.data) {
				const actionTime = new Date(action.created_at).getTime();
				
				// Only process old actions
				if (actionTime < cutoffTime && (action.type === 'voice_channel_create' || action.type === 'voice_channel_update')) {
					let cleanId: string;
					if (typeof action.id === 'string') {
						cleanId = action.id.replace(/^actions:/, '');
					} else {
						cleanId = action.id.id;
					}
					
					try {
						// Use merge method like markActionExecuted does
						await db.db.merge(`actions:${cleanId}`, {
							executed: true,
							updated_at: new Date(),
						});
						processedCount++;
						
						if (processedCount % 10 === 0) {
							console.log(`🔹 Processed ${processedCount} actions...`);
						}
					} catch (error) {
						console.error(`🔸 Failed to update action ${cleanId}:`, error);
					}
				}
			}
			
			console.log(`🔹 Processed ${processedCount} old actions`);
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

		console.log("🔹 Emergency merge cleanup completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

emergencyMergeCleanup();
