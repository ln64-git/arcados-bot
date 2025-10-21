import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function checkQueuedActions() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB Cloud");

		// Get pending actions count
		const result = await db.getPendingActions();
		if (result.success && result.data) {
			console.log(`🔹 Found ${result.data.length} pending actions`);

			if (result.data.length > 0) {
				console.log("\n🔹 Action types breakdown:");
				const actionTypes = result.data.reduce(
					(acc: Record<string, number>, action: any) => {
						acc[action.type] = (acc[action.type] || 0) + 1;
						return acc;
					},
					{},
				);
				console.log(actionTypes);

				console.log("\n🔹 Recent actions (last 5):");
				const recentActions = result.data.slice(0, 5);
				for (const action of recentActions) {
					console.log(
						`   ${action.type} - ${action.id} - Created: ${action.created_at}`,
					);
					if (action.type === "voice_user_leave") {
						const payload = JSON.parse(action.payload);
						console.log(
							`     Channel: ${payload.channel_id}, User: ${payload.user_id}`,
						);
					}
				}
			} else {
				console.log("🔹 No pending actions found");
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

checkQueuedActions();
