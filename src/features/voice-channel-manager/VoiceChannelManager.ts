import {
  ChannelType,
  type Client,
  type Guild,
  type GuildMember,
  VoiceChannel,
} from "discord.js";
import type {
  PostgreSQLManager,
  DatabaseResult,
} from "../../database/PostgreSQLManager.js";
import type { VoiceSessionTracker } from "../voice-session-tracker/VoiceSessionTracker.js";

export class VoiceChannelManager {
  private static processWideLock = false; // Process-wide lock shared across ALL instances
  private client: Client;
  protected db: PostgreSQLManager;
  private spawnChannelId: string;
  private pendingSpawnJoins = new Set<string>();
  private globalLock = false;

  constructor(
    client: Client,
    db: PostgreSQLManager,
    spawnChannelId: string,
    voiceSessionTracker?: VoiceSessionTracker
  ) {
    this.client = client;
    this.db = db;
    this.spawnChannelId = spawnChannelId;
  }

  async initialize(): Promise<void> {
    console.log("🔹 Initializing Voice Channel Manager...");
    console.log(`🔹 Spawn channel ID: ${this.spawnChannelId}`);

    // Remove any existing handlers first to prevent duplicates from hot-reload
    this.client.removeAllListeners("voiceStateUpdate");

    this.client.on("voiceStateUpdate", async (oldState, newState) => {
      const guild = newState.guild;
      const user = newState.member?.user;

      if (!user) return;

      console.log(
        `🔹 [VOICE_STATE] ${user.username}: ${
          oldState.channelId || "none"
        } -> ${newState.channelId || "none"}`
      );

      // User joined spawn channel - create their channel
      if (newState.channelId === this.spawnChannelId) {
        console.log(`🔹 [VOICE_STATE] ${user.username} joined spawn channel!`);

        // ULTRA-FIRST: Check process-wide lock - prevent ANY channel creation across ALL instances
        if (VoiceChannelManager.processWideLock) {
          console.log(
            `🔹 [PROCESS_LOCK] Channel creation locked process-wide, skipping ${user.username}`
          );
          return;
        }

        // FIRST: Set process-wide lock IMMEDIATELY
        VoiceChannelManager.processWideLock = true;
        console.log(
          "🔹 [PROCESS_LOCK_SET] Process-wide channel creation locked"
        );

        // SECOND: Check user-specific duplicate prevention
        const key = `${user.id}:${guild.id}`;
        if (this.pendingSpawnJoins.has(key)) {
          console.log(
            `🔹 [DUPLICATE] User ${user.username} already processing, skipping`
          );
          this.globalLock = false;
          return;
        }

        this.pendingSpawnJoins.add(key);

        try {
          if (newState.member) {
            await this.createUserChannel(newState.member, guild);
          }
        } catch (error) {
          console.error(
            `🔸 Error creating channel for ${user.username}:`,
            error
          );
        } finally {
          setTimeout(() => {
            this.pendingSpawnJoins.delete(key);
            VoiceChannelManager.processWideLock = false;
            console.log(
              "🔹 [PROCESS_LOCK_RELEASE] Process-wide channel creation unlocked"
            );
          }, 2000);
        }
        return;
      }

      // User left a voice channel - check if it's empty and should be deleted
      if (oldState.channelId && oldState.channelId !== this.spawnChannelId) {
        const oldChannel = oldState.channel;
        if (oldChannel?.isVoiceBased()) {
          // Check if this is a user channel by name pattern
          if (oldChannel.name.includes("'s Channel")) {
            const memberCount = oldChannel.members.size;
            console.log(
              `🔹 [VOICE_STATE] User ${user.username} left user channel ${oldChannel.name}, ${memberCount} members remaining`
            );

            if (memberCount === 0) {
              console.log(
                `🔹 [VOICE_STATE] Channel ${oldChannel.name} is empty, deleting...`
              );
              try {
                await oldChannel.delete();
                console.log(
                  `🔹 [VOICE_STATE] Deleted empty channel ${oldChannel.name}`
                );
              } catch (error) {
                console.error(
                  `🔸 Failed to delete channel ${oldChannel.name}:`,
                  error
                );
              }
            }
          }
        }
      }
    });

    console.log("🔹 Voice Channel Manager initialized");
  }

