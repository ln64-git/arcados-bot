import { Client, GatewayIntentBits } from 'discord.js';
import { SurrealDBManager } from '../database/SurrealDBManager.js';

const GUILD_ID = '1254694808228986912';

console.log('🔹 Starting FULL Discord Sync...');
console.log('🔹 Target Guild ID:', GUILD_ID);

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  try {
    // Connect to Discord
    console.log('🔹 Connecting to Discord...');
    await client.login(process.env.DISCORD_TOKEN);
    console.log('✅ Connected to Discord');

    // Connect to SurrealDB
    console.log('🔹 Connecting to SurrealDB...');
    const db = new SurrealDBManager();
    await db.connect();
    console.log('✅ Connected to SurrealDB');

    // Wait for Discord client to initialize
    console.log('🔹 Waiting for Discord client to initialize...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      throw new Error('Guild not found');
    }

    console.log('✅ Found guild:', guild.name);
    console.log('🔹 Syncing ALL messages from guild:', guild.name);

    // Get all text channels
    const textChannels = guild.channels.cache.filter(
      channel => channel.type === 0 && channel.isTextBased()
    );

    console.log('🔹 Found', textChannels.size, 'text channels');

    let totalMessages = 0;
    let processedChannels = 0;
    const failedChannels: string[] = [];

    for (const [channelId, channel] of textChannels) {
      processedChannels++;
      console.log(`\n🔹 [${processedChannels}/${textChannels.size}] Syncing channel: ${channel.name}`);
      
      try {
        let channelMessages = 0;
        let lastMessageId: string | undefined;
        let batchCount = 0;
        const maxBatches = 100; // Increased limit for full sync
        const batchSize = 100;

        while (batchCount < maxBatches) {
          batchCount++;
          
          console.log(`   🔹 Batch ${batchCount}: Fetching messages from ${channel.name}...`);
          
          const messages = await channel.messages.fetch({
            limit: batchSize,
            before: lastMessageId,
          });

          if (messages.size === 0) {
            console.log(`   ✅ No more messages in ${channel.name}`);
            break;
          }

          // Process messages
          let batchMessages = 0;
          for (const [messageId, message] of messages) {
            try {
              // Skip bot messages and system messages
              if (message.author.bot || message.system) {
                continue;
              }

              // Store message in database
              await db.upsertMessage({
                guild_id: message.guildId!,
                channel_id: message.channelId,
                author_id: message.author.id,
                content: message.content,
                created_at: message.createdAt,
                updated_at: message.editedAt || message.createdAt,
                active: true,
              });

              batchMessages++;
              channelMessages++;
              totalMessages++;

            } catch (error) {
              console.log(`   🔸 Error processing message ${messageId}:`, error);
              // Continue with next message
            }
          }

          console.log(`   🔹 Processed ${batchMessages} messages (channel total: ${channelMessages})`);

          // Update lastMessageId for next batch
          const lastMessage = messages.last();
          if (lastMessage) {
            lastMessageId = lastMessage.id;
          }

          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        console.log(`✅ Synced ${channelMessages} messages from ${channel.name}`);

        // If we hit max batches, log it
        if (batchCount >= maxBatches) {
          console.log(`⚠️  Hit max batches (${maxBatches}) for ${channel.name}, moving to next channel`);
        }

      } catch (error) {
        console.log(`🔸 Error syncing channel ${channel.name}:`, error);
        failedChannels.push(channel.name);
        // Continue with next channel
      }

      // Small delay between channels
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n🎉 FULL SYNC COMPLETE!');
    console.log('📊 Summary:');
    console.log(`   ✅ Total messages synced: ${totalMessages}`);
    console.log(`   ✅ Channels processed: ${processedChannels}/${textChannels.size}`);
    console.log(`   🔸 Failed channels: ${failedChannels.length}`);
    
    if (failedChannels.length > 0) {
      console.log('   🔸 Failed channels:', failedChannels.join(', '));
    }

    console.log('\n🚀 Ready to test relationship network!');

  } catch (error) {
    console.error('❌ Sync failed:', error);
  } finally {
    await client.destroy();
    process.exit(0);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🔸 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🔸 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
