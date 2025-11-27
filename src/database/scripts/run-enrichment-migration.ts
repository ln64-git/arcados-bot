import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { PostgreSQLManager } from "../PostgreSQLManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runEnrichmentMigration() {
	console.log("🔄 Running enrichment tracking migration...\n");

	const postgresManager = new PostgreSQLManager();

	try {
		// Connect to PostgreSQL
		await postgresManager.connect();
		console.log("✅ Connected to PostgreSQL\n");

		// Read migration file
		const migrationPath = join(
			__dirname,
			"..",
			"migrations",
			"add-enrichment-tracking.sql",
		);
		const migrationSQL = readFileSync(migrationPath, "utf-8");

		console.log("📄 Executing migration SQL...\n");

		// Execute migration
		const result = await postgresManager.query(migrationSQL);

		if (result.success) {
			console.log("✅ Migration completed successfully!\n");
			console.log("Changes applied:");
			console.log("  - Added enrichment columns to conversation_segments");
			console.log("  - Added enrichment columns to user_profiles");
			console.log("  - Created relationship_profiles table");
			console.log("  - Added enrichment columns to guild_metadata");
			console.log("  - Created indexes for enrichment queries");
			console.log("  - Added utility functions and triggers\n");
		} else {
			console.error("❌ Migration failed:", result.error);
			process.exit(1);
		}
	} catch (error) {
		console.error("❌ Error running migration:", error);
		process.exit(1);
	} finally {
		await postgresManager.disconnect();
		console.log("👋 Disconnected from PostgreSQL");
	}
}

// Run if called directly
runEnrichmentMigration()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("Fatal error:", error);
		process.exit(1);
	});

export { runEnrichmentMigration };
