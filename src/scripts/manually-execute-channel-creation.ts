import { SurrealDBManager } from "../database/SurrealDBManager.js";
import { DatabaseActions } from "../features/discord-sync/actions.js";
import { Client, GatewayIntentBits } from "discord.js";

async function manuallyExecuteChannelCreation() {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.GuildMembers,
		],
	});

	const db = new SurrealDBManager();

	try {
		// Connect to Discord
		await client.login(process.env.DISCORD_TOKEN);
		console.log("🔹 Connected to Discord");

		// Connect to database
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Get the pending action
		const result = await db.getPendingActions();
		if (result.success && result.data && result.data.length > 0) {
			const action = result.data[0];
			console.log(`🔹 Found action: ${action.type} - ${action.id}`);
			
			// Parse the payload
			let payload = action.payload;
			if (typeof payload === "string") {
				payload = JSON.parse(payload);
			}
			
			console.log("🔹 Action payload:", payload);

			// Create actions manager
			const actions = new DatabaseActions(client, db);

			// Try to execute the action
			console.log("\n🔹 Attempting to execute action...");
			try {
				await actions.executeAction(action);
				console.log("✅ Action executed successfully");
			} catch (error) {
				console.error("🔸 Error executing action:", error);
			}

		} else {
			console.log("🔸 No pending actions found");
		}

	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		await client.destroy();
	}
}

manuallyExecuteChannelCreation();
