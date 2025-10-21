import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager.js";
import { DatabaseActions } from "../features/discord-sync/actions.js";

async function testActionProcessorDiagnostic() {
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

		// Get pending actions count
		const result = await db.getPendingActions();
		if (result.success && result.data) {
			console.log(`🔹 Found ${result.data.length} pending actions`);

			// Process first 5 actions to see what happens
			const actionsToProcess = result.data.slice(0, 5);
			console.log(`🔹 Processing first ${actionsToProcess.length} actions...`);

			for (let i = 0; i < actionsToProcess.length; i++) {
				const action = actionsToProcess[i];
				console.log(
					`\n🔹 Processing action ${i + 1}/${actionsToProcess.length}: ${action.id}`,
				);
				console.log(`   Type: ${action.type}`);
				console.log(`   Created: ${action.created_at}`);
				console.log(`   Executed: ${action.executed}`);
				console.log(`   Active: ${action.active}`);

				try {
					// Try to process the action
					const payload = JSON.parse(action.payload);
					console.log(`   Payload keys: ${Object.keys(payload).join(", ")}`);

					// Mark as executed BEFORE processing (like the real processor does)
					const markResult = await db.markActionExecuted(action.id);
					if (markResult.success) {
						console.log(`   ✅ Marked as executed`);
					} else {
						console.log(
							`   🔸 Failed to mark as executed: ${markResult.error}`,
						);
					}

					// Try to execute the handler
					const handler = actions.actionHandlers.get(action.type);
					if (handler) {
						console.log(`   🔹 Executing handler for ${action.type}`);
						await handler(payload);
						console.log(`   ✅ Handler executed successfully`);
					} else {
						console.log(`   🔸 No handler found for ${action.type}`);
					}
				} catch (error) {
					console.error(`   🔸 Error processing action ${action.id}:`, error);
				}

				// Check if we can still get pending actions after each one
				const checkResult = await db.getPendingActions();
				if (checkResult.success && checkResult.data) {
					console.log(
						`   📊 Remaining pending actions: ${checkResult.data.length}`,
					);
				} else {
					console.log(
						`   🔸 Failed to check remaining actions: ${checkResult.error}`,
					);
				}
			}

			// Final check
			const finalResult = await db.getPendingActions();
			if (finalResult.success && finalResult.data) {
				console.log(
					`\n🔹 Final pending actions count: ${finalResult.data.length}`,
				);
			}
		} else {
			console.log("🔸 Failed to get pending actions:", result.error);
		}

		console.log("🔹 Action processor diagnostic completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		client.destroy();
	}
}

testActionProcessorDiagnostic();
