import type { Client, Guild } from "discord.js";
import type { PostgreSQLManager } from "../database/PostgreSQLManager";
import { RelationshipNetworkManager } from "../relationship-network/NetworkManager";

export class DatabaseHealer {
  private client: Client;
  private db: PostgreSQLManager;
  private relationshipManager: RelationshipNetworkManager;
  private maintenanceTimer?: NodeJS.Timeout;
  private verbose: boolean;

  constructor(
    client: Client,
    db: PostgreSQLManager,
    relationshipManager: RelationshipNetworkManager,
    verbose: boolean = false
  ) {
    this.client = client;
    this.db = db;
    this.relationshipManager = relationshipManager;
    this.verbose = verbose;
  }

  /**
   * Run initial healing pass on boot
   */
  async runOnce(): Promise<void> {
    console.log("🔹 Starting database healing pass...");

    try {
      const guilds = this.client.guilds.cache;
      for (const [, guild] of guilds) {
        await this.healGuild(guild);
      }

      console.log("✅ Database healing pass completed");
    } catch (error) {
      console.error("🔸 Error during healing pass:", error);
    }
  }

  /**
   * Heal a single guild
   */
  private async healGuild(guild: Guild): Promise<void> {
    if (this.verbose) {
      console.log(`🔹 Healing guild: ${guild.name}`);
    }

    const guildId = guild.id;

    const guildResult = await this.db.upsertGuild({
      id: guildId,
      name: guild.name,
      description: guild.description || undefined,
      icon: guild.icon || undefined,
      owner_id: guild.ownerId || "",
      member_count: guild.memberCount,
      active: true,
      created_at: guild.createdAt || new Date(),
    });

    if (!guildResult.success) {
      console.error(`🔸 Failed to upsert guild ${guildId}`);
      return;
    }

    if (this.verbose) {
      console.log(`   ✅ Guild data synced`);
    }

    await this.healChannels(guild);
    await this.healMembers(guild);
    await this.healMessages(guild);

    if (this.verbose) {
      console.log(`✅ Completed healing for: ${guild.name}`);
    }
  }

  /**
   * Process items in parallel batches
   */
  private async processInBatches<T>(
    items: T[],
    batchSize: number,
    processor: (item: T) => Promise<{ success: boolean; skipped?: boolean }>,
    label: string
  ): Promise<{ processed: number; skipped: number }> {
    let processed = 0;
    let skipped = 0;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((item) =>
          processor(item).catch(() => ({ success: false, skipped: true }))
        )
      );

      for (const result of results) {
        if (result.success) {
          processed++;
        } else if (result.skipped) {
          skipped++;
        }
      }

