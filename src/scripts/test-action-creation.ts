import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function testActionCreation() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Create a test voice channel create action
		const actionData = {
			guild_id: "1254694808228986912",
			type: "voice_channel_create",
			payload: {
				guild_id: "1254694808228986912",
				user_id: "1425975573364080731", // wink's user ID
				spawn_channel_id: "1428282734173880440",
				channel_name: "Test Channel",
				user_limit: 0,
			},
		};

		console.log(
			"🔹 Creating test action with data:",
			JSON.stringify(actionData, null, 2),
		);

		const result = await db.createAction(actionData);

		if (result.success) {
			console.log("✅ Action created successfully:", result.data);
		} else {
			console.error("❌ Failed to create action:", result.error);
		}
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

testActionCreation();
