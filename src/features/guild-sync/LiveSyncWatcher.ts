import type {
  Client,
  MessageReaction,
  User,
  GuildMember,
  Role,
} from "discord.js";
import { Message } from "discord.js";
import type { PostgreSQLManager } from "../database/PostgreSQLManager";
import { RelationshipNetworkManager } from "../relationship-network/NetworkManager";
import { ConversationManager } from "../relationship-network/ConversationManager";

export class LiveSyncWatcher {
  private client: Client;
  private db: PostgreSQLManager;
  private relationshipManager: RelationshipNetworkManager;
  private conversationManager: ConversationManager;
  private rollupQueue: Map<string, number> = new Map(); // userId:guildId -> interaction count
  private rollupTimer?: NodeJS.Timeout;
  private recentMessageIds: Map<string, number> = new Map(); // messageId -> timestamp
  private readonly MESSAGE_DEDUP_WINDOW = 5000; // 5 seconds
  private readonly MAX_RECENT_MESSAGES = 1000; // Prevent unbounded growth
  private readonly ROLLUP_SIZE_THRESHOLD = 50; // Process when this many unique users queued
  private readonly ROLLUP_TIME_THRESHOLD = 30 * 1000; // Or every 30 seconds
  private lastRollupTime = Date.now();

  constructor(
    client: Client,
    db: PostgreSQLManager,
    relationshipManager: RelationshipNetworkManager,
    conversationManager: ConversationManager
  ) {
    this.client = client;
    this.db = db;
    this.relationshipManager = relationshipManager;
    this.conversationManager = conversationManager;
  }

  /**
   * Start watching Discord events
   */
  start(): void {
    console.log("🔹 LiveSyncWatcher: Starting event listeners");

    this.client.on("messageCreate", (message) => {
      this.handleMessageCreate(message).catch((err) => {
        console.error("🔸 Error in messageCreate handler:", err);
        console.error("   Message ID:", message.id);
        console.error("   Channel:", message.channel.id);
        console.error("   Guild:", message.guildId);
      });
    });

    this.client.on("messageUpdate", (oldMessage, newMessage) => {
      if (newMessage instanceof Message && !newMessage.author?.bot) {
        this.handleMessageUpdate(newMessage).catch((err) => {
          console.error("🔸 Error in messageUpdate handler:", err);
        });
      }
    });

    this.client.on("messageDelete", (message) => {
      if (message instanceof Message && !message.author?.bot) {
        this.handleMessageDelete(message).catch((err) => {
          console.error("🔸 Error in messageDelete handler:", err);
        });
      }
    });

    this.client.on("messageReactionAdd", (reaction, user) => {
      if (user && !user.bot && !user.partial && !reaction.partial) {
        this.handleReactionAdd(reaction, user).catch((err) => {
          console.error("🔸 Error in reactionAdd handler:", err);
        });
      }
    });

    this.client.on("messageReactionRemove", (reaction, user) => {
      if (user && !user.bot && !user.partial && !reaction.partial) {
        this.handleReactionRemove(reaction, user).catch((err) => {
          console.error("🔸 Error in reactionRemove handler:", err);
        });
      }
    });

    // Reapply previous roles on rejoin; mark inactive on leave
    this.client.on("guildMemberAdd", (member) => {
      this.handleGuildMemberAdd(member as GuildMember).catch(() => {});
    });
    this.client.on("guildMemberRemove", (member) => {
      this.handleGuildMemberRemove(member as GuildMember).catch(() => {});
    });

    this.startRollupTimer();
  }

  /**
   * Check if message was already processed (deduplication)
   */
  private isMessageDuplicate(messageId: string): boolean {
    const now = Date.now();
    const lastSeen = this.recentMessageIds.get(messageId);

    if (!lastSeen) {
      // First time seeing this message
      this.recentMessageIds.set(messageId, now);
      this.cleanupOldMessages(now);
      return false;
    }

    // If we've seen it recently, it's a duplicate
    if (now - lastSeen < this.MESSAGE_DEDUP_WINDOW) {
      return true;
    }

    // Outside dedup window, treat as new
    this.recentMessageIds.set(messageId, now);
    return false;
  }

  /**
   * Clean up old message IDs to prevent unbounded memory growth
   */
  private cleanupOldMessages(now: number): void {
    // If we've accumulated too many, remove oldest entries
    if (this.recentMessageIds.size > this.MAX_RECENT_MESSAGES) {
      const entriesToRemove = this.recentMessageIds.size - this.MAX_RECENT_MESSAGES;
      let removed = 0;

      for (const [messageId, timestamp] of this.recentMessageIds.entries()) {
        if (now - timestamp > this.MESSAGE_DEDUP_WINDOW) {
          this.recentMessageIds.delete(messageId);
          removed++;
          if (removed >= entriesToRemove) break;
        }
      }
    }
  }

