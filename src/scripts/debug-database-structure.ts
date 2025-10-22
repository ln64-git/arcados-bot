import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function debugDatabaseStructure() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Check database structure
		console.log("🔹 Checking database structure...");
		const dbInfo = await db.db.query("INFO FOR DB");
		console.log("Database info:", JSON.stringify(dbInfo, null, 2));

		// Check if messages table exists
		console.log("🔹 Checking messages table info...");
		const messagesInfo = await db.db.query("INFO FOR TABLE messages");
		console.log("Messages table info:", JSON.stringify(messagesInfo, null, 2));

		// Try to find any records that contain 'message' in the ID
		console.log("🔹 Searching for any message-related records...");
		const allRecords = await db.db.query("SELECT * FROM messages");
		console.log("All messages records:", allRecords);

		// Try a different approach - check if the record exists with a different query
		console.log("🔹 Checking if test message exists with different query...");
		const exists = await db.db.query("SELECT * FROM messages WHERE id CONTAINS 'test-message-123'");
		console.log("Exists query result:", exists);

		// Check what tables actually exist
		console.log("🔹 Checking what tables exist...");
		const tables = await db.db.query("SELECT * FROM $tables");
		console.log("Tables:", tables);

	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

debugDatabaseStructure().catch(console.error);
