import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { SurrealDBManager } from '../../database/SurrealDBManager.js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const GUILD_ID = process.env.GUILD_ID!;
const DISCORD_TOKEN = process.env.BOT_TOKEN!;

if (!GUILD_ID || !DISCORD_TOKEN) {
  console.error('❌ Missing required environment variables');
  console.error('Required: GUILD_ID, BOT_TOKEN');
  process.exit(1);
}

interface SyncStats {
  channel: string;
  totalMessages: number;
  syncedMessages: number;
  skippedMessages: number;
  failedMessages: number;
  startTime: Date;
  endTime?: Date;
}

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
    await client.login(DISCORD_TOKEN);
    console.log('✅ Connected to Discord');

    // Connect to SurrealDB
    console.log('🔹 Connecting to SurrealDB Cloud...');
    const db = new SurrealDBManager();
    const connected = await db.connect();
    if (!connected) {
      throw new Error('Failed to connect to SurrealDB');
    }
    console.log('✅ Connected to SurrealDB Cloud');

    // Wait for Discord client to initialize
    console.log('🔹 Waiting for Discord client to initialize...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      throw new Error(`Guild ${GUILD_ID} not found`);
    }

    console.log('✅ Found guild:', guild.name);

    // Get all text channels
    const textChannels = guild.channels.cache.filter(
      channel => channel.type === ChannelType.GuildText && channel.isTextBased()
    );

    console.log('\n🔹 Available text channels:');
    const channelList = Array.from(textChannels.values());
    channelList.forEach((channel, index) => {
      console.log(`   ${index + 1}. ${channel.name} (${channel.id})`);
    });

    // Get channel selection from command line argument or prompt
    const channelArg = process.argv[2];
    let selectedChannel;

    if (channelArg) {
      // Try to find channel by name or ID
      selectedChannel = textChannels.find(ch => 
        ch.name.toLowerCase().includes(channelArg.toLowerCase()) || 
        ch.id === channelArg
      );
      
      if (!selectedChannel) {
        console.log(`🔸 Channel "${channelArg}" not found`);
        console.log('Available channels:', channelList.map(ch => ch.name).join(', '));
        process.exit(1);
      }
    } else {
      // Use first channel as default
      selectedChannel = channelList[0];
      console.log(`\n🔹 Using default channel: ${selectedChannel.name}`);
    }

    console.log(`\n🔹 Syncing messages from: ${selectedChannel.name}`);
    console.log(`🔹 Channel ID: ${selectedChannel.id}`);

    const stats: SyncStats = {
      channel: selectedChannel.name,
      totalMessages: 0,
      syncedMessages: 0,
      skippedMessages: 0,
      failedMessages: 0,
      startTime: new Date(),
    };

    // Check if channel exists in database
    console.log('\n🔹 Checking channel in database...');
    try {
      const existingChannel = await db.query(
        'SELECT * FROM channels WHERE id = $channel_id',
        { channel_id: `channels:${GUILD_ID}:${selectedChannel.id}` }
      );
      
      if (existingChannel.length === 0) {
        console.log('🔸 Channel not found in database, syncing channel first...');
        const channelData = {
          id: `channels:${GUILD_ID}:${selectedChannel.id}`,
          guild_id: GUILD_ID,
          name: selectedChannel.name,
          type: selectedChannel.type.toString(),
          position: selectedChannel.position,
          parent_id: selectedChannel.parentId || undefined,
          topic: selectedChannel.topic || undefined,
          nsfw: selectedChannel.nsfw,
          createdAt: selectedChannel.createdAt,
          updatedAt: new Date(),
          active: true,
        };
        
        const channelResult = await db.upsertChannel(channelData);
        if (channelResult.success) {
          console.log('✅ Channel synced to database');
        } else {
          console.log('🔸 Failed to sync channel:', channelResult.error);
        }
      } else {
        console.log('✅ Channel found in database');
      }
    } catch (error) {
      console.log('🔸 Error checking channel:', error);
    }

    // Sync messages
    console.log('\n🔹 Starting message sync...');
    let lastMessageId: string | undefined;
    let batchCount = 0;
    const maxBatches = 100; // Limit to prevent infinite loops
    const batchSize = 100;

    while (batchCount < maxBatches) {
      batchCount++;
      
      console.log(`\n🔹 Batch ${batchCount}: Fetching messages...`);
      
      try {
        const messages = await selectedChannel.messages.fetch({
          limit: batchSize,
          before: lastMessageId,
        });

        if (messages.size === 0) {
          console.log('✅ No more messages to fetch');
          break;
        }

        console.log(`   🔹 Fetched ${messages.size} messages`);

        // Process messages
        let batchSynced = 0;
        let batchSkipped = 0;
        let batchFailed = 0;

        for (const [messageId, message] of messages) {
          stats.totalMessages++;

          try {
            // Skip bot messages and system messages
            if (message.author.bot || message.system) {
              stats.skippedMessages++;
              batchSkipped++;
              continue;
            }

            // Skip empty messages
            if (!message.content && message.attachments.size === 0 && message.embeds.length === 0) {
              stats.skippedMessages++;
              batchSkipped++;
              continue;
            }

            // Prepare message data
            const messageData = {
              id: message.id,
              guild_id: GUILD_ID,
              channel_id: message.channelId,
              author_id: message.author.id,
              content: message.content || '',
              timestamp: message.createdAt,
              attachments: message.attachments.map(att => ({
                id: att.id,
                name: att.name,
                url: att.url,
                size: att.size,
                contentType: att.contentType,
              })),
              embeds: message.embeds.map(embed => ({
                title: embed.title,
                description: embed.description,
                url: embed.url,
                color: embed.color,
                fields: embed.fields,
                footer: embed.footer,
                image: embed.image,
                thumbnail: embed.thumbnail,
                author: embed.author,
                timestamp: embed.timestamp,
              })),
              created_at: message.createdAt,
              updated_at: message.editedAt || message.createdAt,
              active: true,
            };

            // Store message in database
            const result = await db.upsertMessage(messageData);
            if (result.success) {
              stats.syncedMessages++;
              batchSynced++;
            } else {
              stats.failedMessages++;
              batchFailed++;
              console.log(`   🔸 Failed to sync message ${messageId}:`, result.error);
            }

          } catch (error) {
            stats.failedMessages++;
            batchFailed++;
            console.log(`   🔸 Error processing message ${messageId}:`, error);
          }
        }

        console.log(`   ✅ Batch ${batchCount} complete: ${batchSynced} synced, ${batchSkipped} skipped, ${batchFailed} failed`);

        // Update lastMessageId for next batch
        const lastMessage = messages.last();
        if (lastMessage) {
          lastMessageId = lastMessage.id;
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.log(`🔸 Error fetching batch ${batchCount}:`, error);
        break;
      }
    }

    stats.endTime = new Date();
    const duration = stats.endTime.getTime() - stats.startTime.getTime();

    // Final Summary
    console.log('\n🎉 CHANNEL MESSAGE SYNC COMPLETE!');
    console.log('📊 Summary:');
    console.log(`   📺 Channel: ${stats.channel}`);
    console.log(`   📝 Total messages processed: ${stats.totalMessages}`);
    console.log(`   ✅ Messages synced: ${stats.syncedMessages}`);
    console.log(`   ⏭️  Messages skipped: ${stats.skippedMessages}`);
    console.log(`   🔸 Messages failed: ${stats.failedMessages}`);
    console.log(`   📦 Batches processed: ${batchCount}`);
    console.log(`   ⏱️  Duration: ${Math.round(duration / 1000)}s`);

    // Check database state
    console.log('\n🔹 Verifying database state...');
    try {
      const messageCount = await db.query(
        'SELECT count() FROM messages WHERE channel_id = $channel_id',
        { channel_id: selectedChannel.id }
      );
      
      console.log(`📋 Messages in database for ${stats.channel}: ${messageCount[0]?.count || 0}`);
    } catch (error) {
      console.log('🔸 Error checking database state:', error);
    }

  } catch (error) {
    console.error('❌ Sync failed:', error);
  } finally {
    await client.destroy();
    console.log('🔹 Discord client disconnected');
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
