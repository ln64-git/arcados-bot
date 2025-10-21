import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function checkInactiveChannels() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Check for inactive user channels
		const inactiveChannelsResult = await db.query(
			"SELECT * FROM channels WHERE is_user_channel = true AND active = false ORDER BY created_at DESC LIMIT 5",
		);

		console.log(
			"Inactive user channels:",
			JSON.stringify(inactiveChannelsResult, null, 2),
		);

		// Check for any channels with 'Channel' in name
		const channelNamedResult = await db.query(
			"SELECT * FROM channels WHERE name CONTAINS 'Channel' ORDER BY created_at DESC LIMIT 5",
		);

		console.log(
			"Channels with 'Channel' in name:",
			JSON.stringify(channelNamedResult, null, 2),
		);
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

checkInactiveChannels();
