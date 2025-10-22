import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager.js";
import { DatabaseActions } from "../features/discord-sync/actions.js";

async function testVoiceChannelAction() {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.GuildMembers,
		],
	});

	const db = new SurrealDBManager();

	try {
		console.log("🔹 Starting voice channel action test...");

		// Connect to Discord
		await client.login(process.env.DISCORD_TOKEN);
		console.log("🔹 Connected to Discord");

		// Connect to database
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Create actions manager
		const actions = new DatabaseActions(client, db);

		// Create a test voice channel action
		const testAction = {
			guild_id: "1254694808228986912",
			type: "voice_channel_create",
			payload: {
				guild_id: "1254694808228986912",
				user_id: "354823920010002432", // Lucas's user ID
				spawn_channel_id: "1428282734173880440",
				channel_name: "Test Channel",
				user_limit: 0,
			},
		};

		console.log("🔹 Creating test action...");
		const createResult = await db.createAction(testAction);

		if (createResult.success) {
			console.log("✅ Test action created successfully");
			console.log("🔹 Action ID:", createResult.data?.id);

			// Trigger immediate processing
			console.log("🔹 Triggering immediate action processing...");
			await actions.triggerActionProcessing();

			console.log("✅ Test completed!");
		} else {
			console.error("🔸 Failed to create test action:", createResult.error);
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		await client.destroy();
	}
}

testVoiceChannelAction();
