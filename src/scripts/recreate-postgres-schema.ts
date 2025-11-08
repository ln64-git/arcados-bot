import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { config } from "../config/index.js";

async function recreatePostgresSchema() {
	if (!config.postgresUrl) {
		console.error("🔸 PostgreSQL URL not configured.");
		console.error("🔹 Please set POSTGRES_URL in your .env file.");
		process.exit(1);
	}

	const db = new PostgreSQLManager();

	try {
		console.log("🔹 Connecting to database...");
		console.log("🔹 Connection URL:", config.postgresUrl.replace(/:[^:@]+@/, ":****@"));
		const connected = await db.connect();
		if (!connected) {
			console.error("🔸 Failed to connect to PostgreSQL");
			console.error("🔹 Please check:");
			console.error("   - PostgreSQL server is running");
			console.error("   - POSTGRES_URL is correct in .env");
			console.error("   - Network connectivity to the database");
			process.exit(1);
		}
		console.log("✅ Connected\n");

		console.log(
			"⚠️  DROPPING SCHEMA 'public' CASCADE (this deletes ALL tables and data)\n"
		);

		// Drop and recreate the public schema atomically
		const dropResult = await db.query("DROP SCHEMA IF EXISTS public CASCADE;");
		if (!dropResult.success) {
			console.error("🔸 Failed to drop schema:", dropResult.error);
			process.exit(1);
		}
		const createResult = await db.query("CREATE SCHEMA public;");
		if (!createResult.success) {
			console.error("🔸 Failed to recreate schema:", createResult.error);
			process.exit(1);
		}

		console.log("✅ Schema recreated\n");

		// Disconnect and reconnect to trigger schema initialization
		console.log("🔹 Disconnecting...");
		await db.disconnect();

		console.log("🔹 Reconnecting to initialize tables...");
		const reconnected = await db.connect();
		if (!reconnected) {
			console.error("🔸 Failed to reconnect after schema recreation");
			console.error("🔹 Schema was recreated but tables were not initialized");
			console.error("🔹 You may need to restart the bot to initialize tables");
			process.exit(1);
		}

		console.log("✅ Schema recreated and tables initialized.\n");
		console.log("🔹 Database is ready for use.");
	} catch (error) {
		console.error("🔸 Error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

recreatePostgresSchema();

