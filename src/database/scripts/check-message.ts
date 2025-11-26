/**
 * Check Message Script
 * 
 * Checks if a specific message exists in Discord and the database
 */

import { PostgreSQLManager } from "../PostgreSQLManager";
import { Client, GatewayIntentBits } from "discord.js";
import { config } from "../../config";

const MESSAGE_ID = "1439478488280072254";

const db = new PostgreSQLManager();

async function main() {
  console.log(`🔍 Checking message: ${MESSAGE_ID}\n`);
  console.log("=".repeat(80));

  // Connect to database
  const connected = await db.connect();
  if (!connected) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  // Check database
  console.log("\n📊 DATABASE CHECK");
  console.log("─".repeat(80));
  const dbResult = await db.query(
    `
    SELECT 
      id, 
      guild_id, 
      channel_id, 
      author_id, 
      content, 
      created_at,
      embedding IS NOT NULL as has_embedding
    FROM messages 
    WHERE id = $1
    `,
    [MESSAGE_ID]
  );

  if (dbResult.success && dbResult.data && dbResult.data.length > 0) {
    const msg = dbResult.data[0];
    console.log("✅ Message EXISTS in database");
    console.log(`   Guild: ${msg.guild_id}`);
    console.log(`   Channel: ${msg.channel_id}`);
    console.log(`   Author: ${msg.author_id}`);
    console.log(`   Created: ${msg.created_at}`);
    console.log(`   Has Embedding: ${msg.has_embedding ? '✅' : '❌'}`);
    console.log(`   Content: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
  } else {
    console.log("❌ Message NOT FOUND in database");
  }

  // Check Discord
  console.log("\n💬 DISCORD CHECK");
  console.log("─".repeat(80));

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  await client.login(config.botToken);

  try {
    // Try to find the message in all channels
    const guildId = config.guildId;
    if (!guildId) {
      console.error("❌ No guild ID configured");
      client.destroy();
      await db.disconnect();
      return;
    }

    const guild = await client.guilds.fetch(guildId);
    console.log(`🔍 Searching in guild: ${guild.name}`);

    let foundInDiscord = false;
    let channelName = '';
    let messageData: any = null;

    // Fetch all text channels
    const channels = guild.channels.cache.filter((ch: any) => ch.isTextBased());
    console.log(`   Checking ${channels.size} channels...`);

    for (const [, channel] of channels) {
      try {
        const msg = await (channel as any).messages.fetch(MESSAGE_ID);
        if (msg) {
          foundInDiscord = true;
          channelName = (channel as any).name;
          messageData = msg;
          break;
        }
      } catch (error) {
        // Message not in this channel, continue
      }
    }

    if (foundInDiscord && messageData) {
      console.log(`✅ Message EXISTS in Discord`);
      console.log(`   Channel: #${channelName}`);
      console.log(`   Author: ${messageData.author.tag} (${messageData.author.id})`);
      console.log(`   Created: ${messageData.createdAt.toLocaleString()}`);
      console.log(`   Bot: ${messageData.author.bot ? 'Yes' : 'No'}`);
      console.log(`   Content: ${messageData.content.substring(0, 100)}${messageData.content.length > 100 ? '...' : ''}`);
      
      // Check if it should have been synced
      const messageAge = Date.now() - messageData.createdTimestamp;
      const ageMinutes = Math.floor(messageAge / 1000 / 60);
      const ageHours = Math.floor(ageMinutes / 60);
      console.log(`   Age: ${ageHours}h ${ageMinutes % 60}m`);

      if (dbResult.success && (!dbResult.data || dbResult.data.length === 0)) {
        console.log("\n⚠️  SYNC ISSUE DETECTED:");
        console.log("   Message exists in Discord but NOT in database!");
        console.log("   This message should have been synced.");
        
        // Check watermark
        const watermarkResult = await db.query(
          `SELECT latest_message_id, updated_at FROM channel_watermarks WHERE channel_id = $1`,
          [messageData.channel.id]
        );
        
        if (watermarkResult.success && watermarkResult.data && watermarkResult.data.length > 0) {
          const watermark = watermarkResult.data[0];
          console.log(`\n   Channel watermark: ${watermark.latest_message_id}`);
          console.log(`   Watermark updated: ${watermark.updated_at}`);
          console.log(`   Message ID: ${MESSAGE_ID}`);
          
          // Compare message IDs (larger ID = newer message)
          if (BigInt(MESSAGE_ID) > BigInt(watermark.latest_message_id)) {
            console.log("   ❌ Message is NEWER than watermark - not synced yet");
          } else if (BigInt(MESSAGE_ID) < BigInt(watermark.latest_message_id)) {
            console.log("   ❌ Message is OLDER than watermark - gap in sync!");
          } else {
            console.log("   ⚠️  Message IS the watermark but not in DB!");
          }
        } else {
          console.log("\n   ℹ️  No watermark found for this channel");
        }
      }
    } else {
      console.log("❌ Message NOT FOUND in Discord");
      console.log("   The message may have been deleted or is in a DM/inaccessible channel");
    }

  } catch (error) {
    console.error("❌ Error checking Discord:", error);
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Check complete\n");

  client.destroy();
  await db.disconnect();
}

main().catch(console.error);

