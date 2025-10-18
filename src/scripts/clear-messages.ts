import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function clearMessagesTable() {
	const db = new SurrealDBManager();

	try {
		console.log("🔹 Connecting to SurrealDB...");
		await db.connect();
		console.log("🔹 Connected successfully");

		console.log("🔹 Clearing messages table...");

		// Delete all messages
		const deleteResult = await db.db.query(`DELETE FROM messages`);
		console.log("🔹 Delete result:", deleteResult);

		console.log("🔹 Messages table cleared successfully");
		console.log(
			"🔹 Next time you run the bot, it will sync messages with proper guild_id",
		);
	} catch (error) {
		console.error("🔸 Error clearing messages:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

clearMessagesTable().catch(console.error);
