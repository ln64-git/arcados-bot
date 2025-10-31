import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function checkChannelReplies() {
  const db = new PostgreSQLManager();

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect");
      return;
    }

    console.log("✅ Connected\n");

    const channelId = process.argv[2];

    if (!channelId) {
      console.error("🔸 Usage: npm run check:channel-replies <channel_id>");
      return;
    }

    // Get channel name
    const channelResult = await db.query(
      "SELECT name, guild_id FROM channels WHERE id = $1",
      [channelId]
    );

    const channelName =
      channelResult.success && channelResult.data && channelResult.data.length > 0
        ? channelResult.data[0].name
        : channelId;

    // Count total messages
    const totalResult = await db.query(
      "SELECT COUNT(*) as count FROM messages WHERE channel_id = $1 AND active = true",
      [channelId]
    );

    const totalMessages =
      totalResult.success && totalResult.data && totalResult.data.length > 0
        ? parseInt(totalResult.data[0].count, 10)
        : 0;

    // Count messages with replies
    const repliesResult = await db.query(
      "SELECT COUNT(*) as count FROM messages WHERE channel_id = $1 AND active = true AND referenced_message_id IS NOT NULL",
      [channelId]
    );

    const messagesWithReplies =
      repliesResult.success && repliesResult.data && repliesResult.data.length > 0
        ? parseInt(repliesResult.data[0].count, 10)
        : 0;

    // Get sample messages that should have replies but don't
    const sampleResult = await db.query(
      `SELECT 
        m.id,
        m.content,
        m.created_at,
        m.referenced_message_id,
        u.username,
        u.display_name
      FROM messages m
      LEFT JOIN members u ON u.user_id = m.author_id AND u.guild_id = m.guild_id
      WHERE m.channel_id = $1 
        AND m.active = true 
        AND m.referenced_message_id IS NULL
      ORDER BY m.created_at DESC
      LIMIT 20`,
      [channelId]
    );

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Channel: #${channelName} (${channelId})`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log(`📊 Statistics:`);
    console.log(`   Total messages: ${totalMessages.toLocaleString()}`);
    console.log(`   With replies: ${messagesWithReplies.toLocaleString()} (${((messagesWithReplies / totalMessages) * 100).toFixed(2)}%)`);
    console.log(`   Without replies: ${(totalMessages - messagesWithReplies).toLocaleString()}\n`);

    if (sampleResult.success && sampleResult.data && sampleResult.data.length > 0) {
      console.log(`📋 Sample messages without reply references (last 20):\n`);
      for (const msg of sampleResult.data.slice(0, 10)) {
        const displayName = msg.display_name || msg.username || msg.author_id;
        const preview = msg.content ? (msg.content.substring(0, 50) + (msg.content.length > 50 ? "..." : "")) : "(no content)";
        console.log(`   ${msg.id} | @${displayName} | ${preview}`);
        console.log(`      Created: ${new Date(msg.created_at).toISOString()}`);
        console.log(`      Referenced: ${msg.referenced_message_id || "NULL"}`);
        console.log();
      }
    }
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

checkChannelReplies();

