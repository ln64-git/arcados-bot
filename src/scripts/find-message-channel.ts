import { Client, GatewayIntentBits } from "discord.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { config } from "../config/index.js";

async function findMessageChannel() {
  const messageId = "1437528351089754243";
  const db = new PostgreSQLManager();

  try {
    await db.connect();
    if (!db.isConnected()) {
      console.error("❌ Failed to connect to database");
      process.exit(1);
    }

    // Initialize Discord client
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    await client.login(config.token);
    console.log("🔹 Logged in to Discord");

    // Wait for client to be ready
    await new Promise((resolve) => client.once("ready", resolve));

    // Try to find the message by searching all guilds and channels
    console.log(`\n🔍 Searching for message ${messageId} in Discord...`);

    let found = false;
    for (const [, guild] of client.guilds.cache) {
      if (config.guildId && guild.id !== config.guildId) {
        continue;
      }

      console.log(`\n📋 Checking guild: ${guild.name} (${guild.id})`);

      for (const [, channel] of guild.channels.cache) {
        if (!channel.isTextBased() || channel.isDMBased()) {
          continue;
        }

        try {
          // Try to fetch the message directly
          const message = await (channel as any).messages.fetch(messageId);
          if (message) {
            found = true;
            console.log(`\n✅ Found message in channel: #${(channel as any).name} (${channel.id})`);
            console.log(`   Guild: ${guild.name} (${guild.id})`);
            console.log(`   Author: ${message.author.tag} (${message.author.id})`);
            console.log(`   Content: ${message.content.substring(0, 100)}${message.content.length > 100 ? "..." : ""}`);
            console.log(`   Created: ${message.createdAt}`);

            // Check if channel is in database
            const channelResult = await db.query(
              "SELECT id, name, last_message_id FROM channels WHERE id = $1",
              [channel.id]
            );

            if (channelResult.success && channelResult.data && channelResult.data.length > 0) {
              const channelData = channelResult.data[0];
              console.log(`\n📝 Channel in database:`);
              console.log(`   Name: ${channelData.name}`);
              console.log(`   Watermark: ${channelData.last_message_id || "NULL"}`);

              // Check if message is in database
              const msgResult = await db.query(
                "SELECT id FROM messages WHERE id = $1",
                [messageId]
              );

              if (msgResult.success && msgResult.data && msgResult.data.length > 0) {
                console.log(`   ✅ Message IS in database`);
              } else {
                console.log(`   ❌ Message is NOT in database`);
                console.log(`\n🔍 Checking message timestamps...`);
                
                // Get newest message in DB for this channel
                const newestInDb = await db.query(
                  "SELECT id, created_at FROM messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 1",
                  [channel.id]
                );

                if (newestInDb.success && newestInDb.data && newestInDb.data.length > 0) {
                  const newest = newestInDb.data[0];
                  const messageTime = message.createdAt.getTime();
                  const newestTime = new Date(newest.created_at).getTime();
                  
                  console.log(`   Message timestamp: ${new Date(messageTime).toISOString()}`);
                  console.log(`   Newest in DB: ${new Date(newestTime).toISOString()}`);
                  
                  if (messageTime > newestTime) {
                    console.log(`   ⚠️  Message is NEWER than newest in DB - should be synced forward from watermark`);
                  } else {
                    console.log(`   ⚠️  Message is OLDER than newest in DB - might be in a gap`);
                  }
                }
              }
            } else {
              console.log(`\n❌ Channel is NOT in database`);
            }

            break;
          }
        } catch (error: any) {
          // Message not found in this channel, continue
          if (error.code !== 10008) { // Unknown Message
            // Other errors might be permission issues, but we'll continue
          }
        }
      }

      if (found) break;
    }

    if (!found) {
      console.log(`\n❌ Message not found in any accessible channel`);
      console.log(`   This could mean:`);
      console.log(`   - The message is in a channel the bot doesn't have access to`);
      console.log(`   - The message was deleted`);
      console.log(`   - The message is in a different guild`);
    }

    await client.destroy();
    await db.disconnect();
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

findMessageChannel();

