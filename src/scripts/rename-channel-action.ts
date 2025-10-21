import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function renameChannelWithAction() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Rename the "Custom Action Channel" to "Renamed Action Channel"
		const actionData = {
			guild_id: "1254694808228986912",
			type: "voice_channel_rename",
			payload: {
				channel_id: "1430042123775774781", // The Custom Action Channel ID from the logs
				guild_id: "1254694808228986912",
				new_name: "Renamed Action Channel",
			},
		};

		console.log(
			"🔹 Creating channel rename action with data:",
			JSON.stringify(actionData, null, 2),
		);

		const result = await db.createAction(actionData);

		if (result.success) {
			console.log(
				"✅ Channel rename action created successfully:",
				result.data,
			);
		} else {
			console.error("❌ Failed to create channel rename action:", result.error);
		}
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

renameChannelWithAction();