      if (
        (i + batchSize) % (batchSize * 5) === 0 ||
        i + batchSize >= items.length
      ) {
        const progress = Math.min(i + batchSize, items.length);
        if (this.verbose) {
          console.log(`   ${label} ${progress}/${items.length}...`);
        }
      }
    }

    return { processed, skipped };
  }

  /**
   * Heal channels and update watermarks
   */
  private async healChannels(guild: Guild): Promise<void> {
    const channels = Array.from(guild.channels.cache.values()).filter(
      (ch) => ch.isTextBased() && !ch.isDMBased()
    );

    if (this.verbose) {
      console.log(`   📝 Syncing ${channels.length} channels...`);
    }

    const results = await this.processInBatches(
      channels,
      10, // Process 10 channels in parallel
      async (channel) => {
        try {
          const channelResult = await this.db.upsertChannel({
            id: channel.id,
            guild_id: guild.id,
            name: channel.name || "",
            type: channel.type,
            position: (channel as any).position || 0,
            topic: (channel as any).topic || undefined,
            nsfw: (channel as any).nsfw || false,
            parent_id: (channel as any).parentId || undefined,
            active: true,
          });

          if (!channelResult.success) {
            return { success: false, skipped: true };
          }

          const watermarkResult = await this.db.getChannelWatermark(channel.id);
          if (watermarkResult.success && watermarkResult.data) {
            const lastMessageId = watermarkResult.data.last_message_id;
            if (lastMessageId && channel.isTextBased()) {
              // Quick check: fetch latest message to see if there's anything new
              try {
                const textChannel = channel as any;
                const latestMessages = await textChannel.messages.fetch({
                  limit: 1,
                });
                const latestMessage = latestMessages.first();

                // If latest message ID matches watermark, channel is up to date
                if (latestMessage && latestMessage.id === lastMessageId) {
                  return { success: true };
                }
              } catch {
                return { success: false, skipped: true };
              }

              const channelName = `#${(channel as any).name || channel.id}`;
              await this.backfillMessagesFromWatermark(
                guild.id,
                channel.id,
                lastMessageId,
                channelName
              );
            }
          }

          return { success: true };
        } catch (error: any) {
          return { success: false, skipped: true };
        }
      },
      "📝"
    );

    if (this.verbose) {
      console.log(
        `   ✅ Synced ${results.processed} channels${
          results.skipped > 0 ? `, skipped ${results.skipped}` : ""
        }`
      );
    }
  }

  /**
   * Heal members
   */
  private async healMembers(guild: Guild): Promise<void> {
    if (this.verbose) {
      console.log(`   👥 Fetching members...`);
    }
    const members = await guild.members.fetch();
    const membersArray = Array.from(members.values());
    if (this.verbose) {
      console.log(`   👥 Syncing ${membersArray.length} members...`);
    }

    const results = await this.processInBatches(
      membersArray,
      20, // Process 20 members in parallel
      async (member) => {
        try {
          const memberResult = await this.db.upsertMember({
            id: `${guild.id}_${member.user.id}`,
            guild_id: guild.id,
            user_id: member.user.id,
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
            communication_disabled_until:
              member.communicationDisabledUntil || undefined,
            pending: member.pending || undefined,
            premium_since: member.premiumSince || undefined,
            timeout: undefined,
            active: true,
            created_at: member.user.createdAt || new Date(),
            updated_at: new Date(),
          });

          return memberResult.success
            ? { success: true }
            : { success: false, skipped: true };
        } catch (error) {
          return { success: false, skipped: true };
        }
      },
      "👥"
    );

    if (this.verbose) {
      console.log(
        `   ✅ Synced ${results.processed} members${
          results.skipped > 0 ? `, ${results.skipped} errors` : ""
        }`
      );
    }
  }

  /**
   * Heal messages (initial scan)
   */
  private async healMessages(guild: Guild): Promise<void> {
    const channels = Array.from(guild.channels.cache.values()).filter(
      (ch) => ch.isTextBased() && !ch.isDMBased()
    );

    if (this.verbose) {
      console.log(`   💬 Checking messages in ${channels.length} channels...`);
    }
    let totalMessagesSynced = 0;
    let processedCount = 0;

    const results = await this.processInBatches(
      channels,
      5, // Process 5 channels in parallel (message backfill is heavier)
      async (channel) => {
        processedCount++;
        const channelName = `#${channel.name || channel.id}`;
        const batchLabel = `[${processedCount}/${channels.length}]`;

        try {
          // Ensure channel exists in database first
          const channelExists = await this.db.query(
            "SELECT id FROM channels WHERE id = $1",
            [channel.id]
          );

          if (
            !channelExists.success ||
            !channelExists.data ||
            channelExists.data.length === 0
          ) {
            // Channel doesn't exist in DB, skip (should be synced by healChannels first)
            return { success: true };
          }

          const watermarkResult = await this.db.getChannelWatermark(channel.id);
          let lastMessageId: string | null = null;

          if (watermarkResult.success && watermarkResult.data) {
            lastMessageId = watermarkResult.data.last_message_id;
            // Only skip if watermark exists AND has a valid message ID
            // If last_message_id is NULL, we need to backfill (messages were cleared)
            if (lastMessageId) {
              // Channel has watermark with actual message ID, check if up to date
              try {
                const textChannel = channel as any;
                // Fetch up to 10 latest messages and choose newest non-bot
                const latestMessages = await textChannel.messages.fetch({
                  limit: 10,
                });
                const latestNonBot = Array.from(
                  (latestMessages as any).values()
                ).find((m: any) => !m.author?.bot) as any;

                if (latestNonBot) {
                  // Compare newest Discord non-bot with newest in DB; if equal, skip
                  const newestInDb = await this.db.query(
                    "SELECT id FROM messages WHERE channel_id = $1 AND active = true ORDER BY created_at DESC LIMIT 1",
                    [channel.id]
                  );

                  if (
                    newestInDb.success &&
                    newestInDb.data &&
                    newestInDb.data.length > 0 &&
                    newestInDb.data[0].id === latestNonBot.id
                  ) {
                    return { success: true };
                  }
                }

                // Otherwise backfill from watermark
                const backfillResult = await this.backfillMessagesFromWatermark(
                  guild.id,
                  channel.id,
                  lastMessageId,
                  channelName,
                  processedCount,
                  channels.length
                );
                if (backfillResult.success && backfillResult.messageCount) {
                  totalMessagesSynced += backfillResult.messageCount || 0;
                  if (backfillResult.messageCount > 0) {
                    console.log(
                      `   ✅ [${processedCount}/${channels.length}] [${channelName}] Synced ${backfillResult.messageCount} new messages`
                    );
                  }
                }
                return { success: true };
              } catch (error: any) {
                if (error.code === 50001 || error.status === 403) {
                  return { success: false, skipped: true };
                }
                console.log(
                  `   🔸 [${processedCount}/${
                    channels.length
                  }] [${channelName}] Error checking watermark: ${
                    error.message || error
                  }`
                );
                return { success: false, skipped: true };
              }
            }
          }

          // No watermark or watermark is NULL, need to backfill all messages
          const result = await this.backfillAllMessages(
            guild.id,
            channel.id,
            channelName,
            processedCount,
            channels.length
          );
          if (result.success) {
            totalMessagesSynced += result.messageCount || 0;
            // Only log completion if messages were synced (pressure point)
            if (result.messageCount && result.messageCount > 0) {
              console.log(
                `   ✅ [${processedCount}/${channels.length}] [${channelName}] Synced ${result.messageCount} messages`
              );
            }
            return { success: true };
          } else {
            return { success: false, skipped: true };
          }
        } catch (error: any) {
          if (error.code === 50001 || error.status === 403) {
            return { success: false, skipped: true };
          }
          // Log unexpected errors
          console.log(
            `   🔸 [${processedCount}/${
              channels.length
            }] [${channelName}] Error: ${error.message || error}`
          );
          return { success: false, skipped: true };
        }
      },
      "💬 Channels"
    );

    if (this.verbose) {
      console.log(
        `   ✅ Processed ${
          results.processed
        } channels, synced ${totalMessagesSynced} total messages${
          results.skipped > 0 ? `, skipped ${results.skipped}` : ""
        }`
      );
    }
  }

  /**
   * Backfill messages from watermark forward
   */
  private async backfillMessagesFromWatermark(
    guildId: string,
    channelId: string,
    lastMessageId: string,
    channelName?: string,
    processedCount?: number,
    totalChannels?: number
  ): Promise<{ success: boolean; messageCount: number }> {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased())
        return { success: false, messageCount: 0 };

      const displayName =
        channelName || `#${(channel as any).name || channelId}`;
      const batchLabel =
        processedCount && totalChannels
          ? `[${processedCount}/${totalChannels}]`
          : "";
      let lastId: string | null = lastMessageId;
      let synced = 0;
      let cumulativeStored = 0;
      let batchNumber = 0;
      const batchSize = 100;

      while (true) {
        batchNumber++;
        const options: any = { limit: batchSize };
        if (lastId) {
          options.after = lastId;
        }

        const messages = await (channel as any).messages.fetch(options);
        if (!messages || messages.size === 0) {
          break;
        }

        // Quick check: if any message in this batch is already in DB, we've caught up
        // Check a few messages from the batch (prioritize non-bot, but check any if needed)
        let alreadySynced = false;
        const messagesToCheck = Array.from((messages as any).values()) as any[];
        // Check non-bot messages first
        for (const msg of messagesToCheck as any[]) {
          if (!msg.author.bot) {
            const existsResult = await this.db.query(
              "SELECT id FROM messages WHERE id = $1",
              [msg.id]
            );
            if (
              existsResult.success &&
              existsResult.data &&
              existsResult.data.length > 0
            ) {
              // Found a non-bot message already in DB, we've caught up
              alreadySynced = true;
              break;
            }
          }
        }
        // If no non-bot messages, check if all messages in batch already exist (bot-only channel)
        if (
          !alreadySynced &&
          messagesToCheck.length > 0 &&
          (messagesToCheck as any[]).every((m: any) => m.author.bot)
        ) {
          let allExist = true;
          for (const msg of messagesToCheck.slice(0, 5) as any[]) {
            // Check first 5 messages
            const existsResult = await this.db.query(
              "SELECT id FROM messages WHERE id = $1",
              [msg.id]
            );
            if (
              !existsResult.success ||
              !existsResult.data ||
              existsResult.data.length === 0
            ) {
              allExist = false;
              break;
            }
          }
          if (allExist) {
            alreadySynced = true;
          }
        }
        if (alreadySynced) {
          break;
        }

        // Batch DB inserts for better performance
        // Store ALL messages (including bots) but only count non-bots for sync stats
        const insertPromises: Promise<any>[] = [];
        for (const [, msg] of messages as any as Map<string, any>) {
          insertPromises.push(
            this.db.upsertMessage({
              id: msg.id,
              guild_id: guildId,
              channel_id: channelId,
              author_id: msg.author.id,
              content: msg.content || "",
              created_at: msg.createdAt,
              edited_at: msg.editedAt || undefined,
              attachments: Array.from(msg.attachments.values()).map(
                (a: any) => a.url
              ),
              embeds: msg.embeds.map((e: any) => JSON.stringify(e.toJSON())),
              referenced_message_id: msg.reference?.messageId || undefined,
              active: true,
            })
          );
          // Only count non-bot messages for sync stats
          if (!msg.author.bot) {
            synced++;
          }
        }

        // Wait for all inserts in this batch
        if (insertPromises.length > 0) {
          await Promise.all(insertPromises);
          cumulativeStored += insertPromises.length;
          // Only log every 50 batches or on final batch to reduce noise
          if (
            this.verbose &&
            (batchNumber === 1 ||
              batchNumber % 50 === 0 ||
              messages.size < batchSize)
          ) {
            const fetched = messages.size;
            console.log(
              `      💾 ${batchLabel} [${channelName}] Batch ${batchNumber}: fetched ${fetched}; cumulative stored ${cumulativeStored}`
            );
          }
        }

        // Get the newest message ID for pagination (forward through time)
        lastId = messages.first()?.id || null;

        // Stop if we got less than a full batch
        if (messages.size < batchSize) break;
      }

      if (synced > 0) {
        // Set watermark to newest non-bot message stored in DB for this channel
        const mostRecentResult = await this.db.query(
          "SELECT id FROM messages WHERE channel_id = $1 AND guild_id = $2 ORDER BY created_at DESC LIMIT 1",
          [channelId, guildId]
        );
        if (
          mostRecentResult.success &&
          mostRecentResult.data &&
          mostRecentResult.data.length > 0
        ) {
          await this.db.updateChannelLastMessage(
            channelId,
            mostRecentResult.data[0].id
          );
        }
      }

      return { success: true, messageCount: synced };
    } catch (error: any) {
      if (error.code === 50001 || error.status === 403) {
        return { success: false, messageCount: 0 };
      }
      return { success: false, messageCount: 0 };
    }
  }

  /**
   * Backfill all messages (initial sync)
   */
  private async backfillAllMessages(
    guildId: string,
    channelId: string,
    channelName: string,
    processedCount?: number,
    totalChannels?: number
  ): Promise<{ success: boolean; messageCount: number }> {
    // Define batchLabel at function scope so it's available everywhere
    const batchLabel =
      processedCount && totalChannels
        ? `[${processedCount}/${totalChannels}]`
        : "";

    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased())
        return { success: false, messageCount: 0 };

      let lastId: string | null = null;
      let synced = 0;
      let cumulativeStored = 0; // all messages stored (including bots)
      let batchNumber = 0;
      const batchSize = 100;
      // Collect (messageId, referencedMessageId) pairs during backfill
      const replyReferences = new Map<string, string>();

      while (true) {
        batchNumber++;

        const options: any = { limit: batchSize };
        if (lastId) {
          options.before = lastId;
        }

        let messages;
        try {
          messages = await (channel as any).messages.fetch(options);
        } catch (fetchError: any) {
          // Skip channels we don't have access to without logging
          if (fetchError?.code === 50001 || fetchError?.status === 403) {
            return { success: false, messageCount: 0 };
          }
          // Unexpected error: bubble up to caller where a single-line error will be printed
          throw fetchError;
        }

        if (!messages || messages.size === 0) {
          break;
        }

        // Check if channel has any messages in DB (only for first batch)
        if (batchNumber === 1) {
          const channelMessageCount = await this.db.query(
            "SELECT COUNT(*) as count FROM messages WHERE channel_id = $1 AND active = true",
            [channelId]
          );

          const hasMessages =
            channelMessageCount.success &&
            channelMessageCount.data &&
            channelMessageCount.data.length > 0 &&
            parseInt(channelMessageCount.data[0].count, 10) > 0;

          if (hasMessages) {
            // Channel already has messages - check if newest non-bot Discord message matches newest non-bot in DB
            // Find first non-bot message in the fetched batch
            const firstNonBot = Array.from((messages as any).values()).find(
              (m: any) => !m.author?.bot
            ) as any;
            if (firstNonBot) {
              // Compare with newest non-bot message in DB
              const newestNonBotInDb = await this.db.query(
                `SELECT id FROM messages m
                 JOIN members mb ON mb.user_id = m.author_id AND mb.guild_id = m.guild_id
                 WHERE m.channel_id = $1 AND m.active = true AND mb.bot = false
                 ORDER BY m.created_at DESC LIMIT 1`,
                [channelId]
              );

              if (
                newestNonBotInDb.success &&
                newestNonBotInDb.data &&
                newestNonBotInDb.data.length > 0 &&
                newestNonBotInDb.data[0].id === firstNonBot.id
              ) {
                // Channel is fully up to date (newest non-bot messages match)
                // Update watermark to newest message (can be bot) for consistency
                const newestAny = await this.db.query(
                  "SELECT id FROM messages WHERE channel_id = $1 AND active = true ORDER BY created_at DESC LIMIT 1",
                  [channelId]
                );
                if (
                  newestAny.success &&
                  newestAny.data &&
                  newestAny.data.length > 0
                ) {
                  await this.db.updateChannelLastMessage(
                    channelId,
                    newestAny.data[0].id
                  );
                }
                return { success: true, messageCount: 0 };
              }
              // Has messages but newest doesn't match - continue to sync below
            }
          }
          // No messages in DB or need to sync - proceed with backfill
        }

        // Batch DB inserts for better performance
        // Store ALL messages (including bots) but only track non-bots for relationships
        const insertPromises: Promise<any>[] = [];
        for (const [, msg] of messages) {
          // Store reply reference for non-bot messages only (relationships)
          if (!msg.author.bot && msg.reference?.messageId) {
            replyReferences.set(msg.id, msg.reference.messageId);
          }

          insertPromises.push(
            this.db.upsertMessage({
              id: msg.id,
              guild_id: guildId,
              channel_id: channelId,
              author_id: msg.author.id,
              content: msg.content || "",
              created_at: msg.createdAt,
              edited_at: msg.editedAt || undefined,
              attachments: Array.from(msg.attachments.values()).map(
                (a: any) => a.url
              ),
              embeds: msg.embeds.map((e: any) => JSON.stringify(e.toJSON())),
              referenced_message_id: msg.reference?.messageId || undefined,
              active: true,
            })
          );
          // Only count non-bot messages for sync stats
          if (!msg.author.bot) {
            synced++;
          }
        }

        // Wait for all inserts in this batch
        if (insertPromises.length > 0) {
          try {
            await Promise.all(insertPromises);
            const totalStored = insertPromises.length;
            cumulativeStored += totalStored;
            // Only log every 50 batches or on final batch to reduce noise
            if (
              (batchNumber === 1 ||
                batchNumber % 50 === 0 ||
                messages.size < batchSize) &&
              this.verbose
            ) {
              const batchLabel =
                processedCount && totalChannels
                  ? `[${processedCount}/${totalChannels}]`
                  : "";
              const fetched = messages.size;
              console.log(
                `      💾 ${batchLabel} [${channelName}] Batch ${batchNumber}: fetched ${fetched}; cumulative stored ${cumulativeStored}`
              );
            }
          } catch (insertError: any) {
            console.log(
              `      🔸 [${processedCount || ""}/${
                totalChannels || ""
              }] [${channelName}] Error inserting batch ${batchNumber}: ${
                insertError.message || insertError
              }`
            );
            throw insertError;
          }
        }

        // Get oldest message ID for pagination (going backward through history)
        lastId = messages.last()?.id || null;

        // Stop if we got less than a full batch (reached the beginning)
        if (messages.size < batchSize) break;
      }

      // Update watermark with the most recent message we synced (not the oldest)
      if (synced > 0) {
        try {
          const mostRecentResult = await this.db.query(
            "SELECT id FROM messages WHERE channel_id = $1 AND guild_id = $2 ORDER BY created_at DESC LIMIT 1",
            [channelId, guildId]
          );

          if (
            mostRecentResult.success &&
            mostRecentResult.data &&
            mostRecentResult.data.length > 0
          ) {
            const updateResult = await this.db.updateChannelLastMessage(
              channelId,
              mostRecentResult.data[0].id
            );
            if (!updateResult.success) {
              console.log(
                `   🔸 [${processedCount || ""}/${
                  totalChannels || ""
                }] [${channelName}] Failed to update watermark: ${
                  updateResult.error || "unknown error"
                }`
              );
            }
          }
        } catch (watermarkError: any) {
          console.log(
            `   🔸 [${processedCount || ""}/${
              totalChannels || ""
            }] [${channelName}] Error updating watermark: ${
              watermarkError.message || watermarkError
            }`
          );
          // Don't fail the whole sync if watermark update fails
        }

        // Repair reply references: messages inserted before their referenced messages existed
        // Now that all messages are in the DB, do a single SQL update to fix references
        if (replyReferences.size > 0) {
          await this.repairReplyReferences(
            channelId,
            guildId,
            replyReferences,
            batchLabel
          );
        }
      }

      return { success: true, messageCount: synced };
    } catch (error: any) {
      if (error.code === 50001 || error.status === 403) {
        return { success: false, messageCount: 0 };
      }
      // Log unexpected errors
      console.log(
        `   🔸 [${processedCount || ""}/${
          totalChannels || ""
        }] [${channelName}] Error in backfillAllMessages: ${
          error.message || error
        }`
      );
      return { success: false, messageCount: 0 };
    }
  }

  /**
   * Repair reply references using a single efficient SQL update
   * Updates all messages where referenced_message_id is NULL but the referenced message now exists
   */
  private async repairReplyReferences(
    channelId: string,
    guildId: string,
    replyReferences: Map<string, string>,
    batchLabel: string
  ): Promise<void> {
    try {
      if (replyReferences.size === 0) return;

      // Filter to only messages where the referenced message exists in DB
      const validReferences = new Map<string, string>();
      const allRefIds = Array.from(new Set(replyReferences.values()));

      // Batch check which referenced messages exist
      if (allRefIds.length > 0) {
        const refExistsResult = await this.db.query(
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

        // Only keep references where the referenced message exists
        for (const [msgId, refId] of replyReferences.entries()) {
          if (existingRefIds.has(refId)) {
            validReferences.set(msgId, refId);
          }
        }
      }

      if (validReferences.size === 0) return;

      // Build VALUES clause for all (messageId, referencedMessageId) pairs
      const updates = Array.from(validReferences.entries());
      const valuesPlaceholders = updates
        .map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`)
        .join(", ");

      // Single SQL UPDATE with JOIN to update all references at once
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
      params.push(channelId, guildId);

      const result = await this.db.query(updateQuery, params);

      if (result.success) {
        const repaired = (result.data as any)?.rowCount || 0;
        if (repaired > 0 && this.verbose) {
          console.log(
            `   🔧 ${batchLabel} Repaired ${repaired} reply references`
          );
        }
      }
    } catch (error: any) {
      // Don't fail the sync if repair fails
      if (this.verbose) {
        console.log(
          `   🔸 ${batchLabel} Error repairing reply references: ${
            error.message || error
          }`
        );
      }
    }
  }

  /**
   * Start periodic maintenance (every 10 minutes)
   */
  startMaintenance(): void {
    this.maintenanceTimer = setInterval(async () => {
      await this.runMaintenance();
    }, 10 * 60 * 1000);
  }

  /**
   * Run periodic maintenance tasks
   */
  private async runMaintenance(): Promise<void> {
    try {
      console.log("🔹 Running periodic maintenance...");

      await this.compactSegments();
      await this.updateRollingWindows();

      console.log("✅ Periodic maintenance completed");
    } catch (error) {
      console.error("🔸 Error during maintenance:", error);
    }
  }

  /**
   * Compact old conversation segments
   */
  private async compactSegments(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    const result = await this.db.query(
      `DELETE FROM conversation_segments 
       WHERE start_time < $1 
       AND (SELECT COUNT(*) FROM unnest(participants) p) > 5`,
      [cutoffDate]
    );

    if (result.success) {
      console.log(`🔹 Compacted old segments`);
    }
  }

  /**
   * Update rolling windows for edges
   */
  private async updateRollingWindows(): Promise<void> {
    const cutoff7d = new Date();
    cutoff7d.setDate(cutoff7d.getDate() - 7);

    const cutoff30d = new Date();
    cutoff30d.setDate(cutoff30d.getDate() - 30);

    const guilds = this.client.guilds.cache;
    for (const [, guild] of guilds) {
      await this.db.updateEdgeRollingWindows(guild.id, cutoff7d, cutoff30d);
    }
  }

  /**
   * Stop maintenance
   */
  stop(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
    }
    console.log("🔹 Database maintenance stopped");
  }
}
