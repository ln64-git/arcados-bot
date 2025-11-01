import { Pool, PoolClient, QueryResult } from "pg";
import { config } from "../../config/index.js";
import type { ConversationEntry } from "../relationship-network/types";

export interface DatabaseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface GuildData {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  owner_id: string;
  created_at: Date;
  member_count: number;
  active: boolean;
}

export interface ChannelData {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  position?: number;
  topic?: string;
  nsfw?: boolean;
  parent_id?: string;
  active: boolean;
}

export interface MemberData {
  // Primary identifiers
  id: string; // Composite key: guild_id-user_id
  guild_id: string;
  user_id: string;

  // User profile data (from member.user)
  username: string;
  display_name: string; // member.displayName
  global_name?: string; // member.user.globalName
  avatar?: string; // member.user.avatar
  avatar_decoration?: string; // member.user.avatarDecoration
  banner?: string; // member.user.banner
  accent_color?: number; // member.user.accentColor
  discriminator: string; // member.user.discriminator
  bio?: string; // member.user.bio
  flags?: number; // member.user.flags
  premium_type?: number; // member.user.premiumType
  public_flags?: number; // member.user.publicFlags
  bot: boolean; // member.user.bot
  system?: boolean; // member.user.system

  // Guild-specific member data
  nick?: string; // member.nickname
  joined_at: Date; // member.joinedAt
  roles: string[]; // member.roles.cache.map(role => role.id)
  permissions: string; // member.permissions.bitfield.toString()
  communication_disabled_until?: Date; // member.communicationDisabledUntil
  pending?: boolean; // member.pending
  premium_since?: Date; // member.premiumSince
  timeout?: Date; // member.timeout

  // Activity and presence (if available)
  status?: string; // member.presence?.status
  activities?: string; // JSON string of activities
  client_status?: string; // JSON string of client status

  //  Relationship metadata
  summary?: string;
  keywords?: string[];
  emojis?: string[];
  notes?: string[];
  relationship_network?: RelationshipEntry[];

  // Metadata
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RelationshipEntry {
  user_id: string;
  affinity_percentage: number; // 0-100, percentage of user's total interactions
  interaction_count: number;
  last_interaction: Date;
  summary?: string;
  keywords?: string[];
  emojis?: string[];
  notes?: string[];
  conversations?: ConversationEntry[];
  // Additional fields for display and analysis
  display_name?: string;
  username?: string;
  raw_points?: number;
  total_messages?: number;
}

export interface RoleData {
  id: string;
  guild_id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
  mentionable: boolean;
  hoist: boolean;
  active: boolean;
}

export interface MessageData {
  id: string;
  guild_id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: Date;
  edited_at?: Date;
  attachments?: string[];
  embeds?: string[];
  referenced_message_id?: string;
  active: boolean;
}

export class PostgreSQLManager {
  private pool: Pool | null = null;
  private isConnectedFlag = false;

  constructor() {
    if (!config.postgresUrl) {
      console.warn(
        "🔸 PostgreSQL URL not configured. Database features will be unavailable."
      );
    }
  }

  async connect(): Promise<boolean> {
    if (!config.postgresUrl) {
      console.log("🔸 PostgreSQL URL not configured");
      return false;
    }

    try {
      this.pool = new Pool({
        connectionString: config.postgresUrl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // Increased from 2s to 10s
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      });

      // Test the connection
      const client = await this.pool.connect();
      await client.query("SELECT 1");
      client.release();

      this.isConnectedFlag = true;

      // Initialize schema
      await this.initializeSchema();

      return true;
    } catch (error) {
      console.error("🔸 Failed to connect to PostgreSQL:", error);
      this.isConnectedFlag = false;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnectedFlag = false;
      console.log("🔹 Disconnected from PostgreSQL");
    }
  }

  isConnected(): boolean {
    return this.isConnectedFlag && this.pool !== null;
  }

