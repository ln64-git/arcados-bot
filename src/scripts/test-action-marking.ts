import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function testActionMarking() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Create a test action
		const testAction = {
			guild_id: "1254694808228986912",
			type: "voice_channel_create",
			payload: {
				guild_id: "1254694808228986912",
				user_id: "354823920010002432",
				spawn_channel_id: "1428282734173880440",
				channel_name: "Test Marking Action",
				user_limit: 0,
			},
		};

		console.log("🔹 Creating test action...");
		const createResult = await db.createAction(testAction);
		
		if (createResult.success) {
			const actionId = createResult.data?.id;
			console.log("✅ Test action created:", actionId);

			// Check if it's in pending actions
			const pendingResult = await db.getPendingActions();
			if (pendingResult.success && pendingResult.data) {
				const found = pendingResult.data.find(action => action.id === actionId);
				console.log(`🔹 Action found in pending: ${!!found}`);
			}

			// Mark as executed
			console.log("🔹 Marking action as executed...");
			const markResult = await db.markActionExecuted(actionId!);
			
			if (markResult.success) {
				console.log("✅ Action marked as executed");

				// Check if it's still in pending actions
				const pendingResult2 = await db.getPendingActions();
				if (pendingResult2.success && pendingResult2.data) {
					const found2 = pendingResult2.data.find(action => action.id === actionId);
					console.log(`🔹 Action still in pending after marking: ${!!found2}`);
					
					if (found2) {
						console.log("🔸 Action is still pending! This is the bug.");
						console.log("Action details:", found2);
					} else {
						console.log("✅ Action successfully removed from pending list");
					}
				}
			} else {
				console.error("🔸 Failed to mark action as executed:", markResult.error);
			}
		} else {
			console.error("🔸 Failed to create test action:", createResult.error);
		}

	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

testActionMarking();
