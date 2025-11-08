import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

async function cleanDb() {
	const db = new PostgreSQLManager();

	try {
		console.log("🔹 Connecting to database...");
		const connected = await db.connect();
		if (!connected) {
			console.error("🔸 Failed to connect");
			process.exit(1);
		}
		console.log("✅ Connected\n");

		console.log(
			"⚠️  DROPPING SCHEMA 'public' CASCADE (this deletes ALL tables and data)\n"
		);

		// Drop and recreate the public schema atomically
		const dropResult = await db.query(
			"DROP SCHEMA IF EXISTS public CASCADE;"
		);
		if (!dropResult.success) {
			console.error("🔸 Failed to drop schema:", dropResult.error);
			process.exit(1);
		}
		const createResult = await db.query("CREATE SCHEMA public;");
		if (!createResult.success) {
			console.error("🔸 Failed to recreate schema:", createResult.error);
			process.exit(1);
		}

		console.log("✅ Schema recreated. Database is now empty.\n");
		console.log(
			"🔹 You can now restart the bot to re-initialize tables and resync."
		);
	} catch (error) {
		console.error("🔸 Error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

cleanDb();
