import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";

dotenv.config();

console.log("🔍 Checking Database Table Structure...");

async function main() {
	try {
		// Connect to SurrealDB
		console.log("🔹 Connecting to SurrealDB...");
		const db = new SurrealDBManager();
		await db.connect();
		console.log("✅ Connected to SurrealDB");

		// Check what tables exist
		console.log("🔹 Checking database structure...");

		// Get database info to see all tables
		const dbInfo = await db.db.query("INFO FOR DB");
		console.log("📊 Database Info:", JSON.stringify(dbInfo, null, 2));

		// Try to list all tables
		console.log("🔹 Listing all tables...");
		try {
			const tables = await db.db.query(
				"SELECT * FROM INFORMATION_SCHEMA.TABLES",
			);
			console.log("📋 Tables:", JSON.stringify(tables, null, 2));
		} catch (error) {
			console.log("🔸 Could not query INFORMATION_SCHEMA:", error.message);
		}

		// Check for message-related tables
		console.log("🔹 Checking for message tables...");

		// Try different approaches to find tables
		const possibleQueries = [
			"SELECT * FROM messages LIMIT 1",
			"SELECT * FROM message LIMIT 1",
			"SELECT * FROM discord_messages LIMIT 1",
			"SELECT * FROM guild_messages LIMIT 1",
		];

		for (const query of possibleQueries) {
			try {
				const result = await db.db.query(query);
				console.log(`✅ Query "${query}" succeeded:`, result);
			} catch (error) {
				console.log(`❌ Query "${query}" failed:`, error.message);
			}
		}

		// Check if messages are stored with individual IDs
		console.log("🔹 Checking for individual message records...");
		try {
			// Try to find any record that starts with "messages:"
			const result = await db.db.query(
				"SELECT * FROM messages:1254694808228986912:* LIMIT 5",
			);
			console.log(
				"📨 Individual message records:",
				JSON.stringify(result, null, 2),
			);
		} catch (error) {
			console.log("🔸 Could not query individual messages:", error.message);
		}

		// Check the SurrealDBManager's getMessages method
		console.log("🔹 Testing SurrealDBManager.getMessages()...");
		try {
			const messages = await db.getMessages();
			console.log(`✅ getMessages() returned ${messages.length} messages`);
			if (messages.length > 0) {
				console.log("📨 Sample message:", JSON.stringify(messages[0], null, 2));
			}
		} catch (error) {
			console.log("❌ getMessages() failed:", error.message);
		}
	} catch (error) {
		console.error("❌ Database check failed:", error);
	} finally {
		process.exit(0);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
