import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function deleteNewActionChannel() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Delete the new "Action Channel" we just created
		const actionData = {
			guild_id: "1254694808228986912",
			type: "voice_channel_delete",
			payload: {
				channel_id: "1430044931245867130", // The new Action Channel ID from the logs
				guild_id: "1254694808228986912",
				reason: "Testing action-based deletion workflow",
			},
		};

		console.log(
			"🔹 Creating Action Channel delete action with data:",
			JSON.stringify(actionData, null, 2),
		);

		const result = await db.createAction(actionData);

		if (result.success) {
			console.log(
				"✅ Action Channel delete action created successfully:",
				result.data,
			);
		} else {
			console.error(
				"❌ Failed to create Action Channel delete action:",
				result.error,
			);
		}
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

deleteNewActionChannel();
