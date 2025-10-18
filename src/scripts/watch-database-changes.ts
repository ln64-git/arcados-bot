#!/usr/bin/env tsx

import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";
import type { SurrealMember } from "../database/schema";

class DatabaseWatcher {
	private db: SurrealDBManager;

	constructor() {
		this.db = new SurrealDBManager();
	}

	async initialize(): Promise<void> {
		console.log("🔹 Initializing Database Watcher...");

		// Connect to database
		await this.db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Set up live query to watch for member changes
		this.setupDatabaseWatcher();

		console.log("🔹 Database Watcher initialized and ready!");
		console.log("🔹 Watching for member changes in the database...");
		console.log(
			"🔹 Start the main bot and change your Discord profile to see real-time tracking!",
		);
	}

	private setupDatabaseWatcher(): void {
		// Set up live query to watch for member changes in the database
		this.db.subscribeToMembers((action: string, data: unknown) => {
			if (action === "UPDATE" && data) {
				const member = data as SurrealMember;
				console.log("\n🔹 Database Live Update Detected!");
				console.log(
					"🔹 Member:",
					member.display_name,
					"(" + member.user_id + ")",
				);
				console.log("🔹 Action:", action);
				console.log("🔹 Updated at:", member.updated_at);

				if (member.profile_history && member.profile_history.length > 0) {
					const latestHistory =
						member.profile_history[member.profile_history.length - 1];
					console.log("🔹 Latest profile change:", latestHistory);
					console.log(
						"🔹 Total history entries:",
						member.profile_history.length,
					);
				} else {
					console.log("🔹 No profile history found");
				}
			} else if (action === "CREATE" && data) {
				const member = data as SurrealMember;
				console.log("\n🔹 New Member Created!");
				console.log(
					"🔹 Member:",
					member.display_name,
					"(" + member.user_id + ")",
				);
			}
		});
	}

	async shutdown(): Promise<void> {
		console.log("\n🔹 Shutting down Database Watcher...");
		await this.db.disconnect();
		console.log("🔹 Database Watcher shut down");
	}
}

// Main execution
async function main() {
	const watcher = new DatabaseWatcher();

	// Handle graceful shutdown
	process.on("SIGINT", async () => {
		console.log("\n🔹 Received SIGINT, shutting down...");
		await watcher.shutdown();
		process.exit(0);
	});

	process.on("SIGTERM", async () => {
		console.log("\n🔹 Received SIGTERM, shutting down...");
		await watcher.shutdown();
		process.exit(0);
	});

	try {
		await watcher.initialize();
	} catch (error) {
		console.error("🔸 Failed to initialize Database Watcher:", error);
		process.exit(1);
	}
}

// Run the script
main().catch(console.error);

export { DatabaseWatcher };