  private async initializeSchema(): Promise<void> {
    if (!this.isConnected()) return;

    const client = await this.pool!.connect();
    try {
      // Create tables if they don't exist
      await client.query(`
				CREATE TABLE IF NOT EXISTS guilds (
					id VARCHAR(20) PRIMARY KEY,
					name VARCHAR(100) NOT NULL,
					description TEXT,
					icon VARCHAR(100),
					owner_id VARCHAR(20) NOT NULL,
					created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					member_count INTEGER DEFAULT 0,
					active BOOLEAN DEFAULT true,
					updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
				)
			`);

      await client.query(`
				CREATE TABLE IF NOT EXISTS channels (
					id VARCHAR(20) PRIMARY KEY,
					guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
					name VARCHAR(100) NOT NULL,
					type INTEGER NOT NULL,
					position INTEGER,
					topic TEXT,
					nsfw BOOLEAN DEFAULT false,
					parent_id VARCHAR(20),
					active BOOLEAN DEFAULT true,
					created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
				)
			`);

      await client.query(`
				CREATE TABLE IF NOT EXISTS roles (
					id VARCHAR(20) PRIMARY KEY,
					guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
					name VARCHAR(100) NOT NULL,
					color INTEGER DEFAULT 0,
					position INTEGER DEFAULT 0,
					permissions VARCHAR(20) DEFAULT '0',
					mentionable BOOLEAN DEFAULT false,
					hoist BOOLEAN DEFAULT false,
					active BOOLEAN DEFAULT true,
					created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
				)
			`);

      await client.query(`
				CREATE TABLE IF NOT EXISTS members (
					id VARCHAR(50) PRIMARY KEY,
					guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
					user_id VARCHAR(20) NOT NULL,
					
					-- User profile data
					username VARCHAR(100) NOT NULL,
					display_name VARCHAR(100) NOT NULL,
					global_name VARCHAR(100),
					avatar VARCHAR(100),
					avatar_decoration VARCHAR(100),
					banner VARCHAR(100),
					accent_color INTEGER,
					discriminator VARCHAR(10) NOT NULL,
					bio TEXT,
					flags INTEGER,
					premium_type INTEGER,
					public_flags INTEGER,
					bot BOOLEAN DEFAULT false,
					system BOOLEAN DEFAULT false,
					
					-- Guild-specific member data
					nick VARCHAR(100),
					joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					roles TEXT[] DEFAULT '{}',
					permissions VARCHAR(20) DEFAULT '0',
					communication_disabled_until TIMESTAMP WITH TIME ZONE,
					pending BOOLEAN DEFAULT false,
					premium_since TIMESTAMP WITH TIME ZONE,
					timeout TIMESTAMP WITH TIME ZONE,
					
					-- Activity and presence
					status VARCHAR(20),
					activities TEXT,
					client_status TEXT,
					
					-- Relationship metadata
					summary TEXT,
					keywords TEXT[],
					emojis TEXT[],
					notes TEXT[],
					relationship_network JSONB DEFAULT '[]',
					
					-- Metadata
					active BOOLEAN DEFAULT true,
					created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					UNIQUE(guild_id, user_id)
				)
			`);

      await client.query(`
				CREATE TABLE IF NOT EXISTS messages (
					id VARCHAR(20) PRIMARY KEY,
					guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
					channel_id VARCHAR(20) NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
					author_id VARCHAR(20) NOT NULL,
					content TEXT NOT NULL,
					created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					edited_at TIMESTAMP WITH TIME ZONE,
					attachments TEXT[],
					embeds TEXT[],
					referenced_message_id VARCHAR(20) REFERENCES messages(id) ON DELETE SET NULL,
					active BOOLEAN DEFAULT true
				)
			`);

      // Add referenced_message_id column if it doesn't exist (migration for existing databases)
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'messages' AND column_name = 'referenced_message_id'
          ) THEN
            ALTER TABLE messages ADD COLUMN referenced_message_id VARCHAR(20) REFERENCES messages(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);

      // Relationship edges - directed dyads for realtime updates
      await client.query(`
				CREATE TABLE IF NOT EXISTS relationship_edges (
					guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
					user_a VARCHAR(20) NOT NULL,
					user_b VARCHAR(20) NOT NULL,
					last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					msg_a_to_b INTEGER DEFAULT 0,
					msg_b_to_a INTEGER DEFAULT 0,
					mentions INTEGER DEFAULT 0,
					replies INTEGER DEFAULT 0,
					reactions INTEGER DEFAULT 0,
					rolling_7d INTEGER DEFAULT 0,
					rolling_30d INTEGER DEFAULT 0,
					total INTEGER DEFAULT 0,
					created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					PRIMARY KEY (guild_id, user_a, user_b)
				)
			`);

      // Conversation segments - multi-participant conversations
      await client.query(`
				CREATE TABLE IF NOT EXISTS conversation_segments (
					id VARCHAR(50) PRIMARY KEY,
					guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
					channel_id VARCHAR(20) NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
					participants TEXT[] NOT NULL,
					start_time TIMESTAMP WITH TIME ZONE NOT NULL,
					end_time TIMESTAMP WITH TIME ZONE NOT NULL,
					message_ids TEXT[] NOT NULL,
					message_count INTEGER NOT NULL,
					features JSONB DEFAULT '{}',
					summary TEXT,
					created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
				)
			`);

      // Relationship pairs - optional cache for quick undirected reads
      await client.query(`
				CREATE TABLE IF NOT EXISTS relationship_pairs (
					guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
					u_min VARCHAR(20) NOT NULL,
					u_max VARCHAR(20) NOT NULL,
					last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					total_interactions INTEGER DEFAULT 0,
					segment_ids TEXT[] DEFAULT '{}',
					created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
					PRIMARY KEY (guild_id, u_min, u_max),
					CHECK (u_min < u_max)
				)
			`);

      // Add last_message_id to channels for watermark tracking
      await client.query(`
				ALTER TABLE channels
				ADD COLUMN IF NOT EXISTS last_message_id VARCHAR(20),
				ADD COLUMN IF NOT EXISTS last_message_sync TIMESTAMP WITH TIME ZONE
			`);

      // Create indexes for better performance
      await client.query(`
				CREATE INDEX IF NOT EXISTS idx_channels_guild_id ON channels(guild_id);
				CREATE INDEX IF NOT EXISTS idx_roles_guild_id ON roles(guild_id);
				CREATE INDEX IF NOT EXISTS idx_members_guild_id ON members(guild_id);
				CREATE INDEX IF NOT EXISTS idx_members_user_id ON members(user_id);
				CREATE INDEX IF NOT EXISTS idx_messages_guild_id ON messages(guild_id);
				CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id);
				CREATE INDEX IF NOT EXISTS idx_messages_author_id ON messages(author_id);
				CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
				CREATE INDEX IF NOT EXISTS idx_relationship_edges_guild ON relationship_edges(guild_id);
				CREATE INDEX IF NOT EXISTS idx_relationship_edges_user_a ON relationship_edges(user_a);
				CREATE INDEX IF NOT EXISTS idx_relationship_edges_user_b ON relationship_edges(user_b);
				CREATE INDEX IF NOT EXISTS idx_relationship_edges_last_interaction ON relationship_edges(last_interaction);
				CREATE INDEX IF NOT EXISTS idx_conversation_segments_guild ON conversation_segments(guild_id);
				CREATE INDEX IF NOT EXISTS idx_conversation_segments_channel ON conversation_segments(channel_id);
				CREATE INDEX IF NOT EXISTS idx_conversation_segments_participants ON conversation_segments USING GIN(participants);
				CREATE INDEX IF NOT EXISTS idx_conversation_segments_start_time ON conversation_segments(start_time);
				CREATE INDEX IF NOT EXISTS idx_relationship_pairs_guild ON relationship_pairs(guild_id);
				CREATE INDEX IF NOT EXISTS idx_relationship_pairs_users ON relationship_pairs(u_min, u_max);
			`);
    } catch (error) {
      console.error("🔸 Failed to initialize PostgreSQL schema:", error);
    } finally {
      client.release();
    }
  }

