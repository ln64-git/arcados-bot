import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { config } from "../config/index.js";

async function checkMessageExists() {
  const messageId = "1437528351089754243";
  const db = new PostgreSQLManager();

  try {
    await db.connect();
    if (!db.isConnected()) {
      console.error("❌ Failed to connect to database");
      process.exit(1);
    }

    console.log(`🔍 Checking for message ID: ${messageId}`);

    const result = await db.query(
      "SELECT id, guild_id, channel_id, author_id, content, created_at, active FROM messages WHERE id = $1",
      [messageId]
    );

    if (result.success && result.data && result.data.length > 0) {
      const message = result.data[0];
      console.log("✅ Message found in database:");
      console.log(`   ID: ${message.id}`);
      console.log(`   Guild ID: ${message.guild_id}`);
      console.log(`   Channel ID: ${message.channel_id}`);
      console.log(`   Author ID: ${message.author_id}`);
      console.log(`   Content: ${message.content.substring(0, 100)}${message.content.length > 100 ? "..." : ""}`);
      console.log(`   Created At: ${message.created_at}`);
      console.log(`   Active: ${message.active}`);

      // Also check the channel to see if it has a watermark
      const channelResult = await db.query(
        "SELECT id, name, last_message_id FROM channels WHERE id = $1",
        [message.channel_id]
      );

      if (channelResult.success && channelResult.data && channelResult.data.length > 0) {
        const channel = channelResult.data[0];
        console.log(`\n📝 Channel info:`);
        console.log(`   Name: ${channel.name || "N/A"}`);
        console.log(`   Last Message ID (watermark): ${channel.last_message_id || "NULL"}`);
        
        if (channel.last_message_id && channel.last_message_id !== messageId) {
          console.log(`   ⚠️  Watermark is different from this message ID`);
        }
      }
    } else {
      console.log("❌ Message NOT found in database");
      console.log("\n🔍 Checking if channel exists...");
      
      // Try to find which channel this message might be in by checking Discord
      // But first, let's see if we can get any info about similar message IDs
      const similarResult = await db.query(
        "SELECT id, channel_id, created_at FROM messages WHERE id LIKE $1 ORDER BY created_at DESC LIMIT 5",
        [`${messageId.substring(0, 10)}%`]
      );
      
      if (similarResult.success && similarResult.data && similarResult.data.length > 0) {
        console.log("   Found similar message IDs in database:");
        similarResult.data.forEach((msg: any) => {
          console.log(`   - ${msg.id} (channel: ${msg.channel_id}, created: ${msg.created_at})`);
        });
      }
    }

    await db.disconnect();
  } catch (error) {
    console.error("❌ Error checking message:", error);
    await db.disconnect();
    process.exit(1);
  }
}

checkMessageExists();

