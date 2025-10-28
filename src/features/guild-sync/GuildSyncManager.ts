import {
  Client,
  GatewayIntentBits,
  Guild,
  Channel,
  Role,
  GuildMember,
  Message,
} from "discord.js";
import {
  PostgreSQLManager,
  GuildData,
  ChannelData,
  RoleData,
  MemberData,
  MessageData,
} from "../database/PostgreSQLManager.js";
import { config } from "../../config/index.js";

export class GuildSyncManager {
  private client: Client;
  private db: PostgreSQLManager;
  private guildId: string;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
    });

    this.db = new PostgreSQLManager();
    this.guildId = config.guildId || "";
  }

  async start(): Promise<void> {
    console.log("🔹 Starting Guild Sync Manager for PostgreSQL...");
    console.log(`🔹 Target Guild ID: ${this.guildId}`);

    try {
      // Connect to Discord
      console.log("🔹 Connecting to Discord...");
      await this.client.login(config.botToken);
      console.log("✅ Connected to Discord");

      // Connect to PostgreSQL
      console.log("🔹 Connecting to PostgreSQL...");
      const connected = await this.db.connect();
      if (!connected) {
        throw new Error("Failed to connect to PostgreSQL");
      }
      console.log("✅ Connected to PostgreSQL");

      // Wait for client to be ready
      await new Promise<void>((resolve) => {
        if (this.client.readyAt) {
          // Client is already ready
          console.log(`✅ Bot ready! Logged in as ${this.client.user?.tag}`);
          resolve();
        } else {
          // Wait for ready event
          this.client.once("ready", () => {
            console.log(`✅ Bot ready! Logged in as ${this.client.user?.tag}`);
            resolve();
          });
        }
      });

      // Fetch the guild explicitly
      console.log(`🔹 Fetching guild ${this.guildId}...`);
      let guild: Guild;
      try {
        guild = await this.client.guilds.fetch(this.guildId);
      } catch (error) {
        throw new Error(`Failed to fetch guild ${this.guildId}: ${error}`);
      }

      if (!guild) {
        throw new Error(`Guild ${this.guildId} not found!`);
      }

      console.log(
        `✅ Found guild: ${guild.name} (${guild.memberCount} members)`
      );

      // Perform full guild sync
      await this.performFullGuildSync(guild);
    } catch (error) {
      console.error("🔸 Error:", error);
    } finally {
      await this.cleanup();
    }
  }

  private async performFullGuildSync(guild: Guild): Promise<void> {
    console.log(`🔹 Starting full sync for guild: ${guild.name}`);

    // Sync guild data
    await this.syncGuild(guild);

    // Sync channels
    console.log("🔹 Syncing channels...");
    let channelCount = 0;
    for (const [channelId, channel] of guild.channels.cache) {
      await this.syncChannel(channel, guild.id);
      channelCount++;
    }
    console.log(`✅ Synced ${channelCount} channels`);

    // Sync roles
    console.log("🔹 Syncing roles...");
    let roleCount = 0;
    for (const [roleId, role] of guild.roles.cache) {
      await this.syncRole(role, guild.id);
      roleCount++;
    }
    console.log(`✅ Synced ${roleCount} roles`);

    // Sync members
    console.log("🔹 Syncing members...");
    await this.syncMembers(guild);

    // Sync messages from text channels
    console.log("🔹 Syncing messages...");
    await this.syncMessages(guild);

    console.log("✅ Full guild sync completed");
  }

  private async syncGuild(guild: Guild): Promise<void> {
    console.log(`🔹 Syncing guild: ${guild.name}`);

    const guildData: GuildData = {
      id: guild.id,
      name: guild.name,
      description: guild.description || undefined,
      icon: guild.iconURL() || undefined,
      owner_id: guild.ownerId || "",
      created_at: guild.createdAt,
      member_count: guild.memberCount || 0,
      active: true,
    };

    const result = await this.db.upsertGuild(guildData);
    if (result.success) {
      console.log(`✅ Synced guild: ${guild.name}`);
    } else {
      console.error(`🔸 Failed to sync guild: ${result.error}`);
      throw new Error(`Failed to sync guild: ${result.error}`);
    }
  }

  private async syncChannel(channel: Channel, guildId: string): Promise<void> {
    if (!channel.isTextBased() && !channel.isVoiceBased()) return;

    const channelData: ChannelData = {
      id: channel.id,
      guild_id: guildId,
      name: "name" in channel ? channel.name || "" : "",
      type: channel.type,
      position:
        "position" in channel ? channel.position || undefined : undefined,
      topic: "topic" in channel ? channel.topic || undefined : undefined,
      nsfw: "nsfw" in channel ? channel.nsfw : undefined,
      parent_id:
        "parent" in channel && channel.parent ? channel.parent.id : undefined,
      active: true,
    };

    const result = await this.db.upsertChannel(channelData);
    if (!result.success) {
      console.error(
        `🔸 Failed to sync channel ${
          "name" in channel ? channel.name : channel.id
        }: ${result.error}`
      );
    }
  }

  private async syncRole(role: Role, guildId: string): Promise<void> {
    const roleData: RoleData = {
      id: role.id,
      guild_id: guildId,
      name: role.name,
      color: role.color,
      position: role.position,
      permissions: role.permissions.bitfield.toString(),
      mentionable: role.mentionable,
      hoist: role.hoist,
      active: true,
    };

    const result = await this.db.upsertRole(roleData);
    if (!result.success) {
      console.error(`🔸 Failed to sync role ${role.name}: ${result.error}`);
    }
  }

  private async syncMembers(guild: Guild): Promise<void> {
    console.log("🔹 Fetching guild members...");

    try {
      // Fetch all members
      await guild.members.fetch();
      console.log(`🔹 Found ${guild.members.cache.size} members`);

      let memberCount = 0;
      let errorCount = 0;

      for (const [memberId, member] of guild.members.cache) {
        try {
          await this.syncMember(member, guild.id);
          memberCount++;

          // Progress indicator every 50 members
          if (memberCount % 50 === 0) {
            console.log(
              `🔹 Synced ${memberCount}/${guild.members.cache.size} members...`
            );
          }
        } catch (error) {
          errorCount++;
          console.error(
            `🔸 Failed to sync member ${member.user.tag}: ${error}`
          );
        }
      }

      console.log(`✅ Synced ${memberCount} members (${errorCount} errors)`);
    } catch (error) {
      console.error("🔸 Failed to fetch members:", error);
      throw error;
    }
  }

  private async syncMember(
    member: GuildMember,
    guildId: string
  ): Promise<void> {
    // Ensure we have the full member data
    if (member.partial) {
      await member.fetch();
    }

    // Also fetch the user data directly to get accurate profile information
    let user = member.user;
    try {
      user = await this.client.users.fetch(member.id);
    } catch (error) {
      console.warn(
        `🔸 Could not fetch user ${member.id} directly, using member data: ${error}`
      );
    }

    // Check if we got fallback data and try Discord REST API as fallback
    if (this.isFallbackUserData(user)) {
      console.log(
        `🔸 User ${member.id} has fallback data, trying Discord REST API...`
      );
      try {
        const restUser = await this.fetchUserFromRestAPI(member.id);
        if (restUser) {
          user = restUser;
          console.log(`✅ Got real user data from REST API for ${member.id}`);
        }
      } catch (error) {
        console.warn(
          `🔸 Discord REST API fallback failed for ${member.id}: ${error}`
        );
      }
    }

    // Extract presence data if available
    let status: string | undefined;
    let activities: string | undefined;
    let clientStatus: string | undefined;

    if (member.presence) {
      status = member.presence.status;
      activities = member.presence.activities
        ? JSON.stringify(member.presence.activities)
        : undefined;
      clientStatus = member.presence.clientStatus
        ? JSON.stringify(member.presence.clientStatus)
        : undefined;
    }

    const memberData: MemberData = {
      // Primary identifiers
      id: `${guildId}-${member.id}`, // Composite key
      guild_id: guildId,
      user_id: member.id,

      // User profile data (from fetched user data for accuracy)
      username: user.username,
      display_name: member.displayName || user.globalName || user.username,
      global_name: user.globalName || undefined,
      avatar: user.avatar || undefined,
      avatar_decoration: user.avatarDecoration || undefined,
      banner: user.banner || undefined,
      accent_color: user.accentColor || undefined,
      discriminator: user.discriminator,
      bio: undefined, // user.bio is not available in Discord.js
      flags: undefined, // user.flags is not available in Discord.js
      premium_type: undefined, // user.premiumType is not available in Discord.js
      public_flags: undefined, // user.publicFlags is not available in Discord.js
      bot: user.bot,
      system: user.system || undefined,

      // Guild-specific member data
      nick: member.nickname || undefined,
      joined_at: member.joinedAt || new Date(),
      roles: member.roles.cache.map((role) => role.id),
      permissions: member.permissions.bitfield.toString(),
      communication_disabled_until:
        member.communicationDisabledUntil || undefined,
      pending: member.pending || undefined,
      premium_since: member.premiumSince || undefined,
      timeout: undefined, // This property doesn't exist on GuildMember

      // Activity and presence
      status,
      activities,
      client_status: clientStatus,

      // Metadata
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const result = await this.db.upsertMember(memberData);
    if (!result.success) {
      console.error(
        `🔸 Failed to sync member ${member.user.tag}: ${result.error}`
      );
      throw new Error(`Failed to sync member: ${result.error}`);
    }
  }

  private async syncMessages(guild: Guild): Promise<void> {
    const textChannels = guild.channels.cache.filter(
      (channel) => channel.type === 0 && channel.isTextBased()
    );

    console.log(`🔹 Found ${textChannels.size} text channels`);

    let totalMessages = 0;
    let processedChannels = 0;
    const maxMessagesPerChannel = 1000; // Limit to prevent hanging
    const batchSize = 50; // Smaller batches for better progress reporting

    for (const [channelId, channel] of textChannels) {
      if (!channel.isTextBased()) continue;

      console.log(`🔹 Syncing messages from channel: ${channel.name}`);

      try {
        let lastMessageId: string | undefined;
        let channelMessageCount = 0;
        let batchCount = 0;

        while (channelMessageCount < maxMessagesPerChannel) {
          // Add timeout to prevent hanging
          const fetchPromise = channel.messages.fetch({
            limit: batchSize,
            before: lastMessageId,
          });

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Message fetch timeout")), 30000); // 30 second timeout
          });

          const messages = await Promise.race([fetchPromise, timeoutPromise]);

          if (messages.size === 0) break;

          for (const [messageId, message] of messages) {
            await this.syncMessage(message, guild.id);
            channelMessageCount++;
            totalMessages++;
          }

          // Fix: Set lastMessageId to the last message in the batch
          lastMessageId = messages.last()?.id;
          batchCount++;

          // Progress reporting every 5 batches
          if (batchCount % 5 === 0) {
            console.log(
              `🔹 Processed ${channelMessageCount} messages from ${channel.name}...`
            );
          }

          // Small delay to prevent rate limiting
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        console.log(
          `✅ Synced ${channelMessageCount} messages from ${channel.name}`
        );
        processedChannels++;
      } catch (error) {
        console.error(
          `🔸 Failed to sync messages from ${channel.name}:`,
          error
        );
        processedChannels++; // Still count as processed to continue
      }
    }

    console.log(
      `✅ Synced ${totalMessages} messages from ${processedChannels} channels`
    );
  }

  private async syncMessage(message: Message, guildId: string): Promise<void> {
    if (message.system) return; // Skip system messages

    const messageData: MessageData = {
      id: message.id,
      guild_id: guildId,
      channel_id: message.channelId,
      author_id: message.author.id,
      content: message.content,
      created_at: message.createdAt,
      edited_at: message.editedAt || undefined,
      attachments:
        message.attachments.size > 0
          ? message.attachments.map((att) => att.url)
          : undefined,
      embeds:
        message.embeds.length > 0
          ? message.embeds.map((embed) => JSON.stringify(embed))
          : undefined,
      active: true,
    };

    const result = await this.db.upsertMessage(messageData);
    if (!result.success) {
      console.error(`🔸 Failed to sync message ${message.id}: ${result.error}`);
    }
  }

  /**
   * Check if user data appears to be Discord fallback data
   */
  private isFallbackUserData(user: any): boolean {
    // Check for common Discord fallback patterns
    const username = user.username || "";
    const discriminator = user.discriminator || "";

    // Pattern 1: username starts with "user_" followed by user ID
    if (username.startsWith("user_") && username.length > 20) {
      return true;
    }

    // Pattern 2: discriminator is "0000" (common fallback)
    if (discriminator === "0000") {
      return true;
    }

    // Pattern 3: username matches user ID pattern
    if (username.match(/^\d{17,19}$/)) {
      return true;
    }

    return false;
  }

  /**
   * Fetch user data directly from Discord REST API
   */
  private async fetchUserFromRestAPI(userId: string): Promise<any> {
    try {
      const response = await fetch(
        `https://discord.com/api/v10/users/${userId}`,
        {
          headers: {
            Authorization: `Bot ${config.botToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const userData = await response.json();

        // Convert REST API response to Discord.js User-like object
        return {
          id: userData.id,
          username: userData.username,
          globalName: userData.global_name,
          discriminator: userData.discriminator,
          avatar: userData.avatar,
          bot: userData.bot || false,
          system: userData.system || false,
          createdAt: new Date(userData.created_at),
          // Add other properties that might be needed
          displayName: userData.global_name || userData.username,
        };
      } else {
        console.warn(
          `🔸 Discord REST API returned ${response.status} for user ${userId}`
        );
        return null;
      }
    } catch (error) {
      console.warn(
        `🔸 Discord REST API request failed for user ${userId}: ${error}`
      );
      return null;
    }
  }

  private async cleanup(): Promise<void> {
    try {
      await this.db.disconnect();
      await this.client.destroy();
      console.log("🔹 Cleanup completed");
    } catch (error) {
      console.error("🔸 Error during cleanup:", error);
    }
  }

  // Public method to get guild statistics
  async getGuildStats(): Promise<void> {
    if (!this.guildId) {
      console.error("🔸 No guild ID configured");
      return;
    }

    const result = await this.db.getGuildStats(this.guildId);
    if (result.success && result.data) {
      console.log("🔹 Guild Statistics:");
      console.log(`  Guild Name: ${result.data.guild_name}`);
      console.log(`  Member Count: ${result.data.member_count}`);
      console.log(`  Channel Count: ${result.data.channel_count}`);
      console.log(`  Role Count: ${result.data.role_count}`);
      console.log(`  Member Count (DB): ${result.data.member_count_db}`);
      console.log(`  Message Count: ${result.data.message_count}`);
    } else {
      console.error("🔸 Failed to get guild stats:", result.error);
    }
  }
}
