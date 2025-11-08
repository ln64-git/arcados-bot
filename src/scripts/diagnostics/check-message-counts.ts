import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { config } from "../config/index.js";

async function checkMessages() {
  const db = new PostgreSQLManager();
  await db.connect();

  console.log("📊 Message Statistics:\n");

  // Total messages per guild
  const guildStats = await db.query(`
    SELECT 
      guild_id,
      COUNT(*) as message_count
    FROM messages
    WHERE active = true
    GROUP BY guild_id
    ORDER BY message_count DESC
  `);

  if (guildStats.success && guildStats.data) {
    console.log("📈 Messages per Guild:");
    for (const row of guildStats.data) {
      console.log(`   Guild ${row.guild_id}: ${row.message_count} messages`);
    }
    console.log("");
  }

  // Messages per channel (top 20)
  const channelStats = await db.query(`
    SELECT 
      guild_id,
      channel_id,
      COUNT(*) as message_count
    FROM messages
    WHERE active = true
    GROUP BY guild_id, channel_id
    ORDER BY message_count DESC
    LIMIT 20
  `);

  if (channelStats.success && channelStats.data) {
    console.log("📈 Top 20 Channels by Message Count:");
    for (const row of channelStats.data) {
      console.log(`   Channel ${row.channel_id} (Guild ${row.guild_id}): ${row.message_count} messages`);
    }
    console.log("");
  }

  // Recent messages
  const recentMessages = await db.query(`
    SELECT 
      id,
      guild_id,
      channel_id,
      author_id,
      LEFT(content, 60) as content_preview,
      created_at
    FROM messages
    WHERE active = true
    ORDER BY created_at DESC
    LIMIT 10
  `);

  if (recentMessages.success && recentMessages.data) {
    console.log("📨 Most Recent Messages:");
    for (const row of recentMessages.data) {
      console.log(`   ${row.created_at.toISOString()} | ${row.id.substring(0, 12)}... | Guild: ${row.guild_id} | Channel: ${row.channel_id.substring(0, 12)}... | Author: ${row.author_id.substring(0, 12)}... | ${row.content_preview || "(no content)"}`);
    }
    console.log("");
  }

  // Total count
  const totalCount = await db.query(`
    SELECT COUNT(*) as total
    FROM messages
    WHERE active = true
  `);

  if (totalCount.success && totalCount.data) {
    console.log(`✅ Total active messages: ${totalCount.data[0].total}`);
  }

  await db.disconnect();
  process.exit(0);
}

checkMessages().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

