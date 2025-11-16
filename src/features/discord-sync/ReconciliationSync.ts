import type { Client, Guild } from "discord.js";
import type { KeywordMessage } from "../social-intelligence/semantic-analysis/types";
import { KeywordExtractor } from "../social-intelligence/semantic-analysis/KeywordExtractor";
import { RelationshipMapper } from "../social-intelligence/relationship-mapping/RelationshipMapper";
import { parseEmbedding } from "../social-intelligence/conversation-detection/messageUtils";
import { config } from "../../config/index.js";
import type { SyncCoordinator } from "./SyncCoordinator";
import type { PostgreSQLManager } from "../../database/PostgreSQLManager";
import { timeOperation } from "../../utils/timing";

/**
 * Background reconciliation and healing for Discord state
 *
 * Responsibilities:
 * - Detect and fill message gaps (bot downtime, missed events)
 * - Backfill conversation keywords
 * - Validate data consistency (channels, members, messages)
 * - Consolidate duplicate/overlapping segments
 *
 * Priority: LOW (background, non-blocking)
 * Coordination: Uses SyncCoordinator to avoid conflicts with LiveEventSync
 *
 * Key Principle: NEVER overwrite recent data managed by LiveEventSync
 */
export class ReconciliationSync {
  private client: Client;
  private db: PostgreSQLManager;
  private relationshipMapper: RelationshipMapper;
  private coordinator: SyncCoordinator;
  private verbose: boolean;
  private keywordExtractor: KeywordExtractor;

  private readonly KEYWORD_HEAL_SEGMENT_LIMIT = 200;

  // Statistics
  private stats = {
    lastRunTime: null as Date | null,
    gapsDetected: 0,
    messagesFilled: 0,
    channelsSynced: 0,
    membersSynced: 0,
  };

  constructor(
    client: Client,
    db: PostgreSQLManager,
    relationshipMapper: RelationshipMapper,
    coordinator: SyncCoordinator,
    verbose: boolean = false
  ) {
    this.client = client;
    this.db = db;
    this.relationshipMapper = relationshipMapper;
    this.coordinator = coordinator;
    this.verbose = verbose;
    this.keywordExtractor = new KeywordExtractor(db);
  }

  /**
   * Run full reconciliation pass
   */
  async runOnce(): Promise<void> {
    console.log("🔹 ReconciliationSync: Starting reconciliation pass...");

    try {
      if (config.guildId) {
        const targetGuild = this.client.guilds.cache.get(config.guildId);
        if (targetGuild) {
          console.log(
            `🔹 ReconciliationSync: Limiting to guild: ${targetGuild.name} (${config.guildId})`
          );
          await this.reconcileGuild(targetGuild);
        } else {
          console.log(
            `🔸 ReconciliationSync: Guild ID ${config.guildId} not found in cache`
          );
        }
      } else {
        for (const [, guild] of this.client.guilds.cache) {
          await this.reconcileGuild(guild);
        }
      }

      this.stats.lastRunTime = new Date();
      console.log("✅ ReconciliationSync: Reconciliation pass completed");
    } catch (error) {
      console.error(
        "🔸 ReconciliationSync: Error during reconciliation:",
        error
      );
    }
  }

  /**
   * Reconcile a single guild
   */
  private async reconcileGuild(guild: Guild): Promise<void> {
    if (this.verbose) {
      console.log(`🔹 ReconciliationSync: Reconciling guild: ${guild.name}`);
    }

    const guildId = guild.id;

    // Sync guild metadata (coordinator prevents conflicts)
    const releaseLock = await this.coordinator.acquireGuildLock(guildId);
    try {
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
        console.error(
          `🔸 ReconciliationSync: Failed to upsert guild ${guildId}`
        );
        return;
      }
    } finally {
      releaseLock();
    }

    await this.reconcileChannels(guild);

    await this.reconcileMembers(guild);

    await this.reconcileMessages(guild);

    await this.reconcileConversationKeywords(guild);

