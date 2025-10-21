import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function checkUserChannels() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Database connected");

		// Check all channels and their user channel status
		const channelsResult = await db.query(
			"SELECT id, name, is_user_channel, current_owner_id FROM channels WHERE guild_id = '1254694808228986912'"
		);
		
		if (channelsResult[0]) {
			console.log("🔹 Channels in database:");
			for (const channel of channelsResult[0] as any[]) {
				console.log(`  - ${channel.name} (${channel.id})`);
				console.log(`    is_user_channel: ${channel.is_user_channel}`);
				console.log(`    current_owner_id: ${channel.current_owner_id}`);
			}
		}

		// Check for any voice_user_leave actions
		const leaveActionsResult = await db.query(
			"SELECT * FROM actions WHERE type = 'voice_user_leave' ORDER BY created_at DESC LIMIT 5"
		);
		
		if (leaveActionsResult[0]) {
			console.log(`🔹 Found ${(leaveActionsResult[0] as any[]).length} voice_user_leave actions:`);
			for (const action of leaveActionsResult[0] as any[]) {
				console.log(`  - ${action.id} (executed: ${action.executed}, created: ${action.created_at})`);
			}
		} else {
			console.log("🔹 No voice_user_leave actions found");
		}

		console.log("🔹 User channels check completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

checkUserChannels();
