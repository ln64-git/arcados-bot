#!/usr/bin/env tsx

import { executeQuery } from "../features/database-manager/PostgresConnection";

async function dropChannelsSequence(): Promise<void> {
	console.log("🔹 Starting drop for sequence: channels_id_seq");
	try {
		await executeQuery("DROP SEQUENCE IF EXISTS channels_id_seq CASCADE");
		console.log("🔹 Successfully dropped sequence: channels_id_seq");
		process.exit(0);
	} catch (error) {
		console.error("🔸 Failed to drop sequence 'channels_id_seq':", error);
		process.exit(1);
	}
}

dropChannelsSequence();