    if (this.verbose) {
      console.log(`✅ ReconciliationSync: Completed for ${guild.name}`);
    }
  }

  /**
   * Reconcile channels (detect missing channels, update metadata)
   */
  private async reconcileChannels(guild: Guild): Promise<void> {
    const channels = Array.from(guild.channels.cache.values()).filter(
      (ch) => ch.isTextBased() && !ch.isDMBased()
    );

    if (this.verbose) {
      console.log(
        `   📝 ReconciliationSync: Syncing ${channels.length} channels...`
      );
    }

    for (const channel of channels) {
      const releaseLock = await this.coordinator.acquireChannelLock(channel.id);

      try {
        await this.db.upsertChannel({
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

        this.stats.channelsSynced++;
      } finally {
        releaseLock();
      }
    }
  }

  /**
   * Reconcile members (detect missing members, update profiles)
   */
  private async reconcileMembers(guild: Guild): Promise<void> {
    if (this.verbose) {
      console.log(`   👥 ReconciliationSync: Fetching members...`);
    }

    const members = await guild.members.fetch();
    const membersArray = Array.from(members.values());

    if (this.verbose) {
      console.log(
        `   👥 ReconciliationSync: Syncing ${membersArray.length} members...`
      );
    }

    for (const member of membersArray) {
      const releaseLock = await this.coordinator.acquireMemberLock(
        `${guild.id}_${member.user.id}`
      );

      try {
        await this.db.upsertMember({
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

        this.stats.membersSynced++;
      } catch (error) {
        // Silent failure for individual members
      } finally {
        releaseLock();
      }
    }
  }

  /**
   * Reconcile messages (detect gaps, backfill missing messages)
   *
   * Key Strategy:
   * - Check watermarks to detect gaps
   * - Only backfill OLDER messages (never overwrite LiveEventSync data)
   * - Use coordinator to ensure watermarks don't regress
   */
  private async reconcileMessages(guild: Guild): Promise<void> {
    const channels = Array.from(guild.channels.cache.values()).filter(
      (ch) => ch.isTextBased() && !ch.isDMBased()
    );

    let channelsProcessed = 0;
    let channelsWithGaps = 0;
    let channelsBackfilled = 0;

    // Process channels in parallel with concurrency limit
    const concurrency = 10; // Process 10 channels simultaneously
    const results = await this.processChannelsConcurrently(
      channels,
      guild.id,
      concurrency
    );

    channelsProcessed = results.processed;
    channelsBackfilled = results.backfilled;
    channelsWithGaps = results.gapChecks;
  }

  /**
   * Process multiple channels concurrently with rate limiting
   */
  private async processChannelsConcurrently(
    channels: any[],
    guildId: string,
    concurrency: number
  ): Promise<{
    processed: number;
    backfilled: number;
    gapChecks: number;
  }> {
    let processed = 0;
    let backfilled = 0;
    let gapChecks = 0;

    // Process channels in batches of 'concurrency' size
    for (let i = 0; i < channels.length; i += concurrency) {
      const batch = channels.slice(i, i + concurrency);

      // Process batch concurrently
      const batchResults = await Promise.allSettled(
        batch.map(async (channel) => {
          const channelStart = performance.now();
          try {
            const watermarkResult = await this.db.getChannelWatermark(
              channel.id
            );

            if (!watermarkResult.success || !watermarkResult.data) {
              // No watermark = channel never synced, backfill all messages
              await this.backfillChannel(guildId, channel.id, null);
              return { type: "backfilled" as const };
            } else {
              const watermark = watermarkResult.data.last_message_id;

              if (!watermark) {
                // Watermark exists but NULL (messages cleared), backfill all
                await this.backfillChannel(guildId, channel.id, null);
                return { type: "backfilled" as const };
              } else {
                // OPTIMIZATION: Quick check if watermark is still current
                const isUpToDate = await this.isChannelUpToDate(
                  channel,
                  watermark
                );
                if (isUpToDate) {
                  return { type: "skip" as const };
                }

                // Watermark exists but outdated, check for gaps
                await this.detectAndFillGaps(guildId, channel.id, watermark);
                return { type: "gapCheck" as const };
              }
            }
          } catch (error: any) {
            if (error.code === 50001 || error.status === 403) {
              // Missing permissions, skip silently
              return { type: "skip" as const };
            }

            if (this.verbose) {
              console.error(
                `   🔸 ReconciliationSync: Error reconciling channel ${channel.id}:`,
                error
              );
            }
            return { type: "error" as const };
          } finally {
            const channelDuration = performance.now() - channelStart;

            // Log slow channels (> 10 seconds)
            if (channelDuration > 10000) {
              const channelName = (channel as any).name || channel.id;
              console.log(
                `      ⚠️  Slow channel: #${channelName} took ${(
                  channelDuration / 1000
                ).toFixed(1)}s`
              );
            }
          }
        })
      );

      // Count results
      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          processed++;
          if (result.value.type === "backfilled") {
            backfilled++;
          } else if (result.value.type === "gapCheck") {
            gapChecks++;
          }
        }
      }
    }

    return { processed, backfilled, gapChecks };
  }

  /**
   * Quick check if channel's watermark points to the most recent message
   * Returns true if channel is up-to-date (no reconciliation needed)
   */
  private async isChannelUpToDate(
    channel: any,
    watermark: string
  ): Promise<boolean> {
    try {
      // Fetch only the most recent message from Discord
      const messages = await channel.messages.fetch({ limit: 1 });

      if (!messages || messages.size === 0) {
        // No messages in channel, up-to-date
        return true;
      }

      const latestMessage = messages.first();

      // If watermark matches latest message, no gaps possible
      return latestMessage?.id === watermark;
    } catch (error) {
      // On error, assume not up-to-date to be safe
      return false;
    }
  }

  /**
   * Backfill all messages in a channel (no watermark)
   */
  private async backfillChannel(
    guildId: string,
    channelId: string,
    watermark: string | null
  ): Promise<void> {
    const channel = this.client.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return;

    const channelName = `#${(channel as any).name || channelId}`;

    let lastId: string | null = null;
    let synced = 0;
    const batchSize = 100;

    while (true) {
      const options: any = { limit: batchSize };
      if (lastId) {
        options.before = lastId;
      }

      const messages = await (channel as any).messages.fetch(options);
      if (!messages || messages.size === 0) break;

      // Filter out messages that already exist in DB (avoid duplicate work)
      const messageIds = Array.from(messages.keys());
      const existingResult = await this.db.query(
        `SELECT id FROM messages WHERE id = ANY($1)`,
        [messageIds]
      );

      const existingIds = new Set<string>();
      if (existingResult.success && existingResult.data) {
        for (const row of existingResult.data) {
          existingIds.add(row.id);
        }
      }

      // Insert only missing messages
      for (const [, msg] of messages) {
        if (!existingIds.has(msg.id)) {
          await this.db.upsertMessage({
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
          });

          if (!msg.author.bot) {
            synced++;
            this.stats.messagesFilled++;
          }
        }
      }

      lastId = messages.last()?.id || null;
      if (messages.size < batchSize) break;
    }

    // Set watermark ONLY if no watermark exists (avoid regressing)
    if (synced > 0) {
      const mostRecentResult = await this.db.query(
        "SELECT id FROM messages WHERE channel_id = $1 AND guild_id = $2 ORDER BY created_at DESC LIMIT 1",
        [channelId, guildId]
      );

      if (
        mostRecentResult.success &&
        mostRecentResult.data &&
        mostRecentResult.data.length > 0
      ) {
        await this.coordinator.tryUpdateWatermarkIfMissing(
          channelId,
          mostRecentResult.data[0].id
        );
      }

      if (this.verbose) {
        console.log(
          `   ✅ ReconciliationSync: Backfilled ${synced} messages in ${channelName}`
        );
      }
    }
  }

  /**
   * Detect and fill gaps (messages before watermark that are missing from DB)
   */
  private async detectAndFillGaps(
    guildId: string,
    channelId: string,
    watermark: string
  ): Promise<void> {
    const channel = this.client.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return;

    // Fetch oldest message in DB for this channel
    const oldestResult = await this.db.query(
      "SELECT id, created_at FROM messages WHERE channel_id = $1 AND active = true ORDER BY created_at ASC LIMIT 1",
      [channelId]
    );

    if (
      !oldestResult.success ||
      !oldestResult.data ||
      oldestResult.data.length === 0
    ) {
      // No messages in DB, backfill from watermark backward
      await this.backfillChannel(guildId, channelId, watermark);
      return;
    }

    const oldestInDb = oldestResult.data[0].id;

    // OPTIMIZATION: Sample first few batches to detect if gaps exist
    // This avoids fetching 50+ batches when channel has continuous history
    let lastId: string | null = watermark;
    let synced = 0;
    const batchSize = 100;
    const sampleSize = 3; // Check first 300 messages
    const maxBatches = 50; // Safety limit

    // Quick sample pass to detect gaps
    let gapDetected = false;
    let reachedOldestInSample = false;
    let consecutiveBatchesWithNoGaps = 0;

    for (let i = 0; i < sampleSize && i < maxBatches; i++) {
      const options: any = { limit: batchSize, before: lastId };
      const messages = await (channel as any).messages.fetch(options);

      if (!messages || messages.size === 0) break;

      // Check if we've reached the oldest message in DB
      for (const [, msg] of messages) {
        if (msg.id === oldestInDb) {
          reachedOldestInSample = true;
          break;
        }
      }

      // Check if these messages exist in DB
      const messageIds = Array.from(messages.keys());
      const existingResult = await this.db.query(
        `SELECT id FROM messages WHERE id = ANY($1) AND active = true`,
        [messageIds]
      );

      const existingCount =
        existingResult.success && existingResult.data
          ? existingResult.data.length
          : 0;

      // If any messages missing, we have a gap
      if (existingCount < messageIds.length) {
        gapDetected = true;
        break; // Exit early - we found a gap
      } else {
        consecutiveBatchesWithNoGaps++;
        // If we have 2+ consecutive batches with all messages present,
        // very high confidence there are no gaps
        if (consecutiveBatchesWithNoGaps >= 2 && !reachedOldestInSample) {
          break;
        }
      }

      lastId = messages.last()?.id || null;
      if (reachedOldestInSample || messages.size < batchSize || !lastId) break;
    }

    // If no gaps in sample and we didn't reach oldest message, skip full scan
    if (!gapDetected && !reachedOldestInSample) {
      return;
    }

    // Full scan needed: either gaps detected or reached oldest message in sample
    // Reset and do complete processing
    lastId = watermark;
    synced = 0;

    for (let i = 0; i < maxBatches; i++) {
      const options: any = { limit: batchSize, before: lastId };
      const messages = await (channel as any).messages.fetch(options);

      if (!messages || messages.size === 0) break;

      // Check if we've reached the oldest message in DB
      let reachedOldest = false;
      for (const [, msg] of messages) {
        if (msg.id === oldestInDb) {
          reachedOldest = true;
          break;
        }
      }

      // Filter out messages that already exist
      const messageIds = Array.from(messages.keys());
      const existingResult = await this.db.query(
        `SELECT id FROM messages WHERE id = ANY($1) AND active = true`,
        [messageIds]
      );

      const existingIds = new Set<string>();
      if (existingResult.success && existingResult.data) {
        for (const row of existingResult.data) {
          existingIds.add(row.id);
        }
      }

      // Insert missing messages
      for (const [, msg] of messages) {
        if (!existingIds.has(msg.id)) {
          await this.db.upsertMessage({
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
          });

          if (!msg.author.bot) {
            synced++;
            this.stats.messagesFilled++;
            this.stats.gapsDetected++;
          }
        }
      }

      if (reachedOldest || messages.size < batchSize) break;

      lastId = messages.last()?.id || null;
      if (!lastId) break;
    }

    if (synced > 0 && this.verbose) {
      console.log(
        `   ✅ ReconciliationSync: Filled ${synced} gap messages in channel ${channelId}`
      );
    }
  }

  /**
   * Reconcile conversation keywords (backfill missing keywords)
   */
  private async reconcileConversationKeywords(guild: Guild): Promise<void> {
    try {
      const attemptedSegments = new Set<string>();
      let totalUpdated = 0;
      let batchNumber = 0;

      while (true) {
        const segmentsResult = await this.db.query(
          `
					SELECT id, message_ids, features
					FROM conversation_segments
					WHERE guild_id = $1
						AND status = 'finalized'
						AND (
							features IS NULL
							OR NOT (COALESCE(features, '{}'::jsonb) ? 'keywords')
							OR jsonb_array_length(
									COALESCE(features->'keywords'->'terms', '[]'::jsonb)
								) = 0
						)
					ORDER BY end_time DESC
					LIMIT $2
					`,
          [guild.id, this.KEYWORD_HEAL_SEGMENT_LIMIT]
        );

        if (!segmentsResult.success || !segmentsResult.data) {
          break;
        }

        const segmentsNeedingKeywords = segmentsResult.data;
        if (segmentsNeedingKeywords.length === 0) {
          break;
        }

        batchNumber++;
        if (this.verbose) {
          console.log(
            `   🧠 ReconciliationSync: [Batch ${batchNumber}] Extracting keywords for ${segmentsNeedingKeywords.length} segments...`
          );
        }

        let updatedThisBatch = 0;

        for (const segment of segmentsNeedingKeywords) {
          if (attemptedSegments.has(segment.id)) {
            continue;
          }
          attemptedSegments.add(segment.id);

          if (
            !Array.isArray(segment.message_ids) ||
            segment.message_ids.length === 0
          ) {
            continue;
          }

          const messagesResult = await this.db.query(
            `
						SELECT id, content, author_id, embedding
						FROM messages
						WHERE id = ANY($1)
							AND content IS NOT NULL
							AND LENGTH(TRIM(content)) > 0
						ORDER BY created_at ASC
						`,
            [segment.message_ids]
          );

          if (
            !messagesResult.success ||
            !messagesResult.data ||
            messagesResult.data.length === 0
          ) {
            continue;
          }

          const keywordMessages: KeywordMessage[] = messagesResult.data.map(
            (msg: {
              id: string;
              content: string;
              author_id: string;
              embedding: unknown;
            }) => ({
              id: msg.id,
              content: msg.content,
              author_id: msg.author_id,
              embedding: parseEmbedding(msg.embedding),
            })
          );

          try {
            const keywords = await this.keywordExtractor.extractKeywords(
              keywordMessages,
              guild.id,
              { topN: 10, method: "hybrid" }
            );

            const existingFeaturesRaw = segment.features ?? {};
            const existingFeatures =
              typeof existingFeaturesRaw === "string"
                ? JSON.parse(existingFeaturesRaw)
                : { ...(existingFeaturesRaw || {}) };

            existingFeatures.keywords = keywords;

            await this.db.query(
              `UPDATE conversation_segments SET features = $1 WHERE id = $2`,
              [JSON.stringify(existingFeatures), segment.id]
            );

            totalUpdated++;
            updatedThisBatch++;
          } catch (error) {
            if (this.verbose) {
              console.error(
                `   🔸 ReconciliationSync: Failed to extract keywords for segment ${segment.id}:`,
                error
              );
            }
          }
        }

        if (segmentsNeedingKeywords.length < this.KEYWORD_HEAL_SEGMENT_LIMIT) {
          break;
        }

        if (updatedThisBatch === 0) {
          break;
        }
      }
    } catch (error) {
      console.error(
        `   🔸 ReconciliationSync: Error reconciling conversation keywords for ${guild.name}:`,
        error
      );
    }
  }

  /**
   * Run periodic maintenance tasks
   */
  async runMaintenance(): Promise<void> {
    await this.compactSegments();
    await this.updateRollingWindows();
    await this.consolidateOverlappingSegments();
  }

  /**
   * Compact old conversation segments (delete old, large segments)
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

    if (result.success && this.verbose) {
      const deleted = (result.data as any)?.rowCount || 0;
      if (deleted > 0) {
        console.log(`🔹 ReconciliationSync: Compacted ${deleted} old segments`);
      }
    }
  }

  /**
   * Update rolling windows for relationship edges
   */
  private async updateRollingWindows(): Promise<void> {
    const cutoff7d = new Date();
    cutoff7d.setDate(cutoff7d.getDate() - 7);

    const cutoff30d = new Date();
    cutoff30d.setDate(cutoff30d.getDate() - 30);

    if (config.guildId) {
      const targetGuild = this.client.guilds.cache.get(config.guildId);
      if (targetGuild) {
        await this.db.updateEdgeRollingWindows(
          targetGuild.id,
          cutoff7d,
          cutoff30d
        );
      }
    } else {
      for (const [, guild] of this.client.guilds.cache) {
        await this.db.updateEdgeRollingWindows(guild.id, cutoff7d, cutoff30d);
      }
    }
  }

  /**
   * Consolidate overlapping segments in the same channel
   */
  private async consolidateOverlappingSegments(): Promise<void> {
    try {
      const guildsToProcess = config.guildId
        ? (() => {
            const guild = this.client.guilds.cache.get(config.guildId!);
            return guild ? [guild] : [];
          })()
        : Array.from(this.client.guilds.cache.values());

      let consolidated = 0;

      for (const guild of guildsToProcess) {
        const segmentsResult = await this.db.query(
          `SELECT id, channel_id, participants, start_time, end_time, message_ids, message_count
					 FROM conversation_segments
					 WHERE guild_id = $1
					 ORDER BY channel_id, start_time ASC`,
          [guild.id]
        );

        if (!segmentsResult.success || !segmentsResult.data) continue;

        const segments = segmentsResult.data;
        const processed = new Set<string>();
        const toDelete = new Set<string>();

        for (let i = 0; i < segments.length; i++) {
          const seg1 = segments[i];
          if (processed.has(seg1.id) || toDelete.has(seg1.id)) continue;

          const seg1Participants = Array.isArray(seg1.participants)
            ? new Set(seg1.participants)
            : new Set();

          const seg1Start = new Date(seg1.start_time).getTime();
          const seg1End = new Date(seg1.end_time).getTime();
          const mergeWindow = 30 * 60 * 1000; // 30 minutes

          const toMerge: any[] = [seg1];

          for (let j = i + 1; j < segments.length; j++) {
            const seg2 = segments[j];
            if (seg1.channel_id !== seg2.channel_id) break;

            if (processed.has(seg2.id) || toDelete.has(seg2.id)) continue;

            const seg2Start = new Date(seg2.start_time).getTime();
            const seg2End = new Date(seg2.end_time).getTime();

            const timeGap = Math.min(
              Math.abs(seg2Start - seg1End),
              Math.abs(seg2End - seg1Start)
            );

            if (timeGap > mergeWindow) continue;

            const seg2Participants = Array.isArray(seg2.participants)
              ? new Set(seg2.participants)
              : new Set();

            const hasOverlap = Array.from(seg1Participants).some((p) =>
              seg2Participants.has(p)
            );

            if (hasOverlap) {
              toMerge.push(seg2);
            }
          }

          if (toMerge.length > 1) {
            const allParticipants = new Set<string>();
            const allMessageIds = new Set<string>();
            let earliestStart = Infinity;
            let latestEnd = -Infinity;

            for (const seg of toMerge) {
              const participants = Array.isArray(seg.participants)
                ? seg.participants
                : [];
              participants.forEach((p: string) => allParticipants.add(p));

              const msgIds = Array.isArray(seg.message_ids)
                ? seg.message_ids
                : [];
              msgIds.forEach((id: string) => allMessageIds.add(id));

              const start = new Date(seg.start_time).getTime();
              const end = new Date(seg.end_time).getTime();
              earliestStart = Math.min(earliestStart, start);
              latestEnd = Math.max(latestEnd, end);
            }

            const mergedParticipants = Array.from(allParticipants).sort();
            const mergedMessageIds = Array.from(allMessageIds);
            const keepId = toMerge[0].id;

            await this.db.query(
              `UPDATE conversation_segments
							 SET participants = $1::TEXT[],
									 message_ids = $2::TEXT[],
									 message_count = $3,
									 start_time = $4,
									 end_time = $5
							 WHERE id = $6`,
              [
                mergedParticipants,
                mergedMessageIds,
                mergedMessageIds.length,
                new Date(earliestStart),
                new Date(latestEnd),
                keepId,
              ]
            );

            for (let k = 1; k < toMerge.length; k++) {
              toDelete.add(toMerge[k].id);
              processed.add(toMerge[k].id);
            }

            consolidated += toMerge.length - 1;
            processed.add(keepId);
          } else {
            processed.add(seg1.id);
          }
        }

        if (toDelete.size > 0) {
          const deleteIds = Array.from(toDelete);
          await this.db.query(
            `DELETE FROM conversation_segments WHERE id = ANY($1::TEXT[])`,
            [deleteIds]
          );
        }
      }

      if (consolidated > 0 && this.verbose) {
        console.log(
          `🔹 ReconciliationSync: Consolidated ${consolidated} overlapping segments`
        );
      }
    } catch (error) {
      // Silent failure - consolidation is optional
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    lastRunTime: Date | null;
    gapsDetected: number;
    messagesFilled: number;
  } {
    return {
      lastRunTime: this.stats.lastRunTime,
      gapsDetected: this.stats.gapsDetected,
      messagesFilled: this.stats.messagesFilled,
    };
  }
}
