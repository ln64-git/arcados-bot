import { SurrealDBManager } from "../database/SurrealDBManager";
import { DatabaseActions } from "../features/discord-sync/actions";

async function manuallyProcessActions() {
	console.log("🔧 Manually processing pending actions...");

	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("✅ Connected to database");

		// Get pending actions
		const pendingActions = await db.query(
			"SELECT * FROM actions WHERE active = true AND executed = false ORDER BY created_at ASC",
		);
		console.log(`📊 Found ${pendingActions[0]?.length || 0} pending actions`);

		if (
			pendingActions[0] &&
			Array.isArray(pendingActions[0]) &&
			pendingActions[0].length > 0
		) {
			// Create a mock Discord client for the action processor
			const mockClient = {
				guilds: {
					cache: new Map(),
					fetch: async (id: string) => {
						console.log(`🔹 Mock fetch for guild ${id}`);
						return {
							id: id,
							channels: {
								cache: new Map(),
								fetch: async (channelId: string) => {
									console.log(`🔹 Mock fetch for channel ${channelId}`);
									return {
										id: channelId,
										isVoiceBased: () => true,
										delete: async () => {
											console.log(`🔹 Mock delete channel ${channelId}`);
										},
									};
								},
							},
							members: {
								cache: new Map(),
							},
						};
					},
				},
			} as any;

			const actionsManager = new DatabaseActions(mockClient, db);

			console.log("🔹 Processing actions...");
			await actionsManager.processPendingActions();

			console.log("✅ Action processing completed");
		} else {
			console.log("ℹ️ No pending actions to process");
		}
	} catch (error) {
		console.error("🔸 Error processing actions:", error);
	} finally {
		await db.disconnect();
	}
}

manuallyProcessActions().catch(console.error);