  /**
   * Handle new message
   */
  private async handleMessageCreate(message: Message): Promise<void> {
    // Check for duplicate messages (Discord sometimes resends)
    if (this.isMessageDuplicate(message.id)) {
      return;
    }

    if (!message.guildId) {
      return;
    }

    const guildId = message.guildId;
    const authorId = message.author.id;
    const timestamp = message.createdAt;
    const isBot = message.author.bot;

    try {
      // Ensure guild exists before inserting message (foreign key constraint)
      const guild = message.guild;
      if (guild) {
        await this.db.upsertGuild({
          id: guild.id,
          name: guild.name,
          description: guild.description || undefined,
          icon: guild.icon || undefined,
          owner_id: guild.ownerId || "",
          member_count: guild.memberCount,
          active: true,
          created_at: guild.createdAt || new Date(),
        });
      }

      // Ensure channel exists before inserting message (foreign key constraint)
      const channel = message.channel;
      if (channel && "name" in channel) {
        await this.db.upsertChannel({
          id: channel.id,
          guild_id: guildId,
          name: (channel as any).name || "",
          type: channel.type,
          position: (channel as any).position || 0,
          topic: (channel as any).topic || undefined,
          nsfw: (channel as any).nsfw || false,
          parent_id: (channel as any).parentId || undefined,
          active: true,
        });
      }

      // Save ALL messages to database (including bots)
      const result = await this.db.upsertMessage({
        id: message.id,
        guild_id: guildId,
        channel_id: message.channel.id,
        author_id: authorId,
        content: message.content || "",
        created_at: timestamp,
        edited_at: message.editedAt || undefined,
        attachments: Array.from(message.attachments.values()).map(
          (a: any) => a.url
        ),
        embeds: message.embeds.map((e: any) => JSON.stringify(e.toJSON())),
        referenced_message_id: message.reference?.messageId || undefined,
        active: true,
      });

      if (!result.success) {
        console.error(`🔸 Failed to save message ${message.id}:`, result.error);
        return;
      }
    } catch (error) {
      console.error(`🔸 Exception saving message ${message.id}:`, error);
      throw error; // Re-throw so outer catch can log it
    }

    await this.db.updateChannelLastMessage(message.channel.id, message.id);

    // Skip relationship/conversation tracking for bot messages
    if (isBot) {
      return;
    }

    const mentionedUsers = Array.from(message.mentions.users.values())
      .filter((u) => !u.bot && u.id !== authorId)
      .map((u) => u.id);

    await this.conversationManager.addMessageToStream({
      id: message.id,
      author_id: authorId,
      content: message.content || "",
      created_at: timestamp,
      guild_id: guildId,
      channel_id: message.channel.id,
      referenced_message_id: message.reference?.messageId || undefined,
      mentioned_user_ids: mentionedUsers,
    });

    for (const mentionedId of mentionedUsers) {
      await this.relationshipManager.recordInteraction(
        guildId,
        authorId,
        mentionedId,
        "mention",
        "a_to_b",
        timestamp
      );
      this.queueRollup(authorId, guildId);
      this.queueRollup(mentionedId, guildId);
    }

    // Handle reply interactions and track reply chain context
    if (message.reference?.messageId) {
      try {
        const referencedMessage = await message.channel.messages.fetch(
          message.reference.messageId
        );
        const repliedToId = referencedMessage.author.id;

        if (repliedToId !== authorId) {
          // Direct reply interaction
          await this.relationshipManager.recordInteraction(
            guildId,
            authorId,
            repliedToId,
            "reply",
            "a_to_b",
            timestamp
          );
          this.queueRollup(authorId, guildId);
          this.queueRollup(repliedToId, guildId);

          // If the replied-to message is itself a reply, also record interaction with the original author
          // This captures extended conversation threads
          if (
            referencedMessage.reference?.messageId &&
            referencedMessage.reference.messageId !== message.reference.messageId
          ) {
            try {
              const originalMessage = await message.channel.messages.fetch(
                referencedMessage.reference.messageId
              );
              const originalAuthorId = originalMessage.author.id;

              if (
                originalAuthorId !== authorId &&
                originalAuthorId !== repliedToId
              ) {
                // Record indirect interaction with original author (weaker signal: "message" instead of "reply")
                await this.relationshipManager.recordInteraction(
                  guildId,
                  authorId,
                  originalAuthorId,
                  "message",
                  "a_to_b",
                  timestamp
                );
                this.queueRollup(authorId, guildId);
                this.queueRollup(originalAuthorId, guildId);
              }
            } catch {
              // Original message may not be accessible
            }
          }
        }
      } catch (err) {
        // Referenced message may not exist
      }
    }

    const recentMessages = await this.getRecentChannelMessages(
      guildId,
      message.channel.id,
      10
    );

    for (const otherMsg of recentMessages) {
      if (
        otherMsg.author_id !== authorId &&
        Math.abs(timestamp.getTime() - otherMsg.created_at.getTime()) < 30000
      ) {
        await this.relationshipManager.recordInteraction(
          guildId,
          authorId,
          otherMsg.author_id,
          "message",
          "a_to_b",
          timestamp
        );
        this.queueRollup(authorId, guildId);
        this.queueRollup(otherMsg.author_id, guildId);
      }
    }
  }

