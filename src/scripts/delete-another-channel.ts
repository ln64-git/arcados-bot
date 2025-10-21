import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function deleteAnotherChannel() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Delete the "Final Test Channel" (which was originally "Test Channel")
		const actionData = {
			guild_id: "1254694808228986912",
			type: "voice_channel_delete",
			payload: {
				channel_id: "1430041855642435665", // The Final Test Channel ID
				guild_id: "1254694808228986912",
				reason: "Cleaning up test channels",
			},
		};

		console.log(
			"🔹 Creating second delete action with data:",
			JSON.stringify(actionData, null, 2),
		);

		const result = await db.createAction(actionData);

		if (result.success) {
			console.log("✅ Second delete action created successfully:", result.data);
		} else {
			console.error("❌ Failed to create second delete action:", result.error);
		}
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

deleteAnotherChannel();
