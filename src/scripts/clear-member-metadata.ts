#!/usr/bin/env npx tsx

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { PostgreSQLManager } from "../database/PostgreSQLManager.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function clearMemberMetadata() {
	console.log("🔹 Clearing member summaries, keywords, and emojis from PostgreSQL...");

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

		// Clear member metadata fields
		console.log("🔹 Clearing member summaries, keywords, emojis, notes, and relationship_network...");
		
		const result = await db.query(`
			UPDATE members 
			SET 
				summary = NULL,
				keywords = '{}',
				emojis = '{}',
				notes = '{}',
				relationship_network = '[]',
				updated_at = NOW()
			WHERE guild_id = '1254694808228986912'
		`);

		console.log(`✅ Cleared metadata for ${result.rowCount} members`);
		console.log("✅ Member metadata cleared successfully!");
		
		await db.disconnect();
		
	} catch (error) {
		console.error("🔸 Error clearing member metadata:", error);
		process.exit(1);
	}
}

clearMemberMetadata().catch((error) => {
	console.error("🔸 Unhandled error:", error);
	process.exit(1);
});
