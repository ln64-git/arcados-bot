import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function testActionProcessorDirectly() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Test getPendingActions directly
		console.log("🔹 Testing getPendingActions...");
		const result = await db.getPendingActions();
		
		if (result.success && result.data) {
			console.log(`🔹 Found ${result.data.length} pending actions`);
			
			if (result.data.length > 0) {
				const action = result.data[0];
				console.log(`🔹 First action: ${action.type} - ${action.id}`);
				console.log(`   Created: ${action.created_at}`);
				console.log(`   Executed: ${action.executed}`);
				console.log(`   Execute at: ${action.execute_at || 'immediately'}`);
				
				// Check if action should be executed
				const now = new Date();
				const shouldExecute = !action.executed && (!action.execute_at || action.execute_at <= now);
				console.log(`   Should execute: ${shouldExecute}`);
				console.log(`   Now: ${now.toISOString()}`);
				if (action.execute_at) {
					console.log(`   Execute at: ${action.execute_at.toISOString()}`);
				}
			}
		} else {
			console.log("🔸 Failed to get pending actions:", result.error);
		}

	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

testActionProcessorDirectly();
