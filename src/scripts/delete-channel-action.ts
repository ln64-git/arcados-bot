import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function deleteChannelWithAction() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Delete the "Renamed Action Channel" (which was originally "Custom Action Channel")
		const actionData = {
			guild_id: "1254694808228986912",
			type: "voice_channel_delete",
			payload: {
				channel_id: "1430042123775774781", // The Renamed Action Channel ID
				guild_id: "1254694808228986912",
				reason: "Testing action-based deletion",
			},
		};

		console.log(
			"🔹 Creating channel delete action with data:",
			JSON.stringify(actionData, null, 2),
		);

		const result = await db.createAction(actionData);

		if (result.success) {
			console.log(
				"✅ Channel delete action created successfully:",
				result.data,
			);
		} else {
			console.error("❌ Failed to create channel delete action:", result.error);
		}
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

deleteChannelWithAction();
