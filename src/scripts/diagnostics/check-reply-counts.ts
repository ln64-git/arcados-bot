import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

async function checkReplyCounts() {
  const db = new PostgreSQLManager();

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect");
      return;
    }

    console.log("✅ Connected\n");

    // Get guild ID from command line args or env
    const guildId = process.argv[2] || process.env.GUILD_ID;

    if (guildId) {
      console.log(`📊 Reply Statistics for Guild: ${guildId}\n`);
    } else {
      console.log("📊 Reply Statistics (All Guilds)\n");
    }

    // Total messages
    const totalQuery = guildId
      ? `SELECT COUNT(*) as total FROM messages WHERE guild_id = $1 AND active = true`
      : `SELECT COUNT(*) as total FROM messages WHERE active = true`;
    const totalResult = await db.query(totalQuery, guildId ? [guildId] : []);

    // Messages with replies
    const withRepliesQuery = guildId
      ? `SELECT COUNT(*) as count FROM messages WHERE guild_id = $1 AND active = true AND referenced_message_id IS NOT NULL`
      : `SELECT COUNT(*) as count FROM messages WHERE active = true AND referenced_message_id IS NOT NULL`;
    const withRepliesResult = await db.query(withRepliesQuery, guildId ? [guildId] : []);

    // Messages without replies
    const withoutRepliesQuery = guildId
      ? `SELECT COUNT(*) as count FROM messages WHERE guild_id = $1 AND active = true AND referenced_message_id IS NULL`
      : `SELECT COUNT(*) as count FROM messages WHERE active = true AND referenced_message_id IS NULL`;
    const withoutRepliesResult = await db.query(withoutRepliesQuery, guildId ? [guildId] : []);

    if (totalResult.success && totalResult.data && withRepliesResult.success && withRepliesResult.data) {
      const total = parseInt(totalResult.data[0].total, 10);
      const withReplies = parseInt(withRepliesResult.data[0].count, 10);
      const withoutReplies = withoutRepliesResult.success && withoutRepliesResult.data
        ? parseInt(withoutRepliesResult.data[0].count, 10)
        : total - withReplies;
      const percentage = total > 0 ? ((withReplies / total) * 100).toFixed(2) : "0.00";

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("📊 Message Reply Statistics:");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      console.log(`   Total messages:      ${total.toLocaleString()}`);
      console.log(`   With replies:       ${withReplies.toLocaleString()} (${percentage}%)`);
      console.log(`   Without replies:    ${withoutReplies.toLocaleString()} (${(100 - parseFloat(percentage)).toFixed(2)}%)`);
      console.log("");

      // Per-guild breakdown if no specific guild
      if (!guildId) {
        const guildBreakdown = await db.query(`
          SELECT 
            guild_id,
            COUNT(*) as total,
            COUNT(CASE WHEN referenced_message_id IS NOT NULL THEN 1 END) as with_replies
          FROM messages
          WHERE active = true
          GROUP BY guild_id
          ORDER BY total DESC
        `);

        if (guildBreakdown.success && guildBreakdown.data) {
          console.log("📊 Per-Guild Breakdown:");
          for (const row of guildBreakdown.data) {
            const guildTotal = parseInt(row.total, 10);
            const guildWithReplies = parseInt(row.with_replies, 10);
            const guildPercentage = guildTotal > 0 ? ((guildWithReplies / guildTotal) * 100).toFixed(2) : "0.00";
            console.log(`   Guild ${row.guild_id}: ${guildTotal.toLocaleString()} total, ${guildWithReplies.toLocaleString()} with replies (${guildPercentage}%)`);
          }
          console.log("");
        }
      }

      // Recent messages with replies
      const recentWithReplies = await db.query(
        guildId
          ? `SELECT id, guild_id, channel_id, author_id, LEFT(content, 60) as content_preview, referenced_message_id, created_at
             FROM messages
             WHERE guild_id = $1 AND active = true AND referenced_message_id IS NOT NULL
             ORDER BY created_at DESC
             LIMIT 10`
          : `SELECT id, guild_id, channel_id, author_id, LEFT(content, 60) as content_preview, referenced_message_id, created_at
             FROM messages
             WHERE active = true AND referenced_message_id IS NOT NULL
             ORDER BY created_at DESC
             LIMIT 10`,
        guildId ? [guildId] : []
      );

      if (recentWithReplies.success && recentWithReplies.data) {
        console.log("📨 Recent Messages with Replies:");
        for (const row of recentWithReplies.data) {
          console.log(
            `   ${new Date(row.created_at).toISOString()} | ${row.id.substring(0, 12)}... | ` +
            `Guild: ${row.guild_id.substring(0, 12)}... | Channel: ${row.channel_id.substring(0, 12)}... | ` +
            `Reply to: ${row.referenced_message_id.substring(0, 12)}... | ${row.content_preview || "(no content)"}`
          );
        }
        console.log("");
      }
    }

    await db.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("🔸 Error:", error);
    process.exit(1);
  }
}

checkReplyCounts();

