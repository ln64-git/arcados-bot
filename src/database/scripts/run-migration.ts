#!/usr/bin/env tsx
/**
 * Run Migration Script
 * 
 * Executes a SQL migration file against the database
 */

import { PostgreSQLManager } from "../PostgreSQLManager.js";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  const migrationFile = args[0];

  if (!migrationFile) {
    console.error("❌ No migration file specified");
    console.error("Usage: tsx src/database/scripts/run-migration.ts <migration-file>");
    console.error("Example: tsx src/database/scripts/run-migration.ts centralize-user-profiles.sql");
    process.exit(1);
  }

  const db = new PostgreSQLManager();
  
  console.log("🔧 Running Migration");
  console.log("=".repeat(80));
  console.log(`Migration file: ${migrationFile}`);
  console.log("=".repeat(80));

  const connected = await db.connect();
  if (!connected) {
    console.error("❌ Failed to connect to database");
    console.error("💡 Make sure POSTGRES_URL is set in your .env file");
    process.exit(1);
  }

  try {
    // Read migration file
    const migrationPath = join(__dirname, "..", "migrations", migrationFile);
    console.log(`\n📄 Reading migration file: ${migrationPath}`);
    
    const migrationSQL = readFileSync(migrationPath, "utf-8");
    
    // Execute migration
    console.log("\n🚀 Executing migration...\n");
    const result = await db.query(migrationSQL);
    
    if (result.success) {
      console.log("🔹 Migration completed successfully!");
      console.log("\n📊 Migration Summary:");
      console.log("   - Created user_profiles table");
      console.log("   - Created indexes for AI retrieval");
      console.log("   - Migrated existing data from members table");
      console.log("   - Ready for use!");
    } else {
      console.error("❌ Migration failed:");
      console.error(result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Error running migration:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await db.disconnect();
    console.log("\n🔌 Disconnected from database");
  }
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

