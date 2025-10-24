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

async function dropGuildData() {
	console.log("🔹 Dropping guild data from PostgreSQL...");

	if (!process.env.POSTGRES_URL) {
		console.error("🔸 POSTGRES_URL not found in environment variables");
		process.exit(1);
	}

	if (!process.env.GUILD_ID) {
		console.error("🔸 GUILD_ID not found in environment variables");
		process.exit(1);
	}

	const guildId = process.env.GUILD_ID;
	console.log(`🔹 Target Guild ID: ${guildId}`);

	const db = new PostgreSQLManager();

	try {
		const connected = await db.connect();

		if (!connected) {
			console.error("🔸 Failed to connect to PostgreSQL");
			process.exit(1);
		}

		console.log("✅ Connected to PostgreSQL");

		// Drop guild data in the correct order (respecting foreign key constraints)
		console.log("🔹 Dropping messages...");
		const messagesResult = await db.query(
			"DELETE FROM messages WHERE guild_id = $1",
			[guildId],
		);
		console.log(`✅ Deleted ${messagesResult.data?.length || 0} messages`);

		console.log("🔹 Dropping members...");
		const membersResult = await db.query(
			"DELETE FROM members WHERE guild_id = $1",
			[guildId],
		);
		console.log(`✅ Deleted ${membersResult.data?.length || 0} members`);

		console.log("🔹 Dropping roles...");
		const rolesResult = await db.query(
			"DELETE FROM roles WHERE guild_id = $1",
			[guildId],
		);
		console.log(`✅ Deleted ${rolesResult.data?.length || 0} roles`);

		console.log("🔹 Dropping channels...");
		const channelsResult = await db.query(
			"DELETE FROM channels WHERE guild_id = $1",
			[guildId],
		);
		console.log(`✅ Deleted ${channelsResult.data?.length || 0} channels`);

		console.log("🔹 Dropping guild...");
		const guildResult = await db.query("DELETE FROM guilds WHERE id = $1", [
			guildId,
		]);
		console.log(`✅ Deleted ${guildResult.data?.length || 0} guild`);

		console.log("✅ Guild data dropped successfully!");

		await db.disconnect();
	} catch (error) {
		console.error("🔸 Error dropping guild data:", error);
		process.exit(1);
	}
}

dropGuildData().catch((error) => {
	console.error("🔸 Unhandled error:", error);
	process.exit(1);
});
