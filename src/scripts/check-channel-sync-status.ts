import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { config } from "../config/index.js";

async function checkChannelSyncStatus() {
  const messageId = "1437528351089754243";
  const db = new PostgreSQLManager();

  try {
    await db.connect();
    if (!db.isConnected()) {
      console.error("❌ Failed to connect to database");
      process.exit(1);
    }

    // Parse message timestamp
    const snowflake = BigInt(messageId);
    const timestamp = Number((snowflake >> 22n) + 1420070400000n);
    const messageDate = new Date(timestamp);

    console.log(`🔍 Checking sync status for message ${messageId}`);
    console.log(`   Timestamp: ${messageDate.toISOString()}\n`);

    // Check the most likely channels
    const likelyChannels = [
      "1254695279311978526", // #chat
      "1254696036988092437", // #vc-logs
      "1427152903260344350", // #🌿 - Cantina
    ];

    for (const channelId of likelyChannels) {
      console.log(`\n📝 Channel: ${channelId}`);
      
      // Get channel info
      const channelResult = await db.query(
        "SELECT id, name, last_message_id FROM channels WHERE id = $1",
        [channelId]
      );

      if (channelResult.success && channelResult.data && channelResult.data.length > 0) {
        const channel = channelResult.data[0];
        console.log(`   Name: ${channel.name || "unknown"}`);
        console.log(`   Watermark: ${channel.last_message_id || "NULL"}`);

        // Get newest message in DB
        const newestResult = await db.query(
          "SELECT id, created_at FROM messages WHERE channel_id = $1 AND active = true ORDER BY created_at DESC LIMIT 1",
          [channelId]
        );

        if (newestResult.success && newestResult.data && newestResult.data.length > 0) {
          const newest = newestResult.data[0];
          const newestTime = new Date(newest.created_at);
          const gap = Math.floor((messageDate.getTime() - newestTime.getTime()) / 1000 / 60);
          
          console.log(`   Newest in DB: ${newestTime.toISOString()} (${newest.id})`);
          console.log(`   Gap: ${gap} minutes`);

          // Check if message exists
          const msgResult = await db.query(
            "SELECT id, created_at FROM messages WHERE id = $1",
            [messageId]
          );

          if (msgResult.success && msgResult.data && msgResult.data.length > 0) {
            console.log(`   ✅ MESSAGE FOUND IN THIS CHANNEL!`);
            break;
          } else {
            console.log(`   ❌ Message not in DB`);
            
            // Check for messages around this time
            const nearbyResult = await db.query(
              `SELECT id, created_at, 
               EXTRACT(EPOCH FROM (created_at - $1::timestamp)) * 1000 as diff_ms
               FROM messages 
               WHERE channel_id = $2 
               AND active = true 
               AND ABS(EXTRACT(EPOCH FROM (created_at - $1::timestamp)) * 1000) < 3600000
               ORDER BY created_at DESC 
               LIMIT 10`,
              [messageDate, channelId]
            );

            if (nearbyResult.success && nearbyResult.data && nearbyResult.data.length > 0) {
              console.log(`   📍 Messages within 1 hour:`);
              for (const msg of nearbyResult.data) {
                const diff = Math.floor(Number(msg.diff_ms) / 1000 / 60);
                console.log(`      ${msg.id} (${diff > 0 ? '+' : ''}${diff} min)`);
              }
            } else {
              console.log(`   ⚠️  No messages within 1 hour - possible gap!`);
            }
          }
        }
      }
    }

    await db.disconnect();
  } catch (error) {
    console.error("❌ Error:", error);
    await db.disconnect();
    process.exit(1);
  }
}

checkChannelSyncStatus();

