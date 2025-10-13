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
				discriminator VARCHAR(4) NOT NULL,
				avatar TEXT,
				status TEXT,
				roles TEXT[] DEFAULT '{}',
				joined_at TIMESTAMP NOT NULL,
				last_seen TIMESTAMP NOT NULL,
				avatar_history JSONB DEFAULT '[]',
				username_history TEXT[] DEFAULT '{}',
				display_name_history TEXT[] DEFAULT '{}',
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
	];

	for (const index of indexes) {
		await executeQuery(index);
	}
}

export async function dropPostgresTables(): Promise<void> {
	const tables = [
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

export async function initializePostgresSchema(): Promise<void> {
	await createPostgresTables();
	await createPostgresIndexes();
}