  private async createUserChannel(
    user: GuildMember,
    guild: Guild
  ): Promise<void> {
    console.log(`🔹 Creating channel for user: ${user.displayName}`);

    // Clean up any existing channels with user's name pattern
    const existingChannels = guild.channels.cache.filter(
      (channel) =>
        channel.isVoiceBased() &&
        channel.name === `${user.displayName}'s Channel`
    );

    if (existingChannels.size > 0) {
      console.log(
        `🔹 Found ${existingChannels.size} existing channels for ${user.displayName}, deleting them...`
      );
      for (const channel of existingChannels.values()) {
        try {
          await channel.delete();
          console.log(`🔹 Deleted existing channel ${channel.name}`);
        } catch (error) {
          console.error("🔸 Failed to delete existing channel:", error);
        }
      }
    }

    // Get spawn channel for positioning
    const spawnChannel = guild.channels.cache.get(this.spawnChannelId);
    if (!spawnChannel?.isVoiceBased()) {
      throw new Error("Spawn channel not found or not voice channel");
    }

    // Create new channel
    const channelName = `${user.displayName}'s Channel`;
    console.log(`🔹 Creating voice channel '${channelName}'`);

    const newChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: spawnChannel.parent,
      position: spawnChannel.position,
    });

    // Position the new channel above the spawn channel
    await newChannel.setPosition(spawnChannel.position - 1);

    // Move user into their new channel
    await user.voice.setChannel(newChannel.id);

    // Mark channel as user channel and set owner
    await this.db.query(
      `UPDATE channels SET is_user_channel = true, current_owner_id = $1 WHERE id = $2`,
      [user.id, newChannel.id]
    );

    // Record ownership
    await this.db.query(
      `INSERT INTO voice_channel_ownership (guild_id, channel_id, user_id) VALUES ($1, $2, $3)`,
      [guild.id, newChannel.id, user.id]
    );

    console.log(`🔹 Created channel '${channelName}' (ID: ${newChannel.id})`);
  }

  // User preferences methods
  async loadUserPreferences(
    userId: string,
    guildId: string
  ): Promise<DatabaseResult<Record<string, unknown>>> {
    const result = await this.db.query(
      `SELECT * FROM voice_channel_preferences WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId]
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const data = (result.data?.[0] as Record<string, unknown>) || {};
    return { success: true, data };
  }

  async updateUserPreferences(
    userId: string,
    guildId: string,
    preferences: Record<string, unknown>
  ): Promise<DatabaseResult<void>> {
    const result = await this.db.query(
      `INSERT INTO voice_channel_preferences (
				guild_id, user_id, channel_name, default_user_limit, privacy_mode,
				banned_users, muted_users, deafened_users, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
			ON CONFLICT (guild_id, user_id) DO UPDATE SET
				channel_name = EXCLUDED.channel_name,
				default_user_limit = EXCLUDED.default_user_limit,
				privacy_mode = EXCLUDED.privacy_mode,
				banned_users = EXCLUDED.banned_users,
				muted_users = EXCLUDED.muted_users,
				deafened_users = EXCLUDED.deafened_users,
				updated_at = NOW()`,
      [
        guildId,
        userId,
        preferences.channel_name || null,
        preferences.default_user_limit || null,
        preferences.privacy_mode || "public",
        preferences.banned_users || [],
        preferences.muted_users || [],
        preferences.deafened_users || [],
      ]
    );

    return result.success
      ? { success: true }
      : { success: false, error: result.error };
  }

  // Moderation methods
  async applyMute(
    channelId: string,
    userId: string
  ): Promise<DatabaseResult<void>> {
    const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
    if (!channel) {
      return { success: false, error: "Channel not found" };
    }

    const member = channel.members.get(userId);
    if (member) {
      await member.voice.setMute(true);
    }

    return { success: true };
  }

  async removeMute(
    channelId: string,
    userId: string
  ): Promise<DatabaseResult<void>> {
    const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
    if (!channel) {
      return { success: false, error: "Channel not found" };
    }

    const member = channel.members.get(userId);
    if (member) {
      await member.voice.setMute(false);
    }

    return { success: true };
  }

  async applyDeafen(
    channelId: string,
    userId: string
  ): Promise<DatabaseResult<void>> {
    const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
    if (!channel) {
      return { success: false, error: "Channel not found" };
    }

    const member = channel.members.get(userId);
    if (member) {
      await member.voice.setDeaf(true);
    }

    return { success: true };
  }

  async removeDeafen(
    channelId: string,
    userId: string
  ): Promise<DatabaseResult<void>> {
    const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
    if (!channel) {
      return { success: false, error: "Channel not found" };
    }

    const member = channel.members.get(userId);
    if (member) {
      await member.voice.setDeaf(false);
    }

    return { success: true };
  }

  // Ownership methods
  async canUserClaim(
    userId: string,
    channelId: string
  ): Promise<DatabaseResult<boolean>> {
    const result = await this.db.query(
      `SELECT COUNT(*) as count FROM voice_channel_ownership
			WHERE channel_id = $1 AND user_id = $2 AND relinquished_at IS NULL`,
      [channelId, userId]
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const row = result.data?.[0] as { count: string | number } | undefined;
    const count =
      typeof row?.count === "string"
        ? parseInt(row.count, 10)
        : row?.count || 0;
    return { success: true, data: count > 0 };
  }

  async reclaimChannel(
    userId: string,
    channelId: string
  ): Promise<DatabaseResult<void>> {
    // Update channel ownership
    const updateResult = await this.db.query(
      `UPDATE channels SET current_owner_id = $1 WHERE id = $2`,
      [userId, channelId]
    );

    if (!updateResult.success) {
      return { success: false, error: updateResult.error };
    }

    // Record new ownership
    const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
    if (channel) {
      const insertResult = await this.db.query(
        `INSERT INTO voice_channel_ownership (guild_id, channel_id, user_id) VALUES ($1, $2, $3)`,
        [channel.guild.id, channelId, userId]
      );

      if (!insertResult.success) {
        return { success: false, error: insertResult.error };
      }
    }

    return { success: true };
  }

  async determineNextOwner(
    channelId: string
  ): Promise<DatabaseResult<string | null>> {
    const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
    if (!channel) {
      return { success: false, error: "Channel not found" };
    }

    // Get current owner
    const ownerResult = await this.db.query(
      `SELECT current_owner_id FROM channels WHERE id = $1`,
      [channelId]
    );

    if (!ownerResult.success || !ownerResult.data?.[0]?.current_owner_id) {
      return { success: true, data: null };
    }

    const currentOwnerId = ownerResult.data[0].current_owner_id as string;

    // Find longest resident (excluding current owner)
    const members = Array.from(channel.members.values()).filter(
      (m) => m.id !== currentOwnerId
    );

    if (members.length === 0) {
      return { success: true, data: null };
    }

    // Get join times from voice states
    const joinTimes = await Promise.all(
      members.map(async (member) => {
        const stateResult = await this.db.query(
          `SELECT joined_at FROM voice_states WHERE guild_id = $1 AND user_id = $2 AND channel_id = $3`,
          [channel.guild.id, member.id, channelId]
        );

        const joinedAt = stateResult.data?.[0]?.joined_at
          ? new Date(stateResult.data[0].joined_at as string)
          : new Date();

        return { member, joinedAt };
      })
    );

    // Sort by join time (oldest first)
    joinTimes.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

    return { success: true, data: joinTimes[0]?.member.id || null };
  }

  // Helper method to check channel ownership
  async getChannelOwner(
    channelId: string
  ): Promise<DatabaseResult<string | null>> {
    const result = await this.db.query(
      `SELECT current_owner_id FROM channels WHERE id = $1 AND is_user_channel = true`,
      [channelId]
    );

    if (!result.success || !result.data?.[0]) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: (result.data[0].current_owner_id as string) || null,
    };
  }

  async transferOwnership(
    channelId: string,
    newOwnerId: string
  ): Promise<DatabaseResult<void>> {
    // Update channel ownership
    const updateResult = await this.db.query(
      `UPDATE channels SET current_owner_id = $1 WHERE id = $2`,
      [newOwnerId, channelId]
    );

    if (!updateResult.success) {
      return { success: false, error: updateResult.error };
    }

    // Record new ownership
    const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
    if (channel) {
      const insertResult = await this.db.query(
        `INSERT INTO voice_channel_ownership (guild_id, channel_id, user_id) VALUES ($1, $2, $3)`,
        [channel.guild.id, channelId, newOwnerId]
      );

      if (!insertResult.success) {
        return { success: false, error: insertResult.error };
      }
    }

    return { success: true };
  }
}
