import { executeQuery } from "./SurrealConnection";

export async function createSurrealTables(): Promise<void> {
	const schemaQueries = [
		// Users table - Document-first with flexible types
		`
		DEFINE TABLE users SCHEMAFULL;
		DEFINE FIELD discordId ON users TYPE any;
		DEFINE FIELD guildId ON users TYPE any;
		DEFINE FIELD username ON users TYPE any;
		DEFINE FIELD displayName ON users TYPE any;
		DEFINE FIELD nickname ON users TYPE any;
		DEFINE FIELD discriminator ON users TYPE any;
		DEFINE FIELD avatar ON users TYPE any;
		DEFINE FIELD status ON users TYPE any;
		DEFINE FIELD roles ON users TYPE any;
		DEFINE FIELD joinedAt ON users TYPE any;
		DEFINE FIELD lastSeen ON users TYPE any;
		DEFINE FIELD avatarHistory ON users TYPE any;
		DEFINE FIELD usernameHistory ON users TYPE any;
		DEFINE FIELD displayNameHistory ON users TYPE any;
		DEFINE FIELD nicknameHistory ON users TYPE any;
		DEFINE FIELD statusHistory ON users TYPE any;
		DEFINE FIELD emoji ON users TYPE any;
		DEFINE FIELD title ON users TYPE any;
		DEFINE FIELD summary ON users TYPE any;
		DEFINE FIELD keywords ON users TYPE any;
		DEFINE FIELD notes ON users TYPE any;
		DEFINE FIELD relationships ON users TYPE any;
		DEFINE FIELD modPreferences ON users TYPE any;
		DEFINE FIELD voiceInteractions ON users TYPE any;
		DEFINE FIELD createdAt ON users TYPE datetime;
		DEFINE FIELD updatedAt ON users TYPE datetime;
		DEFINE INDEX idx_users_discord_guild ON users FIELDS discordId, guildId UNIQUE;
		DEFINE INDEX idx_users_guild_id ON users FIELDS guildId;
		DEFINE INDEX idx_users_nickname ON users FIELDS nickname;
		DEFINE INDEX idx_users_last_seen ON users FIELDS lastSeen;
		`,

		// Roles table - Flexible for Discord role objects
		`
		DEFINE TABLE roles SCHEMAFULL;
		DEFINE FIELD discordId ON roles TYPE string;
		DEFINE FIELD guildId ON roles TYPE string;
		DEFINE FIELD name ON roles TYPE string;
		DEFINE FIELD color ON roles TYPE any;
		DEFINE FIELD mentionable ON roles TYPE any;
		DEFINE FIELD permissions ON roles TYPE any;
		DEFINE FIELD position ON roles TYPE any;
		DEFINE FIELD createdAt ON roles TYPE datetime;
		DEFINE FIELD updatedAt ON roles TYPE datetime;
		DEFINE INDEX idx_roles_discord_guild ON roles FIELDS discordId, guildId UNIQUE;
		DEFINE INDEX idx_roles_guild_id ON roles FIELDS guildId;
		`,

		// Remove and recreate messages table to clear existing data
		`REMOVE TABLE messages;`,
		// Messages table - Document-first for Discord message objects
		`
		DEFINE TABLE messages SCHEMAFULL;
		DEFINE FIELD discordId ON messages TYPE string;
		DEFINE FIELD content ON messages TYPE any;
		DEFINE FIELD authorId ON messages TYPE string;
		DEFINE FIELD channelId ON messages TYPE string;
		DEFINE FIELD guildId ON messages TYPE string;
		DEFINE FIELD timestamp ON messages TYPE any;
		DEFINE FIELD editedAt ON messages TYPE any;
		DEFINE FIELD deletedAt ON messages TYPE any;
		DEFINE FIELD mentions ON messages TYPE array<any>;
		DEFINE FIELD reactions ON messages TYPE array<any>;
		DEFINE FIELD replyTo ON messages TYPE any;
		DEFINE FIELD attachments ON messages TYPE array<any>;
		DEFINE FIELD embeds ON messages TYPE array<any>;
		DEFINE FIELD flags ON messages TYPE any;
		DEFINE FIELD type ON messages TYPE any;
		DEFINE FIELD createdAt ON messages TYPE datetime;
		DEFINE FIELD updatedAt ON messages TYPE datetime;
		DEFINE INDEX idx_messages_discord_id ON messages FIELDS discordId UNIQUE;
		DEFINE INDEX idx_messages_guild_id ON messages FIELDS guildId;
		DEFINE INDEX idx_messages_channel_id ON messages FIELDS channelId;
		DEFINE INDEX idx_messages_author_id ON messages FIELDS authorId;
		DEFINE INDEX idx_messages_timestamp ON messages FIELDS timestamp;
		`,

		// Guild syncs table - Flexible for sync metadata
		`
		DEFINE TABLE guildSyncs SCHEMAFULL;
		DEFINE FIELD guildId ON guildSyncs TYPE string;
		DEFINE FIELD lastSyncAt ON guildSyncs TYPE datetime;
		DEFINE FIELD lastMessageId ON guildSyncs TYPE any;
		DEFINE FIELD totalUsers ON guildSyncs TYPE any;
		DEFINE FIELD totalMessages ON guildSyncs TYPE any;
		DEFINE FIELD totalRoles ON guildSyncs TYPE any;
		DEFINE FIELD isFullySynced ON guildSyncs TYPE any;
		DEFINE FIELD createdAt ON guildSyncs TYPE datetime;
		DEFINE FIELD updatedAt ON guildSyncs TYPE datetime;
		DEFINE INDEX idx_guild_syncs_guild_id ON guildSyncs FIELDS guildId UNIQUE;
		`,

		// Relationships table - Graph relationships between users
		`
		DEFINE TABLE relationships SCHEMAFULL;
		DEFINE FIELD userId1 ON relationships TYPE string;
		DEFINE FIELD userId2 ON relationships TYPE string;
		DEFINE FIELD guildId ON relationships TYPE string;
		DEFINE FIELD emoji ON relationships TYPE any;
		DEFINE FIELD title ON relationships TYPE any;
		DEFINE FIELD summary ON relationships TYPE any;
		DEFINE FIELD keywords ON relationships TYPE array<any>;
		DEFINE FIELD notes ON relationships TYPE array<any>;
		DEFINE FIELD totalInteractions ON relationships TYPE any;
		DEFINE FIELD totalWeight ON relationships TYPE any;
		DEFINE FIELD mentions ON relationships TYPE any;
		DEFINE FIELD replies ON relationships TYPE any;
		DEFINE FIELD reactions ON relationships TYPE any;
		DEFINE FIELD voiceTime ON relationships TYPE any;
		DEFINE FIELD interactions ON relationships TYPE array<any>;
		DEFINE FIELD strength ON relationships TYPE any;
		DEFINE FIELD lastInteraction ON relationships TYPE any;
		DEFINE FIELD createdAt ON relationships TYPE datetime;
		DEFINE FIELD updatedAt ON relationships TYPE datetime;
		DEFINE INDEX idx_relationships_users ON relationships FIELDS userId1, userId2, guildId UNIQUE;
		DEFINE INDEX idx_relationships_guild_id ON relationships FIELDS guildId;
		DEFINE INDEX idx_relationships_last_interaction ON relationships FIELDS lastInteraction;
		`,

		// Interaction records table - Flexible for interaction tracking
		`
		DEFINE TABLE interactionRecords SCHEMAFULL;
		DEFINE FIELD fromUserId ON interactionRecords TYPE string;
		DEFINE FIELD toUserId ON interactionRecords TYPE string;
		DEFINE FIELD interactionType ON interactionRecords TYPE any;
		DEFINE FIELD timestamp ON interactionRecords TYPE datetime;
		DEFINE FIELD weight ON interactionRecords TYPE any;
		DEFINE FIELD messageId ON interactionRecords TYPE any;
		DEFINE FIELD channelId ON interactionRecords TYPE any;
		DEFINE FIELD createdAt ON interactionRecords TYPE datetime;
		DEFINE FIELD updatedAt ON interactionRecords TYPE datetime;
		DEFINE INDEX idx_interaction_records_from_user ON interactionRecords FIELDS fromUserId;
		DEFINE INDEX idx_interaction_records_to_user ON interactionRecords FIELDS toUserId;
		DEFINE INDEX idx_interaction_records_timestamp ON interactionRecords FIELDS timestamp;
		DEFINE INDEX idx_interaction_records_type ON interactionRecords FIELDS interactionType;
		`,

		// Channels table - Document-first for Discord channel objects
		`
		DEFINE TABLE channels SCHEMAFULL;
		DEFINE FIELD discordId ON channels TYPE string;
		DEFINE FIELD guildId ON channels TYPE string;
		DEFINE FIELD channelName ON channels TYPE any;
		DEFINE FIELD position ON channels TYPE any;
		DEFINE FIELD isActive ON channels TYPE any;
		DEFINE FIELD activeUserIds ON channels TYPE array<any>;
		DEFINE FIELD memberCount ON channels TYPE any;
		DEFINE FIELD status ON channels TYPE any;
		DEFINE FIELD lastStatusChange ON channels TYPE any;
		DEFINE FIELD type ON channels TYPE any;
		DEFINE FIELD topic ON channels TYPE any;
		DEFINE FIELD createdAt ON channels TYPE datetime;
		DEFINE FIELD updatedAt ON channels TYPE datetime;
		DEFINE INDEX idx_channels_discord_guild ON channels FIELDS discordId, guildId UNIQUE;
		DEFINE INDEX idx_channels_guild_id ON channels FIELDS guildId;
		DEFINE INDEX idx_channels_position ON channels FIELDS position;
		DEFINE INDEX idx_channels_is_active ON channels FIELDS isActive;
		DEFINE INDEX idx_channels_member_count ON channels FIELDS memberCount;
		`,

		// Voice channel sessions table - Flexible for session tracking
		`
		DEFINE TABLE voiceChannelSessions SCHEMAFULL;
		DEFINE FIELD userId ON voiceChannelSessions TYPE string;
		DEFINE FIELD guildId ON voiceChannelSessions TYPE string;
		DEFINE FIELD channelId ON voiceChannelSessions TYPE string;
		DEFINE FIELD channelName ON voiceChannelSessions TYPE any;
		DEFINE FIELD joinedAt ON voiceChannelSessions TYPE datetime;
		DEFINE FIELD leftAt ON voiceChannelSessions TYPE any;
		DEFINE FIELD duration ON voiceChannelSessions TYPE any;
		DEFINE FIELD isActive ON voiceChannelSessions TYPE any;
		DEFINE FIELD createdAt ON voiceChannelSessions TYPE datetime;
		DEFINE FIELD updatedAt ON voiceChannelSessions TYPE datetime;
		DEFINE INDEX idx_voice_sessions_user_id ON voiceChannelSessions FIELDS userId;
		DEFINE INDEX idx_voice_sessions_guild_id ON voiceChannelSessions FIELDS guildId;
		DEFINE INDEX idx_voice_sessions_channel_id ON voiceChannelSessions FIELDS channelId;
		DEFINE INDEX idx_voice_sessions_joined_at ON voiceChannelSessions FIELDS joinedAt;
		DEFINE INDEX idx_voice_sessions_left_at ON voiceChannelSessions FIELDS leftAt;
		DEFINE INDEX idx_voice_sessions_is_active ON voiceChannelSessions FIELDS isActive;
		DEFINE INDEX idx_voice_sessions_duration ON voiceChannelSessions FIELDS duration;
		DEFINE INDEX idx_active_session_per_user_channel ON voiceChannelSessions FIELDS userId, channelId UNIQUE;
		`,
	];

	for (const query of schemaQueries) {
		try {
			await executeQuery(query);
		} catch (error) {
			console.warn("🔸 Failed to create SurrealDB schema:", error);
			throw error;
		}
	}

	console.log("🔹 SurrealDB schema created successfully");
}

export async function dropSurrealTables(): Promise<void> {
	const tables = [
		"voiceChannelSessions",
		"channels",
		"interactionRecords",
		"relationships",
		"guildSyncs",
		"messages",
		"roles",
		"users",
	];

	for (const table of tables) {
		try {
			await executeQuery(`REMOVE TABLE ${table}`);
		} catch (error) {
			console.warn(`🔸 Failed to drop table ${table}:`, error);
		}
	}

	console.log("🔹 SurrealDB tables dropped successfully");
}

export async function initializeSurrealSchema(): Promise<void> {
	await createSurrealTables();
}