  /**
   * Handle message update
   */
  private async handleMessageUpdate(message: Message): Promise<void> {
    if (!message.guildId || message.author.bot) return;

    try {
      // Ensure guild exists before updating message (foreign key constraint)
      const guild = message.guild;
      if (guild) {
        await this.db.upsertGuild({
          id: guild.id,
          name: guild.name,
          description: guild.description || undefined,
          icon: guild.icon || undefined,
          owner_id: guild.ownerId || "",
          member_count: guild.memberCount,
          active: true,
          created_at: guild.createdAt || new Date(),
        });
      }

      // Ensure channel exists before updating message (foreign key constraint)
      const channel = message.channel;
      if (channel && "name" in channel) {
        await this.db.upsertChannel({
          id: channel.id,
          guild_id: message.guildId,
          name: (channel as any).name || "",
          type: channel.type,
          position: (channel as any).position || 0,
          topic: (channel as any).topic || undefined,
          nsfw: (channel as any).nsfw || false,
          parent_id: (channel as any).parentId || undefined,
          active: true,
        });
      }

      // Update message in database
      await this.db.upsertMessage({
        id: message.id,
        guild_id: message.guildId,
        channel_id: message.channel.id,
        author_id: message.author.id,
        content: message.content || "",
        created_at: message.createdAt,
        edited_at: message.editedAt || undefined,
        attachments: Array.from(message.attachments.values()).map(
          (a: any) => a.url
        ),
        embeds: message.embeds.map((e: any) => JSON.stringify(e.toJSON())),
        referenced_message_id: message.reference?.messageId || undefined,
        active: true,
      });
    } catch (error) {
      console.error(`🔸 Exception updating message ${message.id}:`, error);
    }
  }

  /**
   * Handle message delete
   */
  private async handleMessageDelete(message: Message): Promise<void> {
    if (!message.guildId || message.author.bot) return;

    // Mark message as inactive in database
    await this.db.query("UPDATE messages SET active = false WHERE id = $1", [
      message.id,
    ]);
  }

  /**
   * Handle reaction add
   */
  private async handleReactionAdd(
    reaction: MessageReaction,
    user: User
  ): Promise<void> {
    if (!reaction.message.guildId || user.bot) return;

    let authorId: string | null = null;

    // Try to get author from cached message
    if (reaction.message.author) {
      authorId = reaction.message.author.id;
    } else {
      // Message not in cache, fetch it
      try {
        const message = await reaction.message.fetch();
        if (message.author) {
          authorId = message.author.id;
        }
      } catch (err) {
        // Message might not exist or be inaccessible
        return;
      }
    }

    if (!authorId || authorId === user.id) return;

    const guildId = reaction.message.guildId;
    const reactorId = user.id;

    await this.relationshipManager.recordInteraction(
      guildId,
      reactorId,
      authorId,
      "reaction",
      "a_to_b",
      new Date()
    );
    this.queueRollup(reactorId, guildId);
    this.queueRollup(authorId, guildId);
  }

  /**
   * Handle reaction remove
   */
  private async handleReactionRemove(
    reaction: MessageReaction,
    user: User
  ): Promise<void> {
    // Reactions are additive, so we don't need to decrement counters
    // The relationship still exists even if reaction is removed
  }

