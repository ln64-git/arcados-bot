import "dotenv/config";
import { config } from "../config/index.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { AIManager } from "../features/ai-assistant/AIManager.js";
import {
  EnhancementOrchestrator,
  type EnhancementConfig,
} from "../features/conversation-enhancement/EnhancementOrchestrator.js";

/**
 * AI Conversation Enhancement Script
 *
 * Post-processes conversation segments with AI to:
 * 1. Generate topic labels
 * 2. Create summaries
 * 3. Classify and recover orphaned messages
 * 4. Split long conversations by topic
 *
 * This replaces real-time AI processing with efficient batch enhancement.
 *
 * Usage:
 *   npm run ai:enhance                    # Full enhancement (24h lookback)
 *   npm run ai:enhance:labels             # Topic labeling only
 *   npm run ai:enhance:summaries          # Summaries only
 *   npm run ai:enhance -- --hours 168     # Process last 7 days
 *   npm run ai:enhance -- --dry-run       # Test without writing
 */
async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const guildId = process.env.GUILD_ID || args.find((a) => !a.startsWith("--"));

  if (!guildId) {
    console.error("❌ Usage: ai-enhance-conversations <guild_id> [options]");
    console.error("   Or set GUILD_ID environment variable");
    console.error("\nOptions:");
    console.error("  --hours <N>          Lookback hours (default: 24)");
    console.error("  --batch-size <N>     Segments per batch (default: 10)");
    console.error("  --labels-only        Only generate topic labels");
    console.error("  --summaries-only     Only generate summaries");
    console.error("  --orphans-only       Only classify orphans");
    console.error("  --enable-splitting   Enable conversation splitting (expensive)");
    console.error("  --dry-run            Test without writing to database");
    process.exit(1);
  }

  // Parse configuration
  const enhancementConfig: EnhancementConfig = {
    lookbackHours: parseInt(getArg(args, "--hours") || "24", 10),
    batchSize: parseInt(getArg(args, "--batch-size") || "10", 10),
    enableLabeling: !hasArg(args, "--summaries-only") && !hasArg(args, "--orphans-only"),
    enableSummaries: !hasArg(args, "--labels-only") && !hasArg(args, "--orphans-only"),
    enableOrphans: !hasArg(args, "--labels-only") && !hasArg(args, "--summaries-only"),
    enableSplitting: hasArg(args, "--enable-splitting"),
    dryRun: hasArg(args, "--dry-run"),
  };

  // Initialize services
  const db = new PostgreSQLManager();
  const aiManager = AIManager.getInstance();

  console.log("🤖 AI Conversation Enhancement");
  console.log("═══════════════════════════════════════════════════════════\n");

  const connected = await db.connect();
  if (!connected) {
    throw new Error("Failed to connect to PostgreSQL");
  }

  try {
    // Create orchestrator
    const orchestrator = new EnhancementOrchestrator(db, aiManager, enhancementConfig);

    // Run enhancement pipeline
    const stats = await orchestrator.enhance(guildId);

    // Success
    console.log("✅ Enhancement completed successfully!\n");

    if (enhancementConfig.dryRun) {
      console.log("ℹ️  Dry run mode - no changes written to database");
    }

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Enhancement failed:", error);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

/**
 * Get argument value
 */
function getArg(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined;
}

/**
 * Check if argument exists
 */
function hasArg(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// Run if invoked directly
if (process.argv[1]?.includes("ai-enhance-conversations")) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { main };
