import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager.js";
import { DatabaseActions } from "../features/discord-sync/actions.js";

async function testEnhancedActionProcessor() {
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

		// Check current pending actions
		const result = await db.getPendingActions();
		if (result.success && result.data) {
			console.log(`🔹 Found ${result.data.length} pending actions`);

			if (result.data.length > 0) {
				console.log("🔹 Action types breakdown:");
				const actionTypes = result.data.reduce(
					(acc: Record<string, number>, action: any) => {
						acc[action.type] = (acc[action.type] || 0) + 1;
						return acc;
					},
					{},
				);
				console.log(actionTypes);
			}
		}

		// Test manual action processing
		console.log("\n🔹 Testing manual action processing...");
		await actions.triggerActionProcessing();

		console.log("\n🔹 Test completed successfully");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		client.destroy();
	}
}

testEnhancedActionProcessor();
