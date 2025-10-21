import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function manuallyProcessAction() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Get the specific pending action
		const pendingResult = await db.getPendingActions();
		if (
			pendingResult.success &&
			pendingResult.data &&
			pendingResult.data.length > 0
		) {
			const action = pendingResult.data[0];
			console.log(`🔹 Found action: ${action.type} (${action.id})`);

			// Manually mark it as executed to test the flow
			console.log("🔹 Manually marking action as executed...");
			const markResult = await db.markActionExecuted(action.id);

			if (markResult.success) {
				console.log("✅ Action marked as executed successfully");
			} else {
				console.error(
					"❌ Failed to mark action as executed:",
					markResult.error,
				);
			}
		} else {
			console.log("🔹 No pending actions found");
		}

		console.log("🔹 Manual action processing completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

manuallyProcessAction();
