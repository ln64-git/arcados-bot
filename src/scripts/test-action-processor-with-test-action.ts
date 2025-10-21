import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager.js";
import { DatabaseActions } from "../features/discord-sync/actions.js";

async function testActionProcessorWithTestAction() {
	const db = new SurrealDBManager();
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.GuildMembers,
		],
	});
	const actions = new DatabaseActions(client, db);

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB Cloud");

		// Create a test voice_user_leave action
		console.log("🔹 Creating test voice_user_leave action...");
		const testAction = await db.createAction({
			guild_id: "1254694808228986912",
			type: "voice_user_leave",
			payload: {
				user_id: "1425975573364080731",
				guild_id: "1254694808228986912",
				channel_id: "1430067266006945822", // The channel that was mentioned as not being deleted
				was_owner: true,
			},
		});

		if (testAction.success) {
			console.log("✅ Test action created successfully");
		} else {
			console.log("🔸 Failed to create test action:", testAction.error);
		}

		// Check pending actions
		const result = await db.getPendingActions();
		if (result.success && result.data) {
			console.log(`🔹 Found ${result.data.length} pending actions`);
		}

		// Test manual action processing
		console.log("\n🔹 Testing manual action processing with test action...");
		await actions.triggerActionProcessing();

		console.log("\n🔹 Test completed successfully");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		client.destroy();
	}
}

testActionProcessorWithTestAction();
