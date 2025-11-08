import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function checkMessageReplies() {
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

    if (!guildId) {
      console.error("🔸 Usage: npm run check:replies <guild_id>");
      console.error("   Or set GUILD_ID in .env");
      return;
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Checking Message Replies for Guild: ${guildId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Check recent messages (last 20)
    console.log("📨 Most Recent Messages (last 20):");
    console.log("──────────────────────────────────────────────────────────");

    const recentMessages = await db.query(
      `SELECT 
         m.id,
         m.author_id,
         m.content,
         m.created_at,
         m.referenced_message_id,
         mem.display_name,
         mem.username,
         c.name as channel_name
       FROM messages m
       LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
       LEFT JOIN channels c ON m.channel_id = c.id
       WHERE m.guild_id = $1 
         AND m.active = true
       ORDER BY m.created_at DESC
       LIMIT 20`,
      [guildId]
    );

    if (recentMessages.success && recentMessages.data) {
      const nameMap = new Map<string, string>();
      for (const msg of recentMessages.data as any[]) {
        const authorName = msg.display_name || msg.username || msg.author_id;
        nameMap.set(msg.author_id, authorName);
      }

      for (let i = 0; i < recentMessages.data.length; i++) {
        const msg = recentMessages.data[i] as any;
        const timestamp = new Date(msg.created_at).toLocaleString();
        const authorName = nameMap.get(msg.author_id) || msg.author_id;
        const channelName = msg.channel_name ? `#${msg.channel_name}` : msg.channel_id;
        const contentPreview = msg.content
          ? msg.content.substring(0, 80) + (msg.content.length > 80 ? "..." : "")
          : "(no content)";

        console.log(`\n   ${i + 1}. [${timestamp}] ${authorName} in ${channelName}`);
        console.log(`      ID: ${msg.id}`);
        if (msg.referenced_message_id) {
          // Find the referenced message
          const refMsg = (recentMessages.data as any[]).find(
            (m) => m.id === msg.referenced_message_id
          );
          if (refMsg) {
            const refAuthorName = nameMap.get(refMsg.author_id) || refMsg.author_id;
            console.log(`      🔗 Reply to: ${refAuthorName} (${msg.referenced_message_id})`);
          } else {
            console.log(`      🔗 Reply to: ${msg.referenced_message_id} (not in recent list)`);
          }
        }
        console.log(`      Content: ${contentPreview}`);
      }
    }

    // Count messages with replies
    console.log("\n\n📊 Reply Statistics:");
    console.log("──────────────────────────────────────────────────────────");

    const replyStats = await db.query(
      `SELECT 
         COUNT(*) as total_messages,
         COUNT(referenced_message_id) as messages_with_replies,
         COUNT(*) - COUNT(referenced_message_id) as messages_without_replies
       FROM messages
       WHERE guild_id = $1 AND active = true`,
      [guildId]
    );

    if (replyStats.success && replyStats.data) {
      const stats = replyStats.data[0] as any;
      console.log(`   Total messages: ${parseInt(stats.total_messages, 10).toLocaleString()}`);
      console.log(
        `   Messages with replies: ${parseInt(stats.messages_with_replies, 10).toLocaleString()}`
      );
      console.log(
        `   Messages without replies: ${parseInt(stats.messages_without_replies, 10).toLocaleString()}`
      );
    }

    // Show sample of messages with replies
    console.log("\n\n🔗 Sample Messages with Replies (last 10):");
    console.log("──────────────────────────────────────────────────────────");

    const messagesWithReplies = await db.query(
      `SELECT 
         m.id,
         m.author_id,
         m.content,
         m.created_at,
         m.referenced_message_id,
         mem.display_name as author_name,
         mem.username as author_username,
         ref_mem.display_name as ref_author_name,
         ref_mem.username as ref_author_username,
         c.name as channel_name
       FROM messages m
       LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
       LEFT JOIN members ref_mem ON 
         (SELECT author_id FROM messages WHERE id = m.referenced_message_id) = ref_mem.user_id 
         AND m.guild_id = ref_mem.guild_id
       LEFT JOIN channels c ON m.channel_id = c.id
       WHERE m.guild_id = $1 
         AND m.active = true
         AND m.referenced_message_id IS NOT NULL
       ORDER BY m.created_at DESC
       LIMIT 10`,
      [guildId]
    );

    if (messagesWithReplies.success && messagesWithReplies.data) {
      if (messagesWithReplies.data.length === 0) {
        console.log("   📭 No messages with replies found");
      } else {
        for (let i = 0; i < messagesWithReplies.data.length; i++) {
          const msg = messagesWithReplies.data[i] as any;
          const timestamp = new Date(msg.created_at).toLocaleString();
          const authorName = msg.author_name || msg.author_username || msg.author_id;
          const refAuthorName =
            msg.ref_author_name || msg.ref_author_username || "unknown";
          const channelName = msg.channel_name ? `#${msg.channel_name}` : "unknown channel";
          const contentPreview = msg.content
            ? msg.content.substring(0, 60) + (msg.content.length > 60 ? "..." : "")
            : "(no content)";

          console.log(`\n   ${i + 1}. [${timestamp}] ${channelName}`);
          console.log(`      ${authorName} replied to ${refAuthorName}`);
          console.log(`      Reply ID: ${msg.id}`);
          console.log(`      Referenced: ${msg.referenced_message_id}`);
          console.log(`      "${contentPreview}"`);
        }
      }
    }

    // Check for reply chains (message that is both a reply and has replies)
    console.log("\n\n🔗 Reply Chains (messages that both reply and are replied to):");
    console.log("──────────────────────────────────────────────────────────");

    const replyChains = await db.query(
      `SELECT 
         m1.id as message_id,
         m1.author_id,
         m1.referenced_message_id,
         COUNT(m2.id) as reply_count,
         mem.display_name,
         mem.username
       FROM messages m1
       LEFT JOIN messages m2 ON m2.referenced_message_id = m1.id AND m2.active = true
       LEFT JOIN members mem ON m1.author_id = mem.user_id AND m1.guild_id = mem.guild_id
       WHERE m1.guild_id = $1 
         AND m1.active = true
         AND m1.referenced_message_id IS NOT NULL
       GROUP BY m1.id, m1.author_id, m1.referenced_message_id, mem.display_name, mem.username
       HAVING COUNT(m2.id) > 0
       ORDER BY reply_count DESC, m1.created_at DESC
       LIMIT 5`,
      [guildId]
    );

    if (replyChains.success && replyChains.data) {
      if (replyChains.data.length === 0) {
        console.log("   📭 No reply chains found");
      } else {
        for (const chain of replyChains.data as any[]) {
          const authorName = chain.display_name || chain.username || chain.author_id;
          console.log(
            `\n   Message ${chain.message_id} by ${authorName}:`
          );
          console.log(`      Replied to: ${chain.referenced_message_id}`);
          console.log(`      Has ${chain.reply_count} reply(ies)`);
        }
      }
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ Check complete");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

checkMessageReplies();

