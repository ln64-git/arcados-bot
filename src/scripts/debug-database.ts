import { SurrealDBManager } from "../database/SurrealDBManager";

async function debugDatabase() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Check all channels in the guild
		console.log("🔹 Checking all channels in guild...");
		const allChannels = await db.query(
			"SELECT * FROM channels WHERE guild_id = '1254694808228986912'",
		);
		console.log("🔹 All channels:", JSON.stringify(allChannels, null, 2));

		// Check specifically for user channels
		console.log("\n🔹 Checking user channels...");
		const userChannels = await db.query(
			"SELECT * FROM channels WHERE guild_id = '1254694808228986912' AND is_user_channel = true",
		);
		console.log("🔹 User channels:", JSON.stringify(userChannels, null, 2));

		// Check the specific channel ID from logs
		console.log("\n🔹 Checking specific channel 1430057804311302305...");
		const specificChannel = await db.query(
			"SELECT * FROM channels WHERE id = '1430057804311302305'",
		);
		console.log(
			"🔹 Specific channel:",
			JSON.stringify(specificChannel, null, 2),
		);

		// Check if there are any channels with is_user_channel field
		console.log("\n🔹 Checking channels with is_user_channel field...");
		const channelsWithField = await db.query(
			"SELECT * FROM channels WHERE guild_id = '1254694808228986912' AND is_user_channel IS NOT NONE",
		);
		console.log(
			"🔹 Channels with is_user_channel field:",
			JSON.stringify(channelsWithField, null, 2),
		);
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

debugDatabase();
