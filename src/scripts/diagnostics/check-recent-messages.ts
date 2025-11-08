import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function checkRecentMessages() {
  const db = new PostgreSQLManager();

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect");
      return;
    }

    console.log("✅ Connected\n");

    const guildId = process.env.GUILD_ID || process.argv[2];
    const limit = parseInt(process.argv[3] || "10", 10);

    if (guildId) {
      console.log(`🔹 Checking most recent messages for guild: ${guildId}\n`);
    } else {
      console.log(`🔹 Checking most recent messages (all guilds)\n`);
    }

    let query: string;
    let params: any[];

    if (guildId) {
      query = `
        SELECT 
          m.id,
          m.guild_id,
          m.channel_id,
          c.name as channel_name,
          m.author_id,
          m.content,
          m.created_at,
          m.edited_at,
          array_length(m.attachments, 1) as attachment_count,
          array_length(m.embeds, 1) as embed_count
        FROM messages m
        LEFT JOIN channels c ON m.channel_id = c.id
        WHERE m.guild_id = $1
          AND m.active = true
        ORDER BY m.created_at DESC
        LIMIT $2
      `;
      params = [guildId, limit];
    } else {
      query = `
        SELECT 
          m.id,
          m.guild_id,
          m.channel_id,
          c.name as channel_name,
          m.author_id,
          m.content,
          m.created_at,
          m.edited_at,
          array_length(m.attachments, 1) as attachment_count,
          array_length(m.embeds, 1) as embed_count
        FROM messages m
        LEFT JOIN channels c ON m.channel_id = c.id
        WHERE m.active = true
        ORDER BY m.created_at DESC
        LIMIT $1
      `;
      params = [limit];
    }

    const result = await db.query(query, params);

    if (!result.success || !result.data) {
      console.error("🔸 Failed to query messages:", result.error);
      return;
    }

    if (result.data.length === 0) {
      console.log("📭 No messages found\n");
      return;
    }

    console.log(`📨 Most recent ${result.data.length} message(s):\n`);

    result.data.forEach((msg: any, i: number) => {
      const timestamp = new Date(msg.created_at).toLocaleString();
      const channelName = msg.channel_name ? `#${msg.channel_name}` : msg.channel_id;
      const contentPreview = msg.content
        ? msg.content.substring(0, 100) + (msg.content.length > 100 ? "..." : "")
        : "(no content)";
      
      const attachments = msg.attachment_count > 0 ? ` 📎 ${msg.attachment_count}` : "";
      const embeds = msg.embed_count > 0 ? ` 🔗 ${msg.embed_count}` : "";
      const edited = msg.edited_at ? " ✏️" : "";

      console.log(`${i + 1}. ${timestamp} [${channelName}]`);
      console.log(`   Author: ${msg.author_id}`);
      console.log(`   ${contentPreview}${attachments}${embeds}${edited}`);
      console.log(`   ID: ${msg.id}\n`);
    });

    // Summary stats
    if (guildId) {
      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM messages WHERE guild_id = $1 AND active = true`,
        [guildId]
      );
      if (countResult.success && countResult.data) {
        console.log(`📊 Total messages in guild: ${countResult.data[0].total}`);
      }
    } else {
      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM messages WHERE active = true`
      );
      if (countResult.success && countResult.data) {
        console.log(`📊 Total messages: ${countResult.data[0].total}`);
      }
    }

    console.log("\n✅ Check complete");
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

checkRecentMessages();

