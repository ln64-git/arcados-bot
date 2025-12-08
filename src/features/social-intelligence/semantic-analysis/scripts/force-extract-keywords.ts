/**
 * Force extract keywords for all conversations
 * Useful after changing keyword extraction parameters
 */

import { PostgreSQLManager } from "../../../../database/PostgreSQLManager";
import { SocialIntelligence } from "../../index";

const guildId = process.env.GUILD_ID || "";

if (!guildId) {
  console.error("Error: GUILD_ID environment variable is required");
  process.exit(1);
}

async function main() {
  const db = new PostgreSQLManager();
  await db.connect();

  const socialIntel = new SocialIntelligence(db);

  // Get all conversations
  const result = await db.query(
    `SELECT id FROM conversation_segments WHERE guild_id = $1 ORDER BY start_time DESC`,
    [guildId]
  );

  if (!result.success || !result.data || result.data.length === 0) {
    console.log("No conversations found");
    await db.disconnect();
    process.exit(0);
  }

  console.log(`🔄 Extracting keywords for ${result.data.length} conversations...`);
  console.log("");

  let success = 0;
  let failed = 0;

  for (const row of result.data) {
    try {
      await socialIntel.enrichConversation(row.id);
      console.log(`  🔹 ${row.id}`);
      success++;
    } catch (error) {
      console.log(`  ❌ ${row.id}: ${error}`);
      failed++;
    }
  }

  console.log("");
  console.log(`🔹 Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);

  await db.disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
