import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { config } from "../config/index.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function syncSingleChannel() {
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
      console.error("🔸 Usage: npm run sync:channel <channel_id>");
      await client.destroy();
      await db.disconnect();
      return;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      console.error("🔸 Channel not found or not a text channel");
      await client.destroy();
      await db.disconnect();
      return;
    }

    if (!channel.guildId) {
      console.error("🔸 Channel must be in a guild");
      await client.destroy();
      await db.disconnect();
      return;
    }

    const guild = await client.guilds.fetch(channel.guildId);
    const channelName = `#${(channel as any).name || channelId}`;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Sync Single Channel: ${channelName}`);
    console.log(`  Guild: ${guild.name}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // 1. Sync guild
    console.log("📋 Syncing guild...");
    const guildResult = await db.upsertGuild({
      id: guild.id,
      name: guild.name,
      description: guild.description || undefined,
      icon: guild.icon || undefined,
      owner_id: guild.ownerId || "",
      member_count: guild.memberCount,
      active: true,
      created_at: guild.createdAt || new Date(),
    });

    if (!guildResult.success) {
      console.error("🔸 Failed to sync guild:", guildResult.error);
      await client.destroy();
      await db.disconnect();
      return;
    }
    console.log("   ✅ Guild synced\n");

    // 2. Sync channel
    console.log("📝 Syncing channel...");
    const channelResult = await db.upsertChannel({
      id: channel.id,
      guild_id: guild.id,
      name: (channel as any).name || "",
      type: channel.type,
      position: (channel as any).position || 0,
      topic: (channel as any).topic || undefined,
      nsfw: (channel as any).nsfw || false,
      parent_id: (channel as any).parentId || undefined,
      active: true,
    });

    if (!channelResult.success) {
      console.error("🔸 Failed to sync channel:", channelResult.error);
      await client.destroy();
      await db.disconnect();
      return;
    }
    console.log("   ✅ Channel synced\n");

    // 3. Sync messages (using backfill logic similar to DatabaseHealer)
    console.log("💬 Syncing messages...");
    const replyReferences = new Map<string, string>();
    let lastId: string | null = null;
    let synced = 0;
    let batchNumber = 0;
    const batchSize = 100;

    while (true) {
      batchNumber++;
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

      if (!messages || messages.size === 0) {
        break;
      }

      const insertPromises: Promise<any>[] = [];
      for (const [, msg] of messages) {
        if (msg.author.bot) continue;

        // Store reply reference if it exists
        if (msg.reference?.messageId) {
          replyReferences.set(msg.id, msg.reference.messageId);
        }

        insertPromises.push(
          db.upsertMessage({
            id: msg.id,
            guild_id: guild.id,
            channel_id: channel.id,
            author_id: msg.author.id,
            content: msg.content || "",
            created_at: msg.createdAt,
            edited_at: msg.editedAt || undefined,
            attachments: Array.from(msg.attachments.values()).map((a: any) => a.url),
            embeds: msg.embeds.map((e: any) => JSON.stringify(e.toJSON())),
            referenced_message_id: msg.reference?.messageId || undefined,
            active: true,
          })
        );
        synced++;
      }

      if (insertPromises.length > 0) {
        await Promise.all(insertPromises);
        // Log first batch, every 10th batch, and final batch
        if (batchNumber === 1 || batchNumber % 10 === 0 || messages.size < batchSize) {
          console.log(`   📦 Batch ${batchNumber}: ${synced.toLocaleString()} messages synced so far`);
        }
      }

      lastId = messages.last()?.id || null;
      if (messages.size < batchSize) break;
    }

    console.log(`   ✅ Synced ${synced.toLocaleString()} messages\n`);

    // 4. Repair reply references
    if (replyReferences.size > 0) {
      console.log("🔧 Repairing reply references...");
      
      // Filter to only messages where the referenced message exists in DB
      const validReferences = new Map<string, string>();
      const allRefIds = Array.from(new Set(replyReferences.values()));

      if (allRefIds.length > 0) {
        const refExistsResult = await db.query(
          `SELECT id FROM messages WHERE id = ANY($1) AND active = true`,
          [allRefIds]
        );

        const existingRefIds = new Set<string>();
        if (
          refExistsResult.success &&
          refExistsResult.data &&
          refExistsResult.data.length > 0
        ) {
          for (const row of refExistsResult.data) {
            existingRefIds.add(row.id);
          }
        }

        for (const [msgId, refId] of replyReferences.entries()) {
          if (existingRefIds.has(refId)) {
            validReferences.set(msgId, refId);
          }
        }
      }

      if (validReferences.size > 0) {
        const updates = Array.from(validReferences.entries());
        const valuesPlaceholders = updates.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`).join(", ");

        const updateQuery = `
          UPDATE messages m
          SET referenced_message_id = refs.ref_id
          FROM (VALUES ${valuesPlaceholders}) AS refs(msg_id, ref_id)
          WHERE m.id = refs.msg_id
            AND m.channel_id = $${updates.length * 2 + 1}::text
            AND m.guild_id = $${updates.length * 2 + 2}::text
            AND m.referenced_message_id IS NULL
        `;

        const params: any[] = [];
        for (const [msgId, refId] of updates) {
          params.push(msgId, refId);
        }
        params.push(channel.id, guild.id);

        const result = await db.query(updateQuery, params);
        
        if (result.success) {
          const repaired = (result.data as any)?.rowCount || 0;
          console.log(`   ✅ Repaired ${repaired.toLocaleString()} reply references\n`);
        } else {
          console.error(`   🔸 Failed to repair references: ${result.error}`);
        }
      } else {
        console.log(`   ℹ️  No valid references to repair\n`);
      }
    }

    // 5. Update channel watermark
    if (synced > 0) {
      const mostRecentResult = await db.query(
        "SELECT id FROM messages WHERE channel_id = $1 AND guild_id = $2 ORDER BY created_at DESC LIMIT 1",
        [channel.id, guild.id]
      );

      if (mostRecentResult.success && mostRecentResult.data && mostRecentResult.data.length > 0) {
        await db.updateChannelLastMessage(channel.id, mostRecentResult.data[0].id);
      }
    }

    // 6. Sync members who have messages in this channel
    console.log("👥 Syncing channel participants...");
    const participantsResult = await db.query(
      `SELECT DISTINCT author_id FROM messages WHERE channel_id = $1 AND guild_id = $2 AND active = true`,
      [channel.id, guild.id]
    );

    if (participantsResult.success && participantsResult.data) {
      const participantIds = participantsResult.data.map((row: any) => row.author_id);
      let memberCount = 0;

      for (const userId of participantIds) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) continue;

          const memberResult = await db.upsertMember({
            id: `${guild.id}_${userId}`,
            guild_id: guild.id,
            user_id: userId,
            username: member.user.username,
            display_name: member.displayName,
            global_name: member.user.globalName || undefined,
            avatar: member.user.avatar || undefined,
            avatar_decoration: member.user.avatarDecoration || undefined,
            banner: member.user.banner || undefined,
            accent_color: member.user.accentColor || undefined,
            discriminator: member.user.discriminator,
            bio: undefined,
            flags: member.user.flags?.bitfield || undefined,
            premium_type: undefined,
            public_flags: member.user.flags?.bitfield || undefined,
            bot: member.user.bot,
            system: member.user.system || undefined,
            nick: member.nickname || undefined,
            joined_at: member.joinedAt || new Date(),
            roles: Array.from(member.roles.cache.keys()),
            permissions: member.permissions.bitfield.toString(),
            communication_disabled_until: member.communicationDisabledUntil || undefined,
            pending: member.pending || undefined,
            premium_since: member.premiumSince || undefined,
            timeout: undefined,
            active: true,
            created_at: member.user.createdAt || new Date(),
            updated_at: new Date(),
          });

          if (memberResult.success) {
            memberCount++;
          }
        } catch {
          // Skip members we can't fetch
        }
      }

      console.log(`   ✅ Synced ${memberCount.toLocaleString()} members\n`);
    }

    // 7. Summary
    const replyCountResult = await db.query(
      "SELECT COUNT(*) as count FROM messages WHERE channel_id = $1 AND active = true AND referenced_message_id IS NOT NULL",
      [channel.id]
    );

    const totalCountResult = await db.query(
      "SELECT COUNT(*) as count FROM messages WHERE channel_id = $1 AND active = true",
      [channel.id]
    );

    const replyCount = replyCountResult.success && replyCountResult.data
      ? parseInt(replyCountResult.data[0].count, 10)
      : 0;
    const totalCount = totalCountResult.success && totalCountResult.data
      ? parseInt(totalCountResult.data[0].count, 10)
      : 0;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ Sync complete!");
    console.log(`   Total messages: ${totalCount.toLocaleString()}`);
    console.log(`   Messages with replies: ${replyCount.toLocaleString()} (${totalCount > 0 ? ((replyCount / totalCount) * 100).toFixed(2) : 0}%)`);
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

syncSingleChannel();