  private async handleGuildMemberAdd(member: GuildMember): Promise<void> {
    try {
      const guildId = member.guild.id;
      const userId = member.user.id;

      // Fetch last known roles from DB
      const rolesResult = await this.db.query(
        `SELECT roles FROM members
         WHERE guild_id = $1 AND user_id = $2
         ORDER BY updated_at DESC
         LIMIT 1`,
        [guildId, userId]
      );

      const roles: string[] =
        rolesResult.success && rolesResult.data && rolesResult.data.length > 0
          ? rolesResult.data[0].roles || []
          : [];

      if (roles.length > 0) {
        const me = member.guild.members.me;
        const assignableIds = roles.filter((roleId: string) => {
          const role: Role | undefined = member.guild.roles.cache.get(roleId);
          if (!role) return false;
          if (role.managed) return false;
          if (!me) return false;
          return me.roles.highest.position > role.position;
        });

        if (assignableIds.length > 0) {
          await member.roles.add(
            assignableIds,
            "Reapplying previous roles on rejoin"
          );
        }
      }

      // Upsert member as active with current state
      await this.db.upsertMember({
        id: `${guildId}_${userId}`,
        guild_id: guildId,
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
        communication_disabled_until:
          member.communicationDisabledUntil || undefined,
        pending: member.pending || undefined,
        premium_since: member.premiumSince || undefined,
        timeout: undefined,
        active: true,
        created_at: member.user.createdAt || new Date(),
        updated_at: new Date(),
      });
    } catch {
      // Quiet
    }
  }

  private async handleGuildMemberRemove(member: GuildMember): Promise<void> {
    try {
      const guildId = member.guild.id;
      const userId = member.user.id;
      await this.db.query(
        `UPDATE members SET active = false, updated_at = NOW()
         WHERE guild_id = $1 AND user_id = $2`,
        [guildId, userId]
      );
    } catch {
      // Quiet
    }
  }

  /**
   * Get recent messages in channel for proximity detection
   */
  private async getRecentChannelMessages(
    guildId: string,
    channelId: string,
    limit: number
  ): Promise<Array<{ author_id: string; created_at: Date; id: string }>> {
    const result = await this.db.query(
      `SELECT author_id, created_at, id FROM messages 
       WHERE guild_id = $1 AND channel_id = $2 AND active = true 
       ORDER BY created_at DESC LIMIT $3`,
      [guildId, channelId, limit]
    );

    if (result.success && result.data) {
      return result.data.map((row: any) => ({
        author_id: row.author_id,
        created_at: new Date(row.created_at),
        id: row.id,
      }));
    }

    return [];
  }

  /**
   * Queue a user for relationship network rollup with adaptive batching
   */
  private queueRollup(userId: string, guildId: string): void {
    const key = `${guildId}:${userId}`;
    this.rollupQueue.set(key, (this.rollupQueue.get(key) ?? 0) + 1);

    // Early trigger if we've accumulated many users or enough time passed
    const now = Date.now();
    const timeSinceLastRollup = now - this.lastRollupTime;

    if (
      this.rollupQueue.size >= this.ROLLUP_SIZE_THRESHOLD ||
      timeSinceLastRollup > this.ROLLUP_TIME_THRESHOLD
    ) {
      this.processRollupQueue().catch((err) =>
        console.error("🔸 Error processing rollup queue:", err)
      );
    }
  }

  /**
   * Start periodic rollup timer (fallback: every 30 seconds)
   */
  private startRollupTimer(): void {
    this.rollupTimer = setInterval(async () => {
      await this.processRollupQueue();
    }, this.ROLLUP_TIME_THRESHOLD);
  }

  /**
   * Process queued rollups (adaptive batching)
   */
  private async processRollupQueue(): Promise<void> {
    if (this.rollupQueue.size === 0) return;

    const entries = Array.from(this.rollupQueue.entries());
    this.rollupQueue.clear();
    this.lastRollupTime = Date.now();

    // Process all queued users concurrently (up to 10 at a time)
    const batchSize = 10;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async ([key]) => {
          const [guildId, userId] = key.split(":");
          if (!guildId || !userId) return;

          try {
            await this.relationshipManager.rollupEdgesToMemberNetwork(
              userId,
              guildId
            );
          } catch (err) {
            console.error(`🔸 Failed to rollup for ${key}:`, err);
            // Re-queue on failure for retry on next cycle
            this.queueRollup(userId, guildId);
          }
        })
      );
    }
  }

  /**
   * Stop watching (cleanup)
   */
  async stop(): Promise<void> {
    if (this.rollupTimer) {
      clearInterval(this.rollupTimer);
    }
    await this.conversationManager.finalizeAllSegments();
    await this.processRollupQueue();
    console.log("🔹 LiveSyncWatcher stopped");
  }
}
