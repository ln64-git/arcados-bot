import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function testActionCreationOnly() {
	const db = new SurrealDBManager();

	try {
		console.log("🔹 Testing action creation (no Discord connection)...");

		// Connect to database only
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Create multiple test actions
		const testActions = [
			{
				guild_id: "1254694808228986912",
				type: "voice_channel_create",
				payload: {
					guild_id: "1254694808228986912",
					user_id: "354823920010002432",
					spawn_channel_id: "1428282734173880440",
					channel_name: "Test Channel 1",
					user_limit: 0,
				},
			},
			{
				guild_id: "1254694808228986912",
				type: "voice_channel_create",
				payload: {
					guild_id: "1254694808228986912",
					user_id: "1425975573364080731",
					spawn_channel_id: "1428282734173880440",
					channel_name: "Test Channel 2",
					user_limit: 5,
				},
			},
		];

		console.log(`🔹 Creating ${testActions.length} test actions...`);

		for (let i = 0; i < testActions.length; i++) {
			const action = testActions[i];
			console.log(`🔹 Creating action ${i + 1}/${testActions.length}...`);

			const result = await db.createAction(action);
			if (result.success) {
				console.log(`✅ Action ${i + 1} created: ${result.data?.id}`);
			} else {
				console.error(`🔸 Action ${i + 1} failed:`, result.error);
			}
		}

		// Check pending actions
		const pendingResult = await db.getPendingActions();
		if (pendingResult.success && pendingResult.data) {
			console.log(`🔹 Total pending actions: ${pendingResult.data.length}`);
		}

		console.log("✅ Action creation test completed!");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

testActionCreationOnly();
