import { SurrealDBManager } from "../database/SurrealDBManager.js";
import { DatabaseActions } from "../features/discord-sync/actions.js";

async function processVoiceUserLeaveActions() {
	const db = new SurrealDBManager();
	const actions = new DatabaseActions(db);

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB Cloud");

		// Get only voice_user_leave actions
		const result = await db.query(
			"SELECT * FROM actions WHERE type = 'voice_user_leave' AND executed = false AND active = true",
		);

		if (result[0]) {
			const actions = result[0] as any[];
			console.log(`🔹 Found ${actions.length} voice_user_leave actions`);

			for (const action of actions) {
				console.log(`🔹 Processing voice_user_leave action: ${action.id}`);

				try {
					// Parse the payload
					const payload = JSON.parse(action.payload);
					console.log(`   Channel ID: ${payload.channel_id}`);
					console.log(`   User ID: ${payload.user_id}`);
					console.log(`   Was owner: ${payload.was_owner}`);

					// Process the action manually
					await actions.handleVoiceUserLeave(payload);

					// Mark as executed
					let cleanId: string;
					if (typeof action.id === "string") {
						cleanId = action.id.replace(/^actions:/, "");
					} else {
						cleanId = action.id.id;
					}

					await db.markActionExecuted(`actions:${cleanId}`);
					console.log(`   ✅ Processed and marked as executed`);
				} catch (error) {
					console.error(`   🔸 Failed to process action ${action.id}:`, error);
				}
			}
		} else {
			console.log("🔹 No voice_user_leave actions found");
		}

		console.log("🔹 Voice user leave processing completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

processVoiceUserLeaveActions();