  // Guild operations
  async upsertGuild(guildData: GuildData): Promise<DatabaseResult<GuildData>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
				INSERT INTO guilds (id, name, description, icon, owner_id, member_count, active, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					description = EXCLUDED.description,
					icon = EXCLUDED.icon,
					owner_id = EXCLUDED.owner_id,
					member_count = EXCLUDED.member_count,
					active = EXCLUDED.active,
					updated_at = NOW()
				RETURNING *
			`;

      const values = [
        guildData.id,
        guildData.name,
        guildData.description,
        guildData.icon,
        guildData.owner_id,
        guildData.member_count,
        guildData.active,
      ];

      const result = await client.query(query, values);
      return { success: true, data: result.rows[0] };
    } catch (error) {
      console.error("🔸 Failed to upsert guild:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  // Channel operations
  async upsertChannel(
    channelData: ChannelData
  ): Promise<DatabaseResult<ChannelData>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
				INSERT INTO channels (id, guild_id, name, type, position, topic, nsfw, parent_id, active, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					type = EXCLUDED.type,
					position = EXCLUDED.position,
					topic = EXCLUDED.topic,
					nsfw = EXCLUDED.nsfw,
					parent_id = EXCLUDED.parent_id,
					active = EXCLUDED.active,
					updated_at = NOW()
				RETURNING *
			`;

      const values = [
        channelData.id,
        channelData.guild_id,
        channelData.name,
        channelData.type,
        channelData.position,
        channelData.topic,
        channelData.nsfw,
        channelData.parent_id,
        channelData.active,
      ];

      const result = await client.query(query, values);
      return { success: true, data: result.rows[0] };
    } catch (error) {
      console.error("🔸 Failed to upsert channel:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  // Role operations
  async upsertRole(roleData: RoleData): Promise<DatabaseResult<RoleData>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
				INSERT INTO roles (id, guild_id, name, color, position, permissions, mentionable, hoist, active, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					color = EXCLUDED.color,
					position = EXCLUDED.position,
					permissions = EXCLUDED.permissions,
					mentionable = EXCLUDED.mentionable,
					hoist = EXCLUDED.hoist,
					active = EXCLUDED.active,
					updated_at = NOW()
				RETURNING *
			`;

      const values = [
        roleData.id,
        roleData.guild_id,
        roleData.name,
        roleData.color,
        roleData.position,
        roleData.permissions,
        roleData.mentionable,
        roleData.hoist,
        roleData.active,
      ];

      const result = await client.query(query, values);
      return { success: true, data: result.rows[0] };
    } catch (error) {
      console.error("🔸 Failed to upsert role:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  // Member operations
  async upsertMember(
    memberData: MemberData
  ): Promise<DatabaseResult<MemberData>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
				INSERT INTO members (
					id, guild_id, user_id, username, display_name, global_name, avatar, avatar_decoration,
					banner, accent_color, discriminator, bio, flags, premium_type, public_flags,
					bot, system, nick, joined_at, roles, permissions, communication_disabled_until,
					pending, premium_since, timeout, status, activities, client_status, active, updated_at
				)
				VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, NOW()
				)
				ON CONFLICT (guild_id, user_id) DO UPDATE SET
					username = EXCLUDED.username,
					display_name = EXCLUDED.display_name,
					global_name = EXCLUDED.global_name,
					avatar = EXCLUDED.avatar,
					avatar_decoration = EXCLUDED.avatar_decoration,
					banner = EXCLUDED.banner,
					accent_color = EXCLUDED.accent_color,
					discriminator = EXCLUDED.discriminator,
					bio = EXCLUDED.bio,
					flags = EXCLUDED.flags,
					premium_type = EXCLUDED.premium_type,
					public_flags = EXCLUDED.public_flags,
					bot = EXCLUDED.bot,
					system = EXCLUDED.system,
					nick = EXCLUDED.nick,
					joined_at = EXCLUDED.joined_at,
					roles = EXCLUDED.roles,
					permissions = EXCLUDED.permissions,
					communication_disabled_until = EXCLUDED.communication_disabled_until,
					pending = EXCLUDED.pending,
					premium_since = EXCLUDED.premium_since,
					timeout = EXCLUDED.timeout,
					status = EXCLUDED.status,
					activities = EXCLUDED.activities,
					client_status = EXCLUDED.client_status,
					active = EXCLUDED.active,
					updated_at = NOW()
				RETURNING *
			`;

      const values = [
        memberData.id,
        memberData.guild_id,
        memberData.user_id,
        memberData.username,
        memberData.display_name,
        memberData.global_name,
        memberData.avatar,
        memberData.avatar_decoration,
        memberData.banner,
        memberData.accent_color,
        memberData.discriminator,
        memberData.bio,
        memberData.flags,
        memberData.premium_type,
        memberData.public_flags,
        memberData.bot,
        memberData.system,
        memberData.nick,
        memberData.joined_at,
        memberData.roles,
        memberData.permissions,
        memberData.communication_disabled_until,
        memberData.pending,
        memberData.premium_since,
        memberData.timeout,
        memberData.status,
        memberData.activities,
        memberData.client_status,
        memberData.active,
      ];

      const result = await client.query(query, values);
      return { success: true, data: result.rows[0] };
    } catch (error) {
      console.error("🔸 Failed to upsert member:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  // Message operations
  async upsertMessage(
    messageData: MessageData
  ): Promise<DatabaseResult<MessageData>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      // If referenced_message_id is provided, verify it exists in the database
      // If it doesn't exist, set it to NULL to avoid foreign key constraint violations
      let referencedMessageId = messageData.referenced_message_id || null;
      if (referencedMessageId) {
        const checkResult = await client.query(
          "SELECT id FROM messages WHERE id = $1",
          [referencedMessageId]
        );
        if (!checkResult.rows || checkResult.rows.length === 0) {
          // Referenced message doesn't exist yet, set to NULL
          referencedMessageId = null;
        }
      }

      const query = `
				INSERT INTO messages (id, guild_id, channel_id, author_id, content, created_at, edited_at, attachments, embeds, referenced_message_id, active)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				ON CONFLICT (id) DO UPDATE SET
					content = EXCLUDED.content,
					edited_at = EXCLUDED.edited_at,
					attachments = EXCLUDED.attachments,
					embeds = EXCLUDED.embeds,
					referenced_message_id = EXCLUDED.referenced_message_id,
					active = EXCLUDED.active
				RETURNING *
			`;

      const values = [
        messageData.id,
        messageData.guild_id,
        messageData.channel_id,
        messageData.author_id,
        messageData.content,
        messageData.created_at,
        messageData.edited_at,
        messageData.attachments,
        messageData.embeds,
        referencedMessageId,
        messageData.active,
      ];

      const result = await client.query(query, values);
      return { success: true, data: result.rows[0] };
    } catch (error) {
      console.error("🔸 Failed to upsert message:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  // Query operations
  async query(text: string, params?: any[]): Promise<DatabaseResult<any[] & { rowCount?: number }>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    let retries = 3;
    let lastError: Error | null = null;

    while (retries > 0) {
      const client = await this.pool!.connect().catch((err) => {
        lastError = err;
        return null;
      });

      if (!client) {
        retries--;
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (4 - retries))); // Exponential backoff
          continue;
        }
        return {
          success: false,
          error: lastError?.message || "Failed to acquire connection",
        };
      }

      try {
        const result = await client.query(text, params);
        // Include rowCount for DELETE/UPDATE queries by attaching it to the array
        const data = result.rows as any[];
        if (data && Array.isArray(data)) {
          Object.defineProperty(data, 'rowCount', {
            value: result.rowCount,
            writable: false,
            enumerable: false,
            configurable: false
          });
        }
        return { success: true, data };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isConnectionError = 
          lastError.message.includes("Connection terminated") ||
          lastError.message.includes("timeout") ||
          lastError.message.includes("ECONNRESET");

        if (isConnectionError && retries > 1) {
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 1000 * (4 - retries)));
          continue;
        }

        // Non-retryable error or out of retries
        console.error("🔸 Query failed:", lastError.message);
        return {
          success: false,
          error: lastError.message,
        };
      } finally {
        client.release();
      }
    }

