import { executeQuery } from "./PostgresConnection";

export async function createPostgresTables(): Promise<void> {
	const tables = [
		// Users table
		`
		CREATE TABLE IF NOT EXISTS users (
			id SERIAL PRIMARY KEY,
			discord_id VARCHAR(20) NOT NULL,
			guild_id VARCHAR(20) NOT NULL,
			bot BOOLEAN DEFAULT FALSE,
			username VARCHAR(100) NOT NULL,
			display_name VARCHAR(100) NOT NULL,
			nickname VARCHAR(100),
			discriminator VARCHAR(4) NOT NULL,
			avatar TEXT,
			status TEXT,
			roles TEXT[] DEFAULT '{}',
			joined_at TIMESTAMP NOT NULL,
			last_seen TIMESTAMP NOT NULL,
			avatar_history JSONB DEFAULT '[]',
			username_history TEXT[] DEFAULT '{}',
			display_name_history TEXT[] DEFAULT '{}',
			nickname_history TEXT[] DEFAULT '{}',
			status_history JSONB DEFAULT '[]',
			emoji VARCHAR(10),
			title VARCHAR(200),
			summary TEXT,
			keywords TEXT[] DEFAULT '{}',
			notes TEXT[] DEFAULT '{}',
			relationships JSONB DEFAULT '[]',
			mod_preferences JSONB DEFAULT '{}',
			voice_interactions JSONB DEFAULT '[]',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(discord_id, guild_id)
		)
			`,

		// Roles table
		`
			CREATE TABLE IF NOT EXISTS roles (
				id SERIAL PRIMARY KEY,
				discord_id VARCHAR(20) NOT NULL,
				guild_id VARCHAR(20) NOT NULL,
				name VARCHAR(100) NOT NULL,
				color INTEGER NOT NULL,
				mentionable BOOLEAN DEFAULT FALSE,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(discord_id, guild_id)
			)
			`,

		// Messages table
		`
			CREATE TABLE IF NOT EXISTS messages (
				id SERIAL PRIMARY KEY,
				discord_id VARCHAR(20) NOT NULL UNIQUE,
				content TEXT NOT NULL,
				author_id VARCHAR(20) NOT NULL,
				channel_id VARCHAR(20) NOT NULL,
				guild_id VARCHAR(20) NOT NULL,
				timestamp TIMESTAMP NOT NULL,
				edited_at TIMESTAMP,
				deleted_at TIMESTAMP,
				mentions TEXT[] DEFAULT '{}',
				reactions JSONB DEFAULT '[]',
				reply_to VARCHAR(20),
				attachments JSONB DEFAULT '[]',
				embeds JSONB DEFAULT '[]',
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
			`,

		// Guild syncs table
		`
			CREATE TABLE IF NOT EXISTS guild_syncs (
				id SERIAL PRIMARY KEY,
				guild_id VARCHAR(20) NOT NULL UNIQUE,
				last_sync_at TIMESTAMP NOT NULL,
				last_message_id VARCHAR(20),
				total_users INTEGER DEFAULT 0,
				total_messages INTEGER DEFAULT 0,
				total_roles INTEGER DEFAULT 0,
				is_fully_synced BOOLEAN DEFAULT FALSE,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
			`,

		// Relationships table
		`
			CREATE TABLE IF NOT EXISTS relationships (
				id SERIAL PRIMARY KEY,
				user_id1 VARCHAR(20) NOT NULL,
				user_id2 VARCHAR(20) NOT NULL,
				guild_id VARCHAR(20) NOT NULL,
				emoji VARCHAR(10),
				title VARCHAR(200),
				summary TEXT,
				keywords TEXT[] DEFAULT '{}',
				notes TEXT[] DEFAULT '{}',
				total_interactions INTEGER DEFAULT 0,
				total_weight INTEGER DEFAULT 0,
				mentions INTEGER DEFAULT 0,
				replies INTEGER DEFAULT 0,
				reactions INTEGER DEFAULT 0,
				voice_time INTEGER DEFAULT 0,
				interactions JSONB DEFAULT '[]',
				strength VARCHAR(20) DEFAULT 'weak',
				last_interaction TIMESTAMP,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(user_id1, user_id2, guild_id)
			)
			`,

		// Interaction records table
		`
		CREATE TABLE IF NOT EXISTS interaction_records (
			id SERIAL PRIMARY KEY,
			from_user_id VARCHAR(20) NOT NULL,
			to_user_id VARCHAR(20) NOT NULL,
			interaction_type VARCHAR(20) NOT NULL,
			timestamp TIMESTAMP NOT NULL,
			weight INTEGER DEFAULT 1,
			message_id VARCHAR(20),
			channel_id VARCHAR(20),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
		`,

		// Channels table
		`
		CREATE TABLE IF NOT EXISTS channels (
			id SERIAL PRIMARY KEY,
			discord_id VARCHAR(20) NOT NULL,
			guild_id VARCHAR(20) NOT NULL,
			channel_name VARCHAR(100) NOT NULL,
			position INTEGER NOT NULL DEFAULT 0,
			is_active BOOLEAN DEFAULT TRUE,
			active_user_ids TEXT[] DEFAULT '{}',
			member_count INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(discord_id, guild_id)
		)
		`,

		// Voice channel sessions table
		`
		CREATE TABLE IF NOT EXISTS voice_channel_sessions (
			id SERIAL PRIMARY KEY,
			user_id VARCHAR(20) NOT NULL,
			guild_id VARCHAR(20) NOT NULL,
			channel_id VARCHAR(20) NOT NULL,
			channel_name VARCHAR(100) NOT NULL,
			joined_at TIMESTAMP NOT NULL,
			left_at TIMESTAMP NULL,
			duration INTEGER NULL,
			is_active BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
		`,

		// Clean up duplicate active sessions before creating unique constraint
		`
		WITH duplicate_sessions AS (
			SELECT user_id, channel_id, MIN(id) as keep_id
			FROM voice_channel_sessions 
			WHERE is_active = TRUE
			GROUP BY user_id, channel_id
			HAVING COUNT(*) > 1
		)
		UPDATE voice_channel_sessions 
		SET is_active = FALSE, left_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE is_active = TRUE 
		AND (user_id, channel_id) IN (SELECT user_id, channel_id FROM duplicate_sessions)
		AND id NOT IN (SELECT keep_id FROM duplicate_sessions)
		`,

		// Unique index to prevent duplicate active sessions per user per channel
		`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_active_session_per_user_channel 
		ON voice_channel_sessions (user_id, channel_id) 
		WHERE is_active = TRUE
		`,
	];

	for (const table of tables) {
		await executeQuery(table);
	}
}

