import "dotenv/config";
import { PostgreSQLManager } from "../../features/database/PostgreSQLManager.js";

/**
 * Migration: Add AI enhancement tracking fields to conversation_segments table
 *
 * This migration adds fields to track the status of AI-powered post-processing
 * for conversation segments, including topic labeling, summarization, and orphan recovery.
 */
async function runMigration() {
  const db = new PostgreSQLManager();

  console.log("🔹 Starting AI enhancement fields migration...");

  const connected = await db.connect();
  if (!connected) {
    throw new Error("Failed to connect to PostgreSQL for migration");
  }

  try {
    // Add AI processing tracking fields
    console.log("🔹 Adding ai_processing_status, needs_ai_review, ai_processed_at fields...");

    await db.query(`
      ALTER TABLE conversation_segments
      ADD COLUMN IF NOT EXISTS needs_ai_review BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS ai_processing_status VARCHAR(20) DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS ai_metadata JSONB DEFAULT '{}'::jsonb;
    `);

    // Add index for efficient queries of segments needing AI processing
    console.log("🔹 Creating index for AI processing queries...");

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_segments_needing_ai
      ON conversation_segments(guild_id, ai_processing_status)
      WHERE needs_ai_review = TRUE;
    `);

    // Add index for AI processed segments
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_segments_ai_processed
      ON conversation_segments(guild_id, ai_processed_at DESC)
      WHERE ai_processing_status = 'completed';
    `);

    // Update existing segments to mark as needing review
    console.log("🔹 Marking existing segments as needing AI review...");

    const updateResult = await db.query(`
      UPDATE conversation_segments
      SET needs_ai_review = TRUE,
          ai_processing_status = 'pending'
      WHERE ai_processing_status IS NULL
         OR ai_processing_status = '';
    `);

    console.log(`✅ Updated ${updateResult.data?.rowCount || 0} existing segments`);

    // Display summary
    const statsResult = await db.query(`
      SELECT
        ai_processing_status,
        COUNT(*) as count
      FROM conversation_segments
      GROUP BY ai_processing_status
      ORDER BY ai_processing_status;
    `);

    if (statsResult.success && statsResult.data) {
      console.log("\n📊 AI Processing Status Summary:");
      console.log("════════════════════════════════");
      for (const row of statsResult.data) {
        console.log(`  ${row.ai_processing_status || '(null)'}: ${row.count} segments`);
      }
      console.log("════════════════════════════════\n");
    }

    console.log("✅ Migration completed successfully!");
    console.log("\n📝 Notes:");
    console.log("  - All existing segments marked as 'pending' for AI enhancement");
    console.log("  - Run 'npm run ai:enhance' to start processing");
    console.log("  - Fields added:");
    console.log("    • needs_ai_review: Boolean flag for segments needing AI");
    console.log("    • ai_processed_at: Timestamp of last AI processing");
    console.log("    • ai_processing_status: 'pending', 'processing', 'completed', or 'failed'");
    console.log("    • ai_metadata: JSONB field for AI-specific metadata");

  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await db.disconnect();
  }
}

// Run migration if invoked directly
if (process.argv[1]?.includes("add-ai-enhancement-fields")) {
  runMigration().catch((error) => {
    console.error("❌ Migration error:", error);
    process.exit(1);
  });
}

export { runMigration };