    return {
      success: false,
      error: lastError?.message || "Query failed after retries",
    };
  }

  // Get guild statistics
  async getGuildStats(guildId: string): Promise<DatabaseResult<any>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
				SELECT 
					g.name as guild_name,
					g.member_count,
					COUNT(DISTINCT c.id) as channel_count,
					COUNT(DISTINCT r.id) as role_count,
					COUNT(DISTINCT m.id) as member_count_db,
					COUNT(DISTINCT msg.id) as message_count
				FROM guilds g
				LEFT JOIN channels c ON g.id = c.guild_id AND c.active = true
				LEFT JOIN roles r ON g.id = r.guild_id AND r.active = true
				LEFT JOIN members m ON g.id = m.guild_id AND m.active = true
				LEFT JOIN messages msg ON g.id = msg.guild_id AND msg.active = true
				WHERE g.id = $1 AND g.active = true
				GROUP BY g.id, g.name, g.member_count
			`;

      const result = await client.query(query, [guildId]);
      return { success: true, data: result.rows[0] || null };
    } catch (error) {
      console.error("🔸 Failed to get guild stats:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  // Relationship Network Operations
  async getMembersByGuild(
    guildId: string
  ): Promise<DatabaseResult<MemberData[]>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
				SELECT * FROM members 
				WHERE guild_id = $1 AND active = true
				ORDER BY username
			`;

      const result = await client.query(query, [guildId]);
      return { success: true, data: result.rows };
    } catch (error) {
      console.error("🔸 Failed to get guild members:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  async getMember(memberId: string): Promise<DatabaseResult<MemberData>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `SELECT * FROM members WHERE id = $1`;
      const result = await client.query(query, [memberId]);
      return { success: true, data: result.rows[0] || null };
    } catch (error) {
      console.error("🔸 Failed to get member:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  async getMemberRelationshipNetwork(
    userId: string,
    guildId: string
  ): Promise<DatabaseResult<RelationshipEntry[]>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
				SELECT relationship_network 
				FROM members 
				WHERE user_id = $1 AND guild_id = $2 AND active = true
			`;

      const result = await client.query(query, [userId, guildId]);
      const member = result.rows[0];

      if (!member) {
        return { success: true, data: [] };
      }

      const relationshipNetwork = member.relationship_network || [];
      return { success: true, data: relationshipNetwork };
    } catch (error) {
      console.error("🔸 Failed to get member relationship network:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  async updateMemberRelationshipNetwork(
    memberId: string,
    relationships: RelationshipEntry[]
  ): Promise<DatabaseResult<void>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      // First check if member exists
      const checkResult = await client.query(
        `SELECT id FROM members WHERE id = $1`,
        [memberId]
      );

      if (checkResult.rows.length === 0) {
        console.error(`🔸 Member not found with id: ${memberId}`);
        return {
          success: false,
          error: `Member not found: ${memberId}`,
        };
      }



      const query = `
				UPDATE members 
				SET relationship_network = $1, updated_at = NOW()
				WHERE id = $2
			`;

      const result = await client.query(query, [
        JSON.stringify(relationships),
        memberId,
      ]);
      console.log(
        `✅ Update query executed, rows affected: ${result.rowCount}`
      );

      if (result.rowCount === 0) {
        console.error(`🔸 Update affected 0 rows for id: ${memberId}`);
        return {
          success: false,
          error: "Update affected 0 rows",
        };
      }

      return { success: true };
    } catch (error) {
      console.error("🔸 Failed to update member relationship network:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  async getMessageInteractions(
    user1Id: string,
    user2Id: string,
    guildId: string,
    timeWindowMinutes: number = 5
  ): Promise<DatabaseResult<any[]>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      // Get messages from both users in the guild
      const query = `
				SELECT 
					id,
					channel_id,
					author_id,
					content,
					created_at,
					edited_at
				FROM messages 
				WHERE guild_id = $1 
					AND author_id IN ($2, $3)
					AND active = true
				ORDER BY created_at ASC
			`;

      const result = await client.query(query, [guildId, user1Id, user2Id]);
      const messages = result.rows;

      // Process messages to find interactions
      const interactions: any[] = [];
      const timeWindowMs = timeWindowMinutes * 60 * 1000;

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const messageTime = new Date(message.created_at).getTime();

        // Check for mentions
        const mentionPattern = new RegExp(
          `<@!?${user1Id === message.author_id ? user2Id : user1Id}>`,
          "g"
        );
        if (mentionPattern.test(message.content)) {
          interactions.push({
            interaction_type: "mention",
            timestamp: new Date(message.created_at),
            channel_id: message.channel_id,
            message_id: message.id,
            other_user_id: user1Id === message.author_id ? user2Id : user1Id,
            points: 2,
          });
        }

        // Check for same-channel interactions within time window
        if (i > 0) {
          const prevMessage = messages[i - 1];
          const prevTime = new Date(prevMessage.created_at).getTime();

          if (
            message.channel_id === prevMessage.channel_id &&
            message.author_id !== prevMessage.author_id &&
            Math.abs(messageTime - prevTime) <= timeWindowMs
          ) {
            interactions.push({
              interaction_type: "same_channel",
              timestamp: new Date(message.created_at),
              channel_id: message.channel_id,
              message_id: message.id,
              other_user_id: prevMessage.author_id,
              points: 1,
            });
          }
        }
      }

      return { success: true, data: interactions };
    } catch (error) {
      console.error("🔸 Failed to get message interactions:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get all messages between two users for conversation detection (excluding bot messages)
   */
  async getMessagesBetweenUsers(
    user1Id: string,
    user2Id: string,
    guildId: string
  ): Promise<DatabaseResult<any[]>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
        SELECT 
          m.id,
          m.channel_id,
          m.author_id,
          m.content,
          m.created_at,
          m.edited_at,
          m.attachments,
          m.embeds
        FROM messages m
        JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
        WHERE m.guild_id = $1 
          AND m.author_id IN ($2, $3)
          AND m.active = true
          AND mem.bot = false
        ORDER BY m.created_at ASC
      `;

      const result = await client.query(query, [guildId, user1Id, user2Id]);

      return { success: true, data: result.rows };
    } catch (error) {
      console.error("🔸 Failed to get messages between users:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get all names (current + historical) for a user in a guild
   */
  async getUserNames(
    userId: string,
    guildId: string
  ): Promise<DatabaseResult<string[]>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
        SELECT DISTINCT
          username,
          display_name,
          global_name,
          nick
        FROM members 
        WHERE user_id = $1 AND guild_id = $2 AND active = true
        UNION
        SELECT DISTINCT
          username,
          display_name,
          global_name,
          nick
        FROM members 
        WHERE user_id = $1 AND guild_id = $2 AND active = false
        ORDER BY username
      `;

      const result = await client.query(query, [userId, guildId]);

      // Collect all unique names
      const names = new Set<string>();
      result.rows.forEach((row) => {
        if (row.username) names.add(row.username);
        if (row.display_name) names.add(row.display_name);
        if (row.global_name) names.add(row.global_name);
        if (row.nick) names.add(row.nick);
      });

      return { success: true, data: Array.from(names) };
    } catch (error) {
      console.error("🔸 Failed to get user names:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // Relationship Edges - Realtime Incremental Updates
  // ============================================================================

  /**
   * Upsert relationship edge counters (O(1) update for realtime)
   */
  async upsertEdgeCounters(
    guildId: string,
    userA: string,
    userB: string,
    delta: {
      msg_a_to_b?: number;
      msg_b_to_a?: number;
      mentions?: number;
      replies?: number;
      reactions?: number;
      total?: number;
    }
  ): Promise<DatabaseResult<void>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
        INSERT INTO relationship_edges (
          guild_id, user_a, user_b, 
          last_interaction, msg_a_to_b, msg_b_to_a, mentions, replies, reactions, total
        )
        VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9)
        ON CONFLICT (guild_id, user_a, user_b) DO UPDATE SET
          msg_a_to_b = relationship_edges.msg_a_to_b + EXCLUDED.msg_a_to_b,
          msg_b_to_a = relationship_edges.msg_b_to_a + EXCLUDED.msg_b_to_a,
          mentions = relationship_edges.mentions + EXCLUDED.mentions,
          replies = relationship_edges.replies + EXCLUDED.replies,
          reactions = relationship_edges.reactions + EXCLUDED.reactions,
          total = relationship_edges.total + EXCLUDED.total,
          last_interaction = GREATEST(relationship_edges.last_interaction, EXCLUDED.last_interaction),
          updated_at = NOW()
      `;

      const values = [
        guildId,
        userA,
        userB,
        delta.msg_a_to_b || 0,
        delta.msg_b_to_a || 0,
        delta.mentions || 0,
        delta.replies || 0,
        delta.reactions || 0,
        delta.total || 0,
      ];

      await client.query(query, values);
      return { success: true };
    } catch (error) {
      console.error("🔸 Failed to upsert edge counters:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get edge for a specific pair
   */
  async getEdgeForPair(
    guildId: string,
    userA: string,
    userB: string
  ): Promise<DatabaseResult<any>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
        SELECT * FROM relationship_edges
        WHERE guild_id = $1 AND user_a = $2 AND user_b = $3
      `;
      const result = await client.query(query, [guildId, userA, userB]);
      return {
        success: true,
        data: result.rows[0] || null,
      };
    } catch (error) {
      console.error("🔸 Failed to get edge:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get all edges for a user (both directions)
   */
  async getEdgesForUser(
    guildId: string,
    userId: string,
    limit: number = 50
  ): Promise<DatabaseResult<any[]>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
        SELECT * FROM relationship_edges
        WHERE guild_id = $1 AND (user_a = $2 OR user_b = $2)
        ORDER BY last_interaction DESC, total DESC
        LIMIT $3
      `;
      const result = await client.query(query, [guildId, userId, limit]);
      return { success: true, data: result.rows };
    } catch (error) {
      console.error("🔸 Failed to get edges for user:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update rolling windows (7d, 30d) for edges
   */
  async updateEdgeRollingWindows(
    guildId: string,
    cutoff7d: Date,
    cutoff30d: Date
  ): Promise<DatabaseResult<void>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      // Reset rolling windows and recalculate from interactions in the windows
      const query = `
        UPDATE relationship_edges
        SET 
          rolling_7d = CASE 
            WHEN last_interaction >= $2 THEN total
            ELSE 0
          END,
          rolling_30d = CASE
            WHEN last_interaction >= $3 THEN total
            ELSE 0
          END,
          updated_at = NOW()
        WHERE guild_id = $1
      `;
      await client.query(query, [guildId, cutoff7d, cutoff30d]);
      return { success: true };
    } catch (error) {
      console.error("🔸 Failed to update rolling windows:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // Conversation Segments - Multi-participant Conversations
  // ============================================================================

  /**
   * Upsert conversation segment
   */
  async upsertConversationSegment(segment: {
    id: string;
    guildId: string;
    channelId: string;
    participants: string[];
    startTime: Date;
    endTime: Date;
    messageIds: string[];
    messageCount: number;
    features?: Record<string, any>;
    summary?: string;
  }): Promise<DatabaseResult<void>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
        INSERT INTO conversation_segments (
          id, guild_id, channel_id, participants, start_time, end_time,
          message_ids, message_count, features, summary
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          end_time = EXCLUDED.end_time,
          message_ids = EXCLUDED.message_ids,
          message_count = EXCLUDED.message_count,
          features = EXCLUDED.features,
          summary = EXCLUDED.summary
      `;

      const values = [
        segment.id,
        segment.guildId,
        segment.channelId,
        segment.participants,
        segment.startTime,
        segment.endTime,
        segment.messageIds,
        segment.messageCount,
        JSON.stringify(segment.features || {}),
        segment.summary || null,
      ];

      await client.query(query, values);
      return { success: true };
    } catch (error) {
      console.error("🔸 Failed to upsert conversation segment:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get segments for participants (overlapping or exact match)
   */
  async getSegmentsForParticipants(
    guildId: string,
    participantIds: string[],
    limit: number = 10,
    since?: Date
  ): Promise<DatabaseResult<any[]>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      // Find segments where participants array contains any of the given participant IDs
      const query = `
        SELECT * FROM conversation_segments
        WHERE guild_id = $1
          AND participants && $2::TEXT[]
          ${since ? "AND start_time >= $4" : ""}
        ORDER BY start_time DESC
        LIMIT $3
      `;
      const params: any[] = [guildId, participantIds, limit];
      if (since) params.push(since);

      const result = await client.query(query, params);
      return { success: true, data: result.rows };
    } catch (error) {
      console.error("🔸 Failed to get segments for participants:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get segments for a channel
   */
  async getSegmentsForChannel(
    guildId: string,
    channelId: string,
    limit: number = 20
  ): Promise<DatabaseResult<any[]>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
        SELECT * FROM conversation_segments
        WHERE guild_id = $1 AND channel_id = $2
        ORDER BY start_time DESC
        LIMIT $3
      `;
      const result = await client.query(query, [guildId, channelId, limit]);
      return { success: true, data: result.rows };
    } catch (error) {
      console.error("🔸 Failed to get segments for channel:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // Relationship Pairs - Undirected Cache
  // ============================================================================

  /**
   * Upsert relationship pair (undirected, cached for quick reads)
   */
  async upsertPair(
    guildId: string,
    user1: string,
    user2: string,
    segmentId?: string
  ): Promise<DatabaseResult<void>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const [uMin, uMax] = user1 < user2 ? [user1, user2] : [user2, user1];

      const query = segmentId
        ? `
          INSERT INTO relationship_pairs (
            guild_id, u_min, u_max, last_interaction, total_interactions, segment_ids
          )
          VALUES ($1, $2, $3, NOW(), 1, ARRAY[$4]::TEXT[])
          ON CONFLICT (guild_id, u_min, u_max) DO UPDATE SET
            last_interaction = NOW(),
            total_interactions = relationship_pairs.total_interactions + 1,
            segment_ids = (
              SELECT array_agg(elem)
              FROM (
                SELECT DISTINCT elem
                FROM unnest(relationship_pairs.segment_ids || ARRAY[$4]::TEXT[]) AS elem
                ORDER BY elem DESC
                LIMIT 20
              ) subq
            ),
            updated_at = NOW()
        `
        : `
          INSERT INTO relationship_pairs (
            guild_id, u_min, u_max, last_interaction, total_interactions
          )
          VALUES ($1, $2, $3, NOW(), 1)
          ON CONFLICT (guild_id, u_min, u_max) DO UPDATE SET
            last_interaction = NOW(),
            total_interactions = relationship_pairs.total_interactions + 1,
            updated_at = NOW()
        `;

      const params = segmentId
        ? [guildId, uMin, uMax, segmentId]
        : [guildId, uMin, uMax];

      await client.query(query, params);
      return { success: true };
    } catch (error) {
      console.error("🔸 Failed to upsert pair:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get pairs for a user
   */
  async getPairsForUser(
    guildId: string,
    userId: string,
    limit: number = 50
  ): Promise<DatabaseResult<any[]>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
        SELECT * FROM relationship_pairs
        WHERE guild_id = $1 AND (u_min = $2 OR u_max = $2)
        ORDER BY last_interaction DESC, total_interactions DESC
        LIMIT $3
      `;
      const result = await client.query(query, [guildId, userId, limit]);
      return { success: true, data: result.rows };
    } catch (error) {
      console.error("🔸 Failed to get pairs for user:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // Channel Watermark Tracking
  // ============================================================================

  /**
   * Update channel's last message watermark
   */
  async updateChannelLastMessage(
    channelId: string,
    messageId: string | null
  ): Promise<DatabaseResult<void>> {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = messageId
        ? `
          UPDATE channels
          SET last_message_id = $1, last_message_sync = NOW()
          WHERE id = $2
        `
        : `
          UPDATE channels
          SET last_message_id = NULL, last_message_sync = NULL
          WHERE id = $1
        `;
      await client.query(query, messageId ? [messageId, channelId] : [channelId]);
      return { success: true };
    } catch (error) {
      console.error("🔸 Failed to update channel last message:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get channel watermark
   */
  async getChannelWatermark(channelId: string): Promise<
    DatabaseResult<{
      last_message_id: string | null;
      last_message_sync: Date | null;
    }>
  > {
    if (!this.isConnected()) {
      return { success: false, error: "Database not connected" };
    }

    const client = await this.pool!.connect();
    try {
      const query = `
        SELECT last_message_id, last_message_sync
        FROM channels
        WHERE id = $1
      `;
      const result = await client.query(query, [channelId]);
      return {
        success: true,
        data: result.rows[0] || {
          last_message_id: null,
          last_message_sync: null,
        },
      };
    } catch (error) {
      console.error("🔸 Failed to get channel watermark:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      client.release();
    }
  }
}
