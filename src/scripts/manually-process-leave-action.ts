import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function manuallyProcessLeaveAction() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Get the most recent voice_user_leave action
		const leaveActionsResult = await db.query(
			"SELECT * FROM actions WHERE type = 'voice_user_leave' AND executed = false ORDER BY created_at DESC LIMIT 1"
		);
		
		if (leaveActionsResult[0] && (leaveActionsResult[0] as any[]).length > 0) {
			const action = (leaveActionsResult[0] as any[])[0];
			console.log(`🔹 Found voice_user_leave action: ${action.id}`);
			console.log(`🔹 Payload: ${action.payload}`);
			
			// Parse the payload
			const payload = JSON.parse(action.payload);
			console.log(`🔹 Parsed payload:`, payload);
			
			// Check if the channel still exists in Discord
			console.log(`🔹 Channel ID: ${payload.channel_id}`);
			console.log(`🔹 User ID: ${payload.user_id}`);
			console.log(`🔹 Was owner: ${payload.was_owner}`);
		} else {
			console.log("🔹 No pending voice_user_leave actions found");
		}

		console.log("🔹 Manual leave action check completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

manuallyProcessLeaveAction();
