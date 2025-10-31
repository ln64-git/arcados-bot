import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { config } from "../config/index.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function repairChannelReplies() {
  const db = new PostgreSQLManager();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect to database");
      return;
    }

    console.log("🔹 Logging in to Discord...");
    await client.login(config.botToken);
    await new Promise((resolve) => client.once("ready", resolve));
    console.log(`✅ Logged in as ${client.user?.tag}\n`);

    const channelId = process.argv[2];

    if (!channelId) {
      console.error("🔸 Usage: npm run repair:channel-replies <channel_id>");
      await client.destroy();
      await db.disconnect();
      return;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      console.error("🔸 Channel not found or not a text channel");
      await client.destroy();
      await db.disconnect();
      return;
    }

    const channelName = `#${(channel as any).name || channelId}`;

    // Get all message IDs from the database for this channel
    const dbMessagesResult = await db.query(
      "SELECT id, guild_id FROM messages WHERE channel_id = $1 AND active = true ORDER BY created_at DESC",
      [channelId]
    );

    if (!dbMessagesResult.success || !dbMessagesResult.data || dbMessagesResult.data.length === 0) {
      console.log("   ℹ️  No messages found in database for this channel");
      await client.destroy();
      await db.disconnect();
      return;
    }

    const guildId = dbMessagesResult.data[0].guild_id;
    const dbMessageIds = new Set(dbMessagesResult.data.map((row: any) => row.id));
    const totalMessages = dbMessageIds.size;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Repair Reply References: ${channelName}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log(`📊 Found ${totalMessages.toLocaleString()} messages in database\n`);

    let repaired = 0;
    let checked = 0;
    const batchSize = 100;
    let lastId: string | null = null;

    // Fetch messages from Discord in batches to check their references
    while (true) {
      const options: any = { limit: batchSize };
      if (lastId) {
        options.before = lastId;
      }

      let messages;
      try {
        messages = await (channel as any).messages.fetch(options);
      } catch (error: any) {
        console.error(`   🔸 Error fetching messages: ${error.message || error}`);
        break;
      }

      if (!messages || messages.size === 0) break;

      // Collect messages that need repair
      const messagesToRepair: Array<{ msg: any; refId: string }> = [];
      for (const [, msg] of messages) {
        checked++;

        // Only process messages that are in our DB
        if (!dbMessageIds.has(msg.id)) continue;

        // Skip if message doesn't have a reference
        if (!msg.reference?.messageId) continue;

        // Check if the referenced message exists in DB
        const refExists = dbMessageIds.has(msg.reference.messageId);
        if (!refExists) continue;

        messagesToRepair.push({ msg, refId: msg.reference.messageId });
      }

      // Batch check current DB state for all messages to repair
      if (messagesToRepair.length > 0) {
        const messageIds = messagesToRepair.map((m) => m.msg.id);
        const currentStatesResult = await db.query(
          `SELECT id, referenced_message_id FROM messages WHERE id = ANY($1)`,
          [messageIds]
        );

        const currentStates = new Map<string, string | null>();
        if (
          currentStatesResult.success &&
          currentStatesResult.data &&
          currentStatesResult.data.length > 0
        ) {
          for (const row of currentStatesResult.data) {
            currentStates.set(row.id, row.referenced_message_id);
          }
        }

        // Update messages that currently have NULL but should have a reference
        const updatePromises: Promise<any>[] = [];
        for (const { msg, refId } of messagesToRepair) {
          const currentRef = currentStates.get(msg.id);
          if (currentRef === null || currentRef === undefined) {
            // Current state is NULL, update it
            updatePromises.push(
              db.upsertMessage({
                id: msg.id,
                guild_id: guildId,
                channel_id: channelId,
                author_id: msg.author.id,
                content: msg.content || "",
                created_at: msg.createdAt,
                edited_at: msg.editedAt || undefined,
                attachments: Array.from(msg.attachments.values()).map((a: any) => a.url),
                embeds: msg.embeds.map((e: any) => JSON.stringify(e.toJSON())),
                referenced_message_id: refId,
                active: true,
              })
            );
            repaired++;
          }
        }

        if (updatePromises.length > 0) {
          await Promise.all(updatePromises);
          console.log(
            `   🔧 Repaired ${repaired} reply references (checked ${checked}/${totalMessages})`
          );
        }
      }

      lastId = messages.last()?.id || null;
      if (messages.size < batchSize) break;
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`✅ Repair complete!`);
    console.log(`   Repaired: ${repaired.toLocaleString()} messages`);
    console.log(`   Checked: ${checked.toLocaleString()}/${totalMessages.toLocaleString()} messages`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    await client.destroy();
    await db.disconnect();
  } catch (error) {
    console.error("🔸 Error:", error);
    await client.destroy();
    await db.disconnect();
    process.exit(1);
  }
}

repairChannelReplies();

