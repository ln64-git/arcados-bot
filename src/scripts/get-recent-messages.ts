import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function getRecentMessages() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Query for the 5 most recent messages
		const query = `
			SELECT * FROM messages 
			WHERE active = true 
			ORDER BY timestamp DESC 
			LIMIT 5
		`;

		console.log("🔹 Querying for 5 most recent messages...");
		const result = await db.db.query(query);

		if (result && result.length > 0 && result[0]) {
			const messages = result[0] as any[];
			console.log(`🔹 Found ${messages.length} recent messages:`);

			messages.forEach((message, index) => {
				console.log(`\n--- Message ${index + 1} ---`);
				console.log(`ID: ${message.id}`);
				console.log(`Channel: ${message.channel_id}`);
				console.log(`Guild: ${message.guild_id}`);
				console.log(`Author: ${message.author_id}`);
				console.log(
					`Content: ${message.content.substring(0, 100)}${message.content.length > 100 ? "..." : ""}`,
				);
				console.log(`Timestamp: ${message.timestamp}`);
				console.log(`Created: ${message.created_at}`);
				console.log(`Updated: ${message.updated_at}`);
			});
		} else {
			console.log("🔹 No messages found in database");
		}
	} catch (error) {
		console.error("🔸 Error getting recent messages:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from SurrealDB");
	}
}

getRecentMessages().catch(console.error);
