import "dotenv/config";
import path from "node:path";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { ConversationManager } from "../features/relationship-network/ConversationManager.js";

const CHANNEL_ID = process.argv[2] || process.env.CHANNEL_ID;
const HOURS = Number(process.argv[3] || "24");
const GUILD_ID = process.env.GUILD_ID;

if (!GUILD_ID) {
  console.error("❌ GUILD_ID is required (set env or pass manually)");
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error("❌ Channel ID required. Usage: GUILD_ID=... bun run test:channel -- <channelId> [hours]");
  process.exit(1);
}

const runningWithBun =
  Boolean(process.env.BUN_INSTALL) ||
  path.basename(process.argv[0] || "").toLowerCase().includes("bun");

if (!runningWithBun) {
  console.error("⚠️  Please run this script with Bun (bun run test:channel ...) to avoid tsx IPC issues.");
  process.exit(1);
}

async function main() {
  const db = new PostgreSQLManager();
  const connected = await db.connect();
  if (!connected) {
    console.error("❌ Could not connect to PostgreSQL");
    process.exit(1);
  }

  try {
    const manager = new ConversationManager(db);
    const result = await manager.detectConversationsEnhanced(
      CHANNEL_ID,
      GUILD_ID,
      HOURS,
      3
    );

    if (!result.success || !result.data) {
      console.error("❌ Failed to detect conversations:", result.error);
      return;
    }

    console.log(
      `\nFound ${result.data.length} conversations in last ${HOURS}h for channel ${CHANNEL_ID}:\n`
    );
    result.data.forEach((conv, idx) => {
      console.log(`Conversation #${idx + 1}`);
      console.log(`  Messages: ${conv.message_count}`);
      console.log(`  Duration: ${conv.duration_minutes} min`);
      console.log(`  Participants: ${(conv.participants || []).join(", ")}`);
      console.log(`  Start: ${conv.start_time}`);
      console.log(`  End:   ${conv.end_time}`);
      console.log("  Message IDs:", conv.message_ids?.join(", "));
      console.log("──────────────────────────────────────────────");
    });
  } finally {
    await db.disconnect();
  }
}

main().catch((err) => {
  console.error("💥 Error:", err);
  process.exit(1);
});
