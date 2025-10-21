import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function manualActionCleanup() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Get all pending voice_channel_create actions
		const createActionsResult = await db.query(
			"SELECT * FROM actions WHERE type = 'voice_channel_create' AND executed = false AND active = true ORDER BY created_at DESC"
		);
		
		if (createActionsResult[0]) {
			const actions = createActionsResult[0] as any[];
			console.log(`🔹 Found ${actions.length} pending voice_channel_create actions`);
			
			// Mark all but the most recent 3 as executed
			for (let i = 3; i < actions.length; i++) {
				const action = actions[i];
				let cleanId: string;
				if (typeof action.id === 'string') {
					cleanId = action.id.replace(/^actions:/, '');
				} else {
					cleanId = action.id.id;
				}
				
				console.log(`🔹 Marking action ${cleanId} as executed`);
				await db.markActionExecuted(`actions:${cleanId}`);
			}
			
			console.log(`🔹 Marked ${actions.length - 3} voice_channel_create actions as executed`);
		}

		// Get all pending voice_channel_update actions
		const updateActionsResult = await db.query(
			"SELECT * FROM actions WHERE type = 'voice_channel_update' AND executed = false AND active = true ORDER BY created_at DESC"
		);
		
		if (updateActionsResult[0]) {
			const actions = updateActionsResult[0] as any[];
			console.log(`🔹 Found ${actions.length} pending voice_channel_update actions`);
			
			// Mark all but the most recent 5 as executed
			for (let i = 5; i < actions.length; i++) {
				const action = actions[i];
				let cleanId: string;
				if (typeof action.id === 'string') {
					cleanId = action.id.replace(/^actions:/, '');
				} else {
					cleanId = action.id.id;
				}
				
				console.log(`🔹 Marking action ${cleanId} as executed`);
				await db.markActionExecuted(`actions:${cleanId}`);
			}
			
			console.log(`🔹 Marked ${actions.length - 5} voice_channel_update actions as executed`);
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

		console.log("🔹 Manual action cleanup completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

manualActionCleanup();
