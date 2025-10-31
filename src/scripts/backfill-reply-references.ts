import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { config } from "../config/index.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function backfillReplyReferences() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const db = new PostgreSQLManager();

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect to database");
      return;
    }

    console.log("✅ Database connected\n");

    console.log("🔹 Logging in to Discord...");
    await client.login(config.botToken);
    console.log(`✅ Logged in as ${client.user?.tag}\n`);

    // Get guild ID from command line args or env
    const guildId = process.argv[2] || process.env.GUILD_ID;

    if (!guildId) {
      console.error("🔸 Usage: npm run backfill:replies <guild_id>");
      console.error("   Or set GUILD_ID in .env");
      return;
    }

    let guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.log("🔹 Guild not in cache, fetching...");
      try {
        guild = await client.guilds.fetch(guildId);
      } catch (error) {
        console.error(`🔸 Failed to fetch guild ${guildId}:`, error);
        return;
      }
    }
    
    if (!guild) {
      console.error(`🔸 Guild ${guildId} not found`);
      return;
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Backfilling Reply References for: ${guild.name}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Get count of messages that don't have referenced_message_id set
    console.log("📥 Checking messages without reply references...");
    const countResult = await db.query(
      `SELECT COUNT(*) as total
       FROM messages
       WHERE guild_id = $1 
         AND active = true
         AND (referenced_message_id IS NULL OR referenced_message_id = '')`,
      [guildId]
    );

    if (!countResult.success || !countResult.data) {
      console.error("🔸 Failed to count messages:", countResult.error);
      return;
    }

    const totalToProcess = parseInt(countResult.data[0].total, 10);
    console.log(`✅ Found ${totalToProcess.toLocaleString()} messages to check\n`);

    if (totalToProcess === 0) {
      console.log("📭 No messages to process");
      return;
    }

    let updated = 0;
    let notFound = 0;
    let errors = 0;
    let processed = 0;
    const FETCH_BATCH_SIZE = 1000; // Fetch messages in batches from DB
    const PROCESS_BATCH_SIZE = 50; // Process in smaller batches
    const CONCURRENT_REQUESTS = 20; // Process multiple messages in parallel
    const overallStartTime = Date.now();

    console.log("🔄 Processing messages in batches...\n");

    let offset = 0;
    while (offset < totalToProcess) {
      // Fetch next batch of messages
      const messagesResult = await db.query(
        `SELECT 
           id, channel_id, guild_id
         FROM messages
         WHERE guild_id = $1 
           AND active = true
           AND (referenced_message_id IS NULL OR referenced_message_id = '')
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [guildId, FETCH_BATCH_SIZE, offset]
      );

      if (!messagesResult.success || !messagesResult.data) {
        console.error("🔸 Failed to fetch messages:", messagesResult.error);
        break;
      }

      const messages = messagesResult.data as Array<{
        id: string;
        channel_id: string;
        guild_id: string;
      }>;

      if (messages.length === 0) break;

      console.log(
        `   🔄 Processing batch ${Math.floor(offset / FETCH_BATCH_SIZE) + 1} (${messages.length} messages)...`
      );

      // Process this batch in parallel chunks
      for (let i = 0; i < messages.length; i += PROCESS_BATCH_SIZE) {
        const batch = messages.slice(i, i + PROCESS_BATCH_SIZE);
        const batchEnd = Math.min(i + PROCESS_BATCH_SIZE, messages.length) + offset;

        // Process messages in parallel chunks
        for (let j = 0; j < batch.length; j += CONCURRENT_REQUESTS) {
          const concurrentBatch = batch.slice(j, j + CONCURRENT_REQUESTS);

          // Process these messages in parallel
          await Promise.all(
            concurrentBatch.map(async (msg) => {
              try {
                const channel = guild.channels.cache.get(msg.channel_id);
                if (!channel || !channel.isTextBased()) {
                  notFound++;
                  processed++;
                  return;
                }

                // Fetch the message from Discord
                const discordMessage = await (channel as any).messages
                  .fetch(msg.id)
                  .catch(() => null);

                if (!discordMessage) {
                  notFound++;
                  processed++;
                  return;
                }

                // Check if it has a reply reference
                const referencedId = discordMessage.reference?.messageId;

                if (referencedId) {
                  // Verify the referenced message exists in our database
                  const refExists = await db.query(
                    "SELECT id FROM messages WHERE id = $1",
                    [referencedId]
                  );

                  if (
                    refExists.success &&
                    refExists.data &&
                    refExists.data.length > 0
                  ) {
                    // Update the message with the reply reference
                    await db.query(
                      "UPDATE messages SET referenced_message_id = $1 WHERE id = $2",
                      [referencedId, msg.id]
                    );
                    updated++;
                  }
                }
                processed++;
              } catch (error) {
                errors++;
                processed++;
              }
            })
          );

          // Progress logging with percentage - log every 50 messages
          if (processed % 50 === 0 || processed <= 10 || batchEnd >= totalToProcess) {
            const percentage = ((processed / totalToProcess) * 100).toFixed(2);
            const totalElapsed = (Date.now() - overallStartTime) / 1000;
            const rate = totalElapsed > 0 ? (processed / totalElapsed).toFixed(1) : "0";
            const estimatedRemaining =
              totalElapsed > 0
                ? Math.round(
                    (totalToProcess - processed) / (processed / totalElapsed)
                  )
                : 0;
            const etaMinutes = Math.floor(estimatedRemaining / 60);
            const etaSeconds = Math.round(estimatedRemaining % 60);

            console.log(
              `   📊 ${percentage}% (${processed.toLocaleString()}/${totalToProcess.toLocaleString()}) | ✅ ${updated} | 📭 ${notFound} | 🔸 ${errors} | ⚡ ${rate} msg/s | ⏱️ ETA: ${etaMinutes}m ${etaSeconds}s`
            );
          }

          // Small delay between concurrent batches to avoid rate limits
          if (j + CONCURRENT_REQUESTS < batch.length) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      }

      offset += FETCH_BATCH_SIZE;

      // Log batch completion with percentage
      if (offset < totalToProcess) {
        const batchPercentage = ((offset / totalToProcess) * 100).toFixed(2);
        console.log(
          `   ✅ Completed batch: ${batchPercentage}% (${Math.min(offset, totalToProcess).toLocaleString()}/${totalToProcess.toLocaleString()} messages checked)`
        );
      }
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 Summary:");
    console.log(`   ✅ Updated: ${updated} messages with reply references`);
    console.log(`   📭 Not found: ${notFound} messages (deleted or inaccessible)`);
    console.log(`   🔸 Errors: ${errors}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
    await client.destroy();
  }
}

backfillReplyReferences();

