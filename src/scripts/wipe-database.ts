#!/usr/bin/env tsx

import {
	dropPostgresTables,
	initializePostgresSchema,
} from "../features/database-manager/PostgresSchema";

async function wipeDatabase(): Promise<void> {
	console.log("🔹 Wiping database: dropping all tables...");
	try {
		await dropPostgresTables();
		console.log("🔹 All tables dropped.");
		console.log("🔹 Recreating schema...");
		await initializePostgresSchema();
		console.log("🔹 Schema recreated successfully.");
		process.exit(0);
	} catch (error) {
		console.error("🔸 Failed to wipe/recreate database:", error);
		process.exit(1);
	}
}

wipeDatabase();
