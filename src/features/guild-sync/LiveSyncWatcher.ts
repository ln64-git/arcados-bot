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
  private rollupQueue: Set<string> = new Set();
  private rollupTimer?: NodeJS.Timeout;

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
   * Handle new message
   */
  private async handleMessageCreate(message: Message): Promise<void> {
    // Debug logging

    if (!message.guildId) {
      console.log(`   ⏭️ Skipping: no guildId`);
      return;
    }

    const guildId = message.guildId;
    const authorId = message.author.id;
    const timestamp = message.createdAt;
    const isBot = message.author.bot;

    try {
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

    if (message.reference?.messageId) {
      try {
        const referencedMessage = await message.channel.messages.fetch(
          message.reference.messageId
        );
        const repliedToId = referencedMessage.author.id;

        if (repliedToId !== authorId) {
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
   * Queue a user for relationship network rollup
   */
  private queueRollup(userId: string, guildId: string): void {
    const key = `${guildId}:${userId}`;
    this.rollupQueue.add(key);
  }

  /**
   * Start periodic rollup timer (every 2 minutes)
   */
  private startRollupTimer(): void {
    this.rollupTimer = setInterval(async () => {
      await this.processRollupQueue();
    }, 2 * 60 * 1000);
  }

  /**
   * Process queued rollups
   */
  private async processRollupQueue(): Promise<void> {
    if (this.rollupQueue.size === 0) return;

    const keys = Array.from(this.rollupQueue);
    this.rollupQueue.clear();

    for (const key of keys) {
      const [guildId, userId] = key.split(":");
      if (!guildId || !userId) continue;
      try {
        await this.relationshipManager.rollupEdgesToMemberNetwork(
          userId,
          guildId
        );
      } catch (err) {
        console.error(`🔸 Failed to rollup for ${key}:`, err);
      }
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
