#!/usr/bin/env npx tsx

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { PostgreSQLManager } from "../database/PostgreSQLManager.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function recreateSchema() {
	console.log("🔹 Recreating PostgreSQL schema...");

	if (!process.env.POSTGRES_URL) {
		console.error("🔸 POSTGRES_URL not found in environment variables");
		process.exit(1);
	}

	const db = new PostgreSQLManager();
	
	try {
		const connected = await db.connect();
		
		if (!connected) {
			console.error("🔸 Failed to connect to PostgreSQL");
			process.exit(1);
		}

		console.log("✅ Connected to PostgreSQL");

		// Drop all tables first
		console.log("🔹 Dropping existing tables...");
		await db.query("DROP TABLE IF EXISTS messages CASCADE");
		await db.query("DROP TABLE IF EXISTS members CASCADE");
		await db.query("DROP TABLE IF EXISTS roles CASCADE");
		await db.query("DROP TABLE IF EXISTS channels CASCADE");
		await db.query("DROP TABLE IF EXISTS guilds CASCADE");
		console.log("✅ Dropped existing tables");

		// Recreate schema
		console.log("🔹 Creating new schema...");
		await db.query(`
			CREATE TABLE guilds (
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

		await db.query(`
			CREATE TABLE channels (
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

		await db.query(`
			CREATE TABLE roles (
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

		await db.query(`
			CREATE TABLE members (
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
				
				-- Metadata
				active BOOLEAN DEFAULT true,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				UNIQUE(guild_id, user_id)
			)
		`);

		await db.query(`
			CREATE TABLE messages (
				id VARCHAR(20) PRIMARY KEY,
				guild_id VARCHAR(20) NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
				channel_id VARCHAR(20) NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
				author_id VARCHAR(20) NOT NULL,
				content TEXT NOT NULL,
				created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
				edited_at TIMESTAMP WITH TIME ZONE,
				attachments TEXT[],
				embeds TEXT[],
				active BOOLEAN DEFAULT true
			)
		`);

		// Create indexes
		console.log("🔹 Creating indexes...");
		await db.query("CREATE INDEX idx_channels_guild_id ON channels(guild_id)");
		await db.query("CREATE INDEX idx_roles_guild_id ON roles(guild_id)");
		await db.query("CREATE INDEX idx_members_guild_id ON members(guild_id)");
		await db.query("CREATE INDEX idx_members_user_id ON members(user_id)");
		await db.query("CREATE INDEX idx_messages_guild_id ON messages(guild_id)");
		await db.query("CREATE INDEX idx_messages_channel_id ON messages(channel_id)");
		await db.query("CREATE INDEX idx_messages_author_id ON messages(author_id)");
		await db.query("CREATE INDEX idx_messages_created_at ON messages(created_at)");

		console.log("✅ Schema recreated successfully!");
		
		await db.disconnect();
		
	} catch (error) {
		console.error("🔸 Error recreating schema:", error);
		process.exit(1);
	}
}

recreateSchema().catch((error) => {
	console.error("🔸 Unhandled error:", error);
	process.exit(1);
});