export async function createPostgresIndexes(): Promise<void> {
	const indexes = [
		// Users indexes
		"CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id)",
		"CREATE INDEX IF NOT EXISTS idx_users_guild_id ON users(guild_id)",
		"CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)",
		"CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen)",
		"CREATE INDEX IF NOT EXISTS idx_users_voice_interactions ON users USING GIN(voice_interactions)",
		"CREATE INDEX IF NOT EXISTS idx_users_mod_preferences ON users USING GIN(mod_preferences)",

		// Roles indexes
		"CREATE INDEX IF NOT EXISTS idx_roles_discord_id ON roles(discord_id)",
		"CREATE INDEX IF NOT EXISTS idx_roles_guild_id ON roles(guild_id)",

		// Messages indexes
		"CREATE INDEX IF NOT EXISTS idx_messages_discord_id ON messages(discord_id)",
		"CREATE INDEX IF NOT EXISTS idx_messages_guild_id ON messages(guild_id)",
		"CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id)",
		"CREATE INDEX IF NOT EXISTS idx_messages_author_id ON messages(author_id)",
		"CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)",
		"CREATE INDEX IF NOT EXISTS idx_messages_mentions ON messages USING GIN(mentions)",

		// Guild syncs indexes
		"CREATE INDEX IF NOT EXISTS idx_guild_syncs_guild_id ON guild_syncs(guild_id)",

		// Relationships indexes
		"CREATE INDEX IF NOT EXISTS idx_relationships_user_id1 ON relationships(user_id1)",
		"CREATE INDEX IF NOT EXISTS idx_relationships_user_id2 ON relationships(user_id2)",
		"CREATE INDEX IF NOT EXISTS idx_relationships_guild_id ON relationships(guild_id)",
		"CREATE INDEX IF NOT EXISTS idx_relationships_last_interaction ON relationships(last_interaction)",

		// Interaction records indexes
		"CREATE INDEX IF NOT EXISTS idx_interaction_records_from_user ON interaction_records(from_user_id)",
		"CREATE INDEX IF NOT EXISTS idx_interaction_records_to_user ON interaction_records(to_user_id)",
		"CREATE INDEX IF NOT EXISTS idx_interaction_records_timestamp ON interaction_records(timestamp)",
		"CREATE INDEX IF NOT EXISTS idx_interaction_records_type ON interaction_records(interaction_type)",

		// Channels indexes
		"CREATE INDEX IF NOT EXISTS idx_channels_discord_id ON channels(discord_id)",
		"CREATE INDEX IF NOT EXISTS idx_channels_guild_id ON channels(guild_id)",
		"CREATE INDEX IF NOT EXISTS idx_channels_position ON channels(position)",
		"CREATE INDEX IF NOT EXISTS idx_channels_is_active ON channels(is_active)",
		"CREATE INDEX IF NOT EXISTS idx_channels_active_user_ids ON channels USING GIN(active_user_ids)",
		"CREATE INDEX IF NOT EXISTS idx_channels_member_count ON channels(member_count)",

		// Voice channel sessions indexes
		"CREATE INDEX IF NOT EXISTS idx_voice_sessions_user_id ON voice_channel_sessions(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_voice_sessions_guild_id ON voice_channel_sessions(guild_id)",
		"CREATE INDEX IF NOT EXISTS idx_voice_sessions_channel_id ON voice_channel_sessions(channel_id)",
		"CREATE INDEX IF NOT EXISTS idx_voice_sessions_joined_at ON voice_channel_sessions(joined_at)",
		"CREATE INDEX IF NOT EXISTS idx_voice_sessions_left_at ON voice_channel_sessions(left_at)",
		"CREATE INDEX IF NOT EXISTS idx_voice_sessions_is_active ON voice_channel_sessions(is_active)",
		"CREATE INDEX IF NOT EXISTS idx_voice_sessions_duration ON voice_channel_sessions(duration)",
	];

	for (const index of indexes) {
		await executeQuery(index);
	}
}

