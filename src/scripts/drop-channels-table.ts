#!/usr/bin/env tsx

import { executeQuery } from "../features/database-manager/PostgresConnection";

async function dropChannelsTable(): Promise<void> {
	console.log("🔹 Starting drop for table: channels");

	try {
		// Check if table exists first
		const checkQuery = `
			SELECT EXISTS (
				SELECT FROM information_schema.tables 
				WHERE table_schema = 'public' 
				AND table_name = 'channels'
			);
		`;

		const existsRows = await executeQuery<{ exists: boolean }>(checkQuery);
		const exists = existsRows?.[0]?.exists === true;

		if (!exists) {
			console.log("🔹 Table 'channels' does not exist. Nothing to drop.");
			process.exit(0);
		}

		await executeQuery("DROP TABLE IF EXISTS channels");
		console.log("🔹 Successfully dropped table: channels");
		process.exit(0);
	} catch (error) {
		console.error("🔸 Failed to drop table 'channels':", error);
		process.exit(1);
	}
}

dropChannelsTable();
