import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function checkUserMessages() {
  const db = new PostgreSQLManager();

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect");
      return;
    }

    console.log("✅ Connected\n");

    // Get user ID and guild ID from command line args or env
    const guildId = process.argv[2] || process.env.GUILD_ID;
    const userId = process.argv[3];

    if (!guildId || !userId) {
      console.error("🔸 Usage: npm run check:user-messages <guild_id> <user_id>");
      console.error("   Or set GUILD_ID in .env and pass user_id as first arg");
      return;
    }

    console.log(`🔹 Checking messages for user ${userId} in guild ${guildId}\n`);

    // Count total messages
    const countResult = await db.query(
      `SELECT COUNT(*) as total 
       FROM messages 
       WHERE guild_id = $1 
         AND author_id = $2 
         AND active = true`,
      [guildId, userId]
    );

    if (!countResult.success || !countResult.data) {
      console.error("🔸 Failed to query messages:", countResult.error);
      return;
    }

    const total = parseInt(countResult.data[0].total, 10);

    console.log(`📊 Total messages: ${total}\n`);

    if (total === 0) {
      console.log("📭 No messages found for this user in this guild");
      return;
    }

    // Get message breakdown by channel
    const channelBreakdown = await db.query(
      `SELECT 
         c.name as channel_name,
         m.channel_id,
         COUNT(*) as message_count
       FROM messages m
       LEFT JOIN channels c ON m.channel_id = c.id
       WHERE m.guild_id = $1 
         AND m.author_id = $2 
         AND m.active = true
       GROUP BY m.channel_id, c.name
       ORDER BY message_count DESC
       LIMIT 20`,
      [guildId, userId]
    );

    if (channelBreakdown.success && channelBreakdown.data) {
      console.log("📁 Message breakdown by channel:\n");
      channelBreakdown.data.forEach((row: any, i: number) => {
        const channelName = row.channel_name ? `#${row.channel_name}` : row.channel_id;
        const percentage = ((row.message_count / total) * 100).toFixed(1);
        console.log(`   ${i + 1}. ${channelName}: ${row.message_count} (${percentage}%)`);
      });
      console.log();
    }

    // Get first and last message timestamps
    const timeRangeResult = await db.query(
      `SELECT 
         MIN(created_at) as first_message,
         MAX(created_at) as last_message
       FROM messages 
       WHERE guild_id = $1 
         AND author_id = $2 
         AND active = true`,
      [guildId, userId]
    );

    if (timeRangeResult.success && timeRangeResult.data) {
      const first = new Date(timeRangeResult.data[0].first_message);
      const last = new Date(timeRangeResult.data[0].last_message);
      const daysDiff = Math.floor((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
      
      console.log(`📅 First message: ${first.toLocaleString()}`);
      console.log(`📅 Last message: ${last.toLocaleString()}`);
      console.log(`📅 Span: ${daysDiff} days\n`);
    }

    // Get recent messages
    const recentMessages = await db.query(
      `SELECT 
         m.id,
         c.name as channel_name,
         m.content,
         m.created_at
       FROM messages m
       LEFT JOIN channels c ON m.channel_id = c.id
       WHERE m.guild_id = $1 
         AND m.author_id = $2 
         AND m.active = true
       ORDER BY m.created_at DESC
       LIMIT 5`,
      [guildId, userId]
    );

    if (recentMessages.success && recentMessages.data && recentMessages.data.length > 0) {
      console.log("📨 Most recent messages:\n");
      recentMessages.data.forEach((msg: any, i: number) => {
        const timestamp = new Date(msg.created_at).toLocaleString();
        const channelName = msg.channel_name ? `#${msg.channel_name}` : msg.channel_id;
        const contentPreview = msg.content
          ? msg.content.substring(0, 80) + (msg.content.length > 80 ? "..." : "")
          : "(no content)";
        console.log(`   ${i + 1}. [${timestamp}] ${channelName}`);
        console.log(`      ${contentPreview}`);
        console.log(`      ID: ${msg.id}\n`);
      });
    }

    console.log("✅ Check complete");
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

checkUserMessages();