export async function dropPostgresTables(): Promise<void> {
	const tables = [
		"channels",
		"voice_channel_sessions",
		"interaction_records",
		"relationships",
		"guild_syncs",
		"messages",
		"roles",
		"users",
	];

	for (const table of tables) {
		await executeQuery(`DROP TABLE IF EXISTS ${table} CASCADE`);
	}
}

export async function migratePostgresSchema(): Promise<void> {
	// Add position column to existing channels table if it doesn't exist
	try {
		await executeQuery(`
			ALTER TABLE channels 
			ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0
		`);
		console.log("🔹 Added position column to channels table");
	} catch (error) {
		console.warn("🔸 Failed to add position column to channels table:", error);
	}

	// Add nickname columns to existing users table if they don't exist
	try {
		await executeQuery(`
			ALTER TABLE users 
			ADD COLUMN IF NOT EXISTS nickname VARCHAR(100)
		`);
		console.log("🔹 Added nickname column to users table");
	} catch (error) {
		console.warn("🔸 Failed to add nickname column to users table:", error);
	}

	try {
		await executeQuery(`
			ALTER TABLE users 
			ADD COLUMN IF NOT EXISTS nickname_history TEXT[] DEFAULT '{}'
		`);
		console.log("🔹 Added nickname_history column to users table");
	} catch (error) {
		console.warn(
			"🔸 Failed to add nickname_history column to users table:",
			error,
		);
	}
}

export async function initializePostgresSchema(): Promise<void> {
	await createPostgresTables();
	await migratePostgresSchema();
	await createPostgresIndexes();
}
