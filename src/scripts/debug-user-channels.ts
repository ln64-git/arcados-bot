import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function debugAllUserChannels() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		console.log("🔹 Checking all user channels...");

		// Get all user channels
		const userChannelsResult = await db.query(
			"SELECT * FROM channels WHERE is_user_channel = true",
		);

		console.log(
			"All user channels in DB:",
			JSON.stringify(userChannelsResult, null, 2),
		);

		// Check for channels that might be user channels but not marked as such
		const recentChannelsResult = await db.query(
			"SELECT * FROM channels WHERE created_at > datetime::now() - 1d ORDER BY created_at DESC LIMIT 10",
		);

		console.log(
			"Recent channels (last 24h):",
			JSON.stringify(recentChannelsResult, null, 2),
		);

		// Check specifically for channels with names that suggest they're user channels
		const userNamedChannelsResult = await db.query(
			"SELECT * FROM channels WHERE name CONTAINS 'Channel' ORDER BY created_at DESC LIMIT 5",
		);

		console.log(
			"Channels with 'Channel' in name:",
			JSON.stringify(userNamedChannelsResult, null, 2),
		);
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

debugAllUserChannels();
