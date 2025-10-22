import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function wipeDatabase() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		console.log("🔸 WARNING: This will delete ALL data from the database!");
		console.log("🔸 Proceeding with database wipe...");

		// Delete all records from all tables
		const tables = [
			"guilds",
			"channels",
			"members",
			"roles",
			"messages",
			"actions",
			"sync_metadata"
		];

		for (const table of tables) {
			try {
				console.log(`🔹 Deleting all records from ${table}...`);
				const result = await db.db.query(`DELETE FROM ${table}`);
				console.log(`🔹 Deleted records from ${table}:`, result);
			} catch (error) {
				console.log(`🔸 Error deleting from ${table}:`, error.message);
			}
		}

		// Verify all tables are empty
		console.log("🔹 Verifying all tables are empty...");
		for (const table of tables) {
			try {
				const countResult = await db.db.query(`SELECT count() FROM ${table}`);
				const count = countResult[0]?.result?.[0]?.["count()"] || 0;
				console.log(`🔹 ${table}: ${count} records`);
			} catch (error) {
				console.log(`🔸 Error counting ${table}:`, error.message);
			}
		}

		console.log("🔹 Database wipe completed!");

	} catch (error) {
		console.error("🔸 Error during database wipe:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

wipeDatabase().catch(console.error);
