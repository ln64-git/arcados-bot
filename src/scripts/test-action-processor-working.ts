import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function testActionProcessor() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Get all pending actions
		const pendingResult = await db.getPendingActions();
		if (pendingResult.success && pendingResult.data) {
			console.log(`🔹 Found ${pendingResult.data.length} pending actions`);

			// Show details of each action
			for (let i = 0; i < pendingResult.data.length; i++) {
				const action = pendingResult.data[i];
				console.log(`🔹 Action ${i + 1}: ${action.type} (${action.id})`);
				console.log(`   Created: ${action.created_at}`);
				console.log(`   Executed: ${action.executed}`);
				console.log(`   Active: ${action.active}`);

				if (action.type === "voice_user_leave") {
					const payload = JSON.parse(action.payload as string);
					console.log(`   Channel ID: ${payload.channel_id}`);
					console.log(`   User ID: ${payload.user_id}`);
					console.log(`   Was owner: ${payload.was_owner}`);
				}
			}
		} else {
			console.log("🔹 No pending actions found");
		}

		console.log("🔹 Action processor test completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

testActionProcessor();
