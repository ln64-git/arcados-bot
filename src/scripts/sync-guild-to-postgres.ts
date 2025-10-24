#!/usr/bin/env npx tsx

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { GuildSyncManager } from "../features/guild-sync/GuildSyncManager.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
	console.log("🔹 Starting Guild Sync to PostgreSQL...");
	console.log("🔹 Make sure your POSTGRES_URL is configured in your .env file");

	if (!process.env.POSTGRES_URL) {
		console.error("🔸 POSTGRES_URL not found in environment variables");
		console.error("🔸 Please add POSTGRES_URL to your .env file");
		process.exit(1);
	}

	if (!process.env.GUILD_ID) {
		console.error("🔸 GUILD_ID not found in environment variables");
		console.error("🔸 Please add GUILD_ID to your .env file");
		process.exit(1);
	}

	if (!process.env.BOT_TOKEN) {
		console.error("🔸 BOT_TOKEN not found in environment variables");
		console.error("🔸 Please add BOT_TOKEN to your .env file");
		process.exit(1);
	}

	console.log("🔹 Environment variables loaded successfully");
	console.log(`🔹 Target Guild ID: ${process.env.GUILD_ID}`);
	console.log(
		`🔹 PostgreSQL URL: ${process.env.POSTGRES_URL.substring(0, 20)}...`,
	);

	const syncManager = new GuildSyncManager();

	try {
		await syncManager.start();

		// Get and display guild statistics
		console.log("\n🔹 Fetching guild statistics...");
		await syncManager.getGuildStats();

		console.log("\n✅ Guild sync completed successfully!");
		console.log("🔹 Your guild data has been synced to PostgreSQL");
	} catch (error) {
		console.error("🔸 Error during guild sync:", error);
		process.exit(1);
	}
}

// Handle graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🔹 Received SIGINT, shutting down gracefully...");
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.log("\n🔹 Received SIGTERM, shutting down gracefully...");
	process.exit(0);
});

main().catch((error) => {
	console.error("🔸 Unhandled error:", error);
	process.exit(1);
});
