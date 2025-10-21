import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function checkChannelNames() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Check for channels with "Channel" in their name
		const result = await db.query(
			"SELECT * FROM channels WHERE name CONTAINS 'Channel' ORDER BY created_at DESC LIMIT 5",
		);

		console.log(
			"Channels with 'Channel' in name:",
			JSON.stringify(result, null, 2),
		);
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

checkChannelNames();
