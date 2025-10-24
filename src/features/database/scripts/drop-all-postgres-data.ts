#!/usr/bin/env npx tsx

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { PostgreSQLManager } from "../database/PostgreSQLManager.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function dropAllData() {
	console.log("🔹 Dropping ALL data from PostgreSQL...");

	if (!process.env.POSTGRES_URL) {
		console.error("🔸 POSTGRES_URL not found in environment variables");
		process.exit(1);
	}

	const db = new PostgreSQLManager();

	try {
		const connected = await db.connect();

		if (!connected) {
			console.error("🔸 Failed to connect to PostgreSQL");
			process.exit(1);
		}

		console.log("✅ Connected to PostgreSQL");

		// Drop all data from all tables
		console.log("🔹 Dropping all messages...");
		const messagesResult = await db.query("DELETE FROM messages");
		console.log(`✅ Deleted all messages`);

		console.log("🔹 Dropping all members...");
		const membersResult = await db.query("DELETE FROM members");
		console.log(`✅ Deleted all members`);

		console.log("🔹 Dropping all roles...");
		const rolesResult = await db.query("DELETE FROM roles");
		console.log(`✅ Deleted all roles`);

		console.log("🔹 Dropping all channels...");
		const channelsResult = await db.query("DELETE FROM channels");
		console.log(`✅ Deleted all channels`);

		console.log("🔹 Dropping all guilds...");
		const guildsResult = await db.query("DELETE FROM guilds");
		console.log(`✅ Deleted all guilds`);

		console.log("✅ ALL data dropped successfully!");

		await db.disconnect();
	} catch (error) {
		console.error("🔸 Error dropping all data:", error);
		process.exit(1);
	}
}

dropAllData().catch((error) => {
	console.error("🔸 Unhandled error:", error);
	process.exit(1);
});
