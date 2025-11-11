import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { config } from "../config/index.js";

async function diagnoseMissingMessage() {
  const messageId = "1437528351089754243";
  const db = new PostgreSQLManager();

  try {
    await db.connect();
    if (!db.isConnected()) {
      console.error("❌ Failed to connect to database");
      process.exit(1);
    }

    console.log(`🔍 Diagnosing missing message: ${messageId}\n`);

    // Parse the message ID to get timestamp (Discord snowflake)
    // Discord snowflakes contain timestamp in the first 42 bits
    const snowflake = BigInt(messageId);
    const timestamp = Number((snowflake >> 22n) + 1420070400000n);
    const messageDate = new Date(timestamp);

    console.log(`📅 Message timestamp: ${messageDate.toISOString()}`);
    console.log(`   (${Math.floor((Date.now() - timestamp) / 1000 / 60)} minutes ago)\n`);

    // Get all channels and their watermarks
    const channelsResult = await db.query(
      `SELECT id, name, guild_id, last_message_id, 
       (SELECT COUNT(*) FROM messages WHERE channel_id = channels.id AND active = true) as message_count
       FROM channels 
       WHERE active = true 
       ORDER BY name`
    );

    if (channelsResult.success && channelsResult.data) {
      console.log(`📋 Found ${channelsResult.data.length} channels in database:\n`);

      for (const channel of channelsResult.data) {
        const channelId = channel.id;
        const watermark = channel.last_message_id;
        const messageCount = parseInt(channel.message_count || "0", 10);

        // Get newest and oldest messages in this channel
        const newestResult = await db.query(
          "SELECT id, created_at FROM messages WHERE channel_id = $1 AND active = true ORDER BY created_at DESC LIMIT 1",
          [channelId]
        );

        const oldestResult = await db.query(
          "SELECT id, created_at FROM messages WHERE channel_id = $1 AND active = true ORDER BY created_at ASC LIMIT 1",
          [channelId]
        );

        let newestTime: Date | null = null;
        let oldestTime: Date | null = null;

        if (newestResult.success && newestResult.data && newestResult.data.length > 0) {
          newestTime = new Date(newestResult.data[0].created_at);
        }

        if (oldestResult.success && oldestResult.data && oldestResult.data.length > 0) {
          oldestTime = new Date(oldestResult.data[0].created_at);
        }

        // Check if message timestamp falls within this channel's range
        const inRange = newestTime && oldestTime && 
          messageDate >= oldestTime && messageDate <= newestTime;

        // Check if watermark is newer than message
        let watermarkTime: Date | null = null;
        if (watermark) {
          const watermarkSnowflake = BigInt(watermark);
          watermarkTime = new Date(Number((watermarkSnowflake >> 22n) + 1420070400000n));
        }

        const couldBeInChannel = !newestTime || !oldestTime || inRange || 
          (messageDate > newestTime && (!watermarkTime || messageDate > watermarkTime));

        if (couldBeInChannel || messageCount === 0) {
          console.log(`📝 Channel: #${channel.name || "unknown"} (${channelId})`);
          console.log(`   Messages in DB: ${messageCount}`);
          console.log(`   Watermark: ${watermark || "NULL"}`);
          
          if (newestTime) {
            console.log(`   Newest in DB: ${newestTime.toISOString()}`);
            const gap = Math.floor((messageDate.getTime() - newestTime.getTime()) / 1000 / 60);
            if (messageDate > newestTime) {
              console.log(`   ⚠️  Message is ${gap} minutes NEWER than newest in DB`);
            } else if (messageDate < newestTime) {
              console.log(`   ℹ️  Message is ${Math.abs(gap)} minutes OLDER than newest in DB`);
            }
          }

          if (oldestTime) {
            console.log(`   Oldest in DB: ${oldestTime.toISOString()}`);
          }

          if (watermarkTime) {
            const watermarkGap = Math.floor((messageDate.getTime() - watermarkTime.getTime()) / 1000 / 60);
            if (messageDate > watermarkTime) {
              console.log(`   ⚠️  Message is ${watermarkGap} minutes NEWER than watermark - should be synced!`);
            } else {
              console.log(`   ℹ️  Message is ${Math.abs(watermarkGap)} minutes OLDER than watermark`);
            }
          } else {
            console.log(`   ⚠️  No watermark set - channel may not be fully synced`);
          }

          // Check for messages around this timestamp (within 1 hour)
          const timeWindow = 60 * 60 * 1000; // 1 hour
          const nearbyResult = await db.query(
            `SELECT id, created_at, 
             EXTRACT(EPOCH FROM (created_at - $1::timestamp)) * 1000 as diff_ms
             FROM messages 
             WHERE channel_id = $2 
             AND active = true 
             AND ABS(EXTRACT(EPOCH FROM (created_at - $1::timestamp)) * 1000) < $3
             ORDER BY created_at DESC 
             LIMIT 5`,
            [messageDate, channelId, timeWindow]
          );

          if (nearbyResult.success && nearbyResult.data && nearbyResult.data.length > 0) {
            console.log(`   📍 Nearby messages (within 1 hour):`);
            for (const msg of nearbyResult.data) {
              const diff = Math.floor(Number(msg.diff_ms) / 1000 / 60);
              console.log(`      - ${msg.id} (${diff > 0 ? '+' : ''}${diff} minutes)`);
            }
          }

          console.log("");
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

diagnoseMissingMessage();

