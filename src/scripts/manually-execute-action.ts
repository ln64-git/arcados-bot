import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function manuallyExecuteAction() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Get the pending action
		const result = await db.getPendingActions();
		if (result.success && result.data && result.data.length > 0) {
			const action = result.data[0];
			console.log(`🔹 Found action: ${action.type} - ${action.id}`);
			
			// Parse the payload
			let payload = action.payload;
			if (typeof payload === "string") {
				payload = JSON.parse(payload);
			}
			
			console.log("🔹 Action payload:", payload);
			
			// Mark action as executed
			console.log("🔹 Marking action as executed...");
			const markResult = await db.markActionExecuted(action.id);
			if (markResult.success) {
				console.log("✅ Action marked as executed");
			} else {
				console.error("🔸 Failed to mark action as executed:", markResult.error);
			}
			
		} else {
			console.log("🔸 No pending actions found");
		}

	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

manuallyExecuteAction();
