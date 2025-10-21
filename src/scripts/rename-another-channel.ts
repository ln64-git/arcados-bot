import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function renameAnotherChannel() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Rename the "Test Channel" to "Final Test Channel"
		const actionData = {
			guild_id: "1254694808228986912",
			type: "voice_channel_rename",
			payload: {
				channel_id: "1430041855642435665", // The Test Channel ID from earlier logs
				guild_id: "1254694808228986912",
				new_name: "Final Test Channel",
			},
		};

		console.log(
			"🔹 Creating second rename action with data:",
			JSON.stringify(actionData, null, 2),
		);

		const result = await db.createAction(actionData);

		if (result.success) {
			console.log("✅ Second rename action created successfully:", result.data);
		} else {
			console.error("❌ Failed to create second rename action:", result.error);
		}
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

renameAnotherChannel();
