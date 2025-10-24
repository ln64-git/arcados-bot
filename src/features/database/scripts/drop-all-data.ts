import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";

dotenv.config();

console.log("🗑️  Dropping All Database Data...");

async function main() {
	try {
		const db = new SurrealDBManager();
		await db.connect();
		console.log("✅ Connected to SurrealDB");

		// Drop all tables
		const dropQueries = [
			"REMOVE TABLE messages",
			"REMOVE TABLE members",
			"REMOVE TABLE channels",
			"REMOVE TABLE guilds",
			"REMOVE TABLE relationships",
		];

		console.log("🔹 Dropping all tables...");
		for (const query of dropQueries) {
			try {
				await db.db.query(query);
				console.log(`✅ ${query}`);
			} catch (error) {
				console.log(`⚠️  ${query} - ${error.message}`);
			}
		}

		// Verify database is empty
		console.log("🔹 Verifying database is empty...");
		try {
			const messages = await db.getMessages();
			console.log(`📊 Messages remaining: ${messages.length}`);

			if (messages.length === 0) {
				console.log("✅ Database successfully cleared!");
			} else {
				console.log("⚠️  Some data may still remain");
			}
		} catch (error) {
			console.log("✅ Messages table successfully removed");
		}
	} catch (error) {
		console.error("❌ Drop operation failed:", error.message);
	} finally {
		process.exit(0);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
