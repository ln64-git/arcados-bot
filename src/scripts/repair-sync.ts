/**
 * Repair Discord Sync Script
 * 
 * Forces a complete resync of all channels, filling any gaps in message history
 */

import { Client, GatewayIntentBits } from "discord.js";
import { PostgreSQLManager } from "../database/PostgreSQLManager";
import { EmbeddingService } from "../features/social-intelligence/semantic-analysis/EmbeddingService";
import { config } from "../config";

const db = new PostgreSQLManager();
const embeddingService = EmbeddingService.getInstance();

interface RepairStats {
  channelsChecked: number;
  messagesFound: number;
  messagesAdded: number;
  embeddings: number;
  errors: number;
}

async function repairChannel(
  client: Client,
  channelId: string,
  guildId: string,
  stats: RepairStats
): Promise<void> {
  const channel = client.channels.cache.get(channelId);
  if (!channel || !(channel as any).isTextBased()) {
    console.log(`   ⚠️  Channel ${channelId} not found or not text-based`);
    return;
  }

  const channelName = (channel as any).name || channelId;
  console.log(`\n📝 Repairing channel: #${channelName}`);
  console.log("─".repeat(80));

  // Get all existing message IDs in database for this channel
  const existingResult = await db.query(
    `SELECT id FROM messages WHERE channel_id = $1 ORDER BY created_at DESC`,
    [channelId]
  );

  const existingIds = new Set<string>();
  if (existingResult.success && existingResult.data) {
    existingResult.data.forEach((row: any) => existingIds.add(row.id));
  }

  console.log(`   📊 Database has ${existingIds.size} messages`);

  // Fetch ALL messages from Discord
  let lastId: string | undefined = undefined;
  let totalFetched = 0;
  let added = 0;
  const batchSize = 100;

  while (true) {
    try {
      const options: any = { limit: batchSize };
      if (lastId) {
        options.before = lastId;
      }

      const messages = await (channel as any).messages.fetch(options);
      if (!messages || messages.size === 0) break;

      totalFetched += messages.size;
      stats.messagesFound += messages.size;

      // Process messages in this batch
      for (const [, msg] of messages) {
        if (!existingIds.has(msg.id)) {
          // Message is missing from database - add it
          console.log(`   + Adding message ${msg.id} from @${msg.author.tag}`);

          // Generate embedding if message has content
          let embedding: number[] | undefined = undefined;
          if (msg.content && msg.content.trim().length > 0) {
            try {
              embedding = await embeddingService.generateEmbedding(msg.content);
              stats.embeddings++;
            } catch (error) {
              console.error(`      ⚠️  Failed to generate embedding: ${error}`);
            }
          }

          // Insert message
          const result = await db.upsertMessage({
            id: msg.id,
            guild_id: guildId,
            channel_id: channelId,
            author_id: msg.author.id,
            content: msg.content || "",
            created_at: msg.createdAt,
            edited_at: msg.editedAt || undefined,
            attachments: Array.from(msg.attachments.values()).map((a: any) => a.url),
            embeds: msg.embeds.map((e: any) => JSON.stringify(e.toJSON())),
            referenced_message_id: msg.reference?.messageId || undefined,
            embedding: embedding,
            active: true,
          });

          if (result.success) {
            added++;
            stats.messagesAdded++;
          } else {
            console.error(`      ❌ Failed to add message: ${result.error}`);
            stats.errors++;
          }
        }
      }

      // Log progress
      if (totalFetched % 500 === 0) {
        console.log(`   ... fetched ${totalFetched} messages (added ${added} new)`);
      }

      if (messages.size < batchSize) break;
      lastId = messages.last()?.id;
      if (!lastId) break;

    } catch (error) {
      console.error(`   ❌ Error fetching messages: ${error}`);
      stats.errors++;
      break;
    }
  }

  console.log(`   ✅ Complete: Fetched ${totalFetched}, Added ${added} new messages`);
  stats.channelsChecked++;

  // Update watermark
  if (totalFetched > 0) {
    try {
      const latestMessages = await (channel as any).messages.fetch({ limit: 1 });
      if (latestMessages.size > 0) {
        const latestId = latestMessages.first()!.id;
        await db.query(
          `
          INSERT INTO channel_watermarks (channel_id, latest_message_id, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (channel_id) 
          DO UPDATE SET latest_message_id = $2, updated_at = NOW()
          `,
          [channelId, latestId]
        );
        console.log(`   📌 Updated watermark to ${latestId}`);
      }
    } catch (error) {
      console.error(`   ⚠️  Failed to update watermark: ${error}`);
    }
  }
}

async function main() {
  console.log("🔧 DISCORD SYNC REPAIR");
  console.log("=".repeat(80));
  console.log("This will scan all channels and add missing messages to the database\n");

  const connected = await db.connect();
  if (!connected) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  const guildId = config.guildId;
  if (!guildId) {
    console.error("❌ No guild ID configured");
    await db.disconnect();
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });

  await client.login(config.botToken);
  console.log(`✅ Connected as ${client.user?.tag}\n`);

  const guild = await client.guilds.fetch(guildId);
  console.log(`📍 Guild: ${guild.name}\n`);

  // Get all text channels
  const textChannels = guild.channels.cache.filter((ch: any) => 
    ch.isTextBased() && !ch.isDMBased()
  );

  console.log(`📊 Found ${textChannels.size} text channels to check\n`);

  const stats: RepairStats = {
    channelsChecked: 0,
    messagesFound: 0,
    messagesAdded: 0,
    embeddings: 0,
    errors: 0,
  };

  // Process each channel
  for (const [channelId, channel] of textChannels) {
    await repairChannel(client, channelId, guildId, stats);
  }

  console.log("\n" + "=".repeat(80));
  console.log("📊 REPAIR SUMMARY");
  console.log("=".repeat(80));
  console.log(`Channels Checked: ${stats.channelsChecked}`);
  console.log(`Messages Found: ${stats.messagesFound}`);
  console.log(`Messages Added: ${stats.messagesAdded}`);
  console.log(`Embeddings Generated: ${stats.embeddings}`);
  console.log(`Errors: ${stats.errors}`);
  console.log("\n✅ Repair complete!");

  client.destroy();
  await db.disconnect();
}

main().catch(console.error);

