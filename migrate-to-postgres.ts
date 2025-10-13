#!/usr/bin/env tsx
/**
 * MongoDB to PostgreSQL Migration Script
 * Run this to migrate your existing data from MongoDB to PostgreSQL
 */

import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { executeQuery } from "./src/features/database-manager/PostgresConnection.js";
import { initializePostgresSchema } from "./src/features/database-manager/PostgresSchema.js";

dotenv.config();

interface MongoUser {
	_id: string;
	discordId: string;
	guildId?: string;
	bot: boolean;
	username: string;
	displayName: string;
	discriminator: string;
	avatar?: string;
	status?: string;
	roles: string[];
	joinedAt: Date;
	lastSeen: Date;
	avatarHistory: any[];
	usernameHistory: string[];
	displayNameHistory: string[];
	statusHistory: any[];
	emoji?: string;
	title?: string;
	summary?: string;
	keywords?: string[];
	notes?: string[];
	relationships: any[];
	modPreferences: any;
	createdAt: Date;
	updatedAt: Date;
}

interface MongoMessage {
	_id: string;
	discordId: string;
	content: string;
	authorId: string;
	channelId: string;
	guildId: string;
	timestamp: Date;
	editedAt?: Date;
	deletedAt?: Date;
	mentions: string[];
	reactions: any[];
	replyTo?: string;
	attachments: any[];
	embeds: any[];
	createdAt: Date;
	updatedAt: Date;
}

interface MongoVoiceSession {
	_id: string;
	userId: string;
	guildId: string;
	channelId: string;
	channelName: string;
	displayName?: string;
	joinedAt: Date;
	leftAt?: Date;
	duration?: number;
	createdAt: Date;
	updatedAt: Date;
}

async function migrateData() {
	console.log("🔄 Starting MongoDB to PostgreSQL migration...");

	// Initialize PostgreSQL schema
	console.log("📋 Creating PostgreSQL tables...");
	await initializePostgresSchema();

	// Connect to MongoDB
	if (!process.env.MONGO_URI) {
		console.error("❌ MONGO_URI not found in environment variables");
		console.log("💡 Add MONGO_URI to your .env file to migrate existing data");
		console.log("💡 Or just run the bot without migration for a fresh start");
		return;
	}

	const mongoClient = new MongoClient(process.env.MONGO_URI);
	await mongoClient.connect();
	const db = mongoClient.db(process.env.DB_NAME || "discord-bot");

	console.log("📊 Migrating users...");
	const users = await db.collection("users").find({}).toArray();
	for (const user of users as MongoUser[]) {
		try {
			await executeQuery(
				`
				INSERT INTO users (
					discord_id, guild_id, bot, username, display_name, discriminator,
					avatar, status, roles, joined_at, last_seen, avatar_history,
					username_history, display_name_history, status_history, emoji,
					title, summary, keywords, notes, relationships, mod_preferences,
					created_at, updated_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
				ON CONFLICT (discord_id, guild_id) DO NOTHING
			`,
				[
					user.discordId,
					user.guildId || "unknown",
					user.bot,
					user.username,
					user.displayName,
					user.discriminator,
					user.avatar,
					user.status,
					user.roles,
					user.joinedAt,
					user.lastSeen,
					JSON.stringify(user.avatarHistory || []),
					user.usernameHistory || [],
					user.displayNameHistory || [],
					JSON.stringify(user.statusHistory || []),
					user.emoji,
					user.title,
					user.summary,
					user.keywords || [],
					user.notes || [],
					JSON.stringify(user.relationships || []),
					JSON.stringify(user.modPreferences || {}),
					user.createdAt,
					user.updatedAt,
				],
			);
		} catch (error) {
			console.error(`❌ Error migrating user ${user.discordId}:`, error);
		}
	}
	console.log(`✅ Migrated ${users.length} users`);

	console.log("📊 Migrating messages...");
	const messages = await db.collection("messages").find({}).toArray();
	for (const message of messages as MongoMessage[]) {
		try {
			await executeQuery(
				`
				INSERT INTO messages (
					discord_id, content, author_id, channel_id, guild_id, timestamp,
					edited_at, deleted_at, mentions, reactions, reply_to, attachments, embeds,
					created_at, updated_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
				ON CONFLICT (discord_id) DO NOTHING
			`,
				[
					message.discordId,
					message.content,
					message.authorId,
					message.channelId,
					message.guildId,
					message.timestamp,
					message.editedAt,
					message.deletedAt,
					message.mentions,
					JSON.stringify(message.reactions || []),
					message.replyTo,
					JSON.stringify(message.attachments || []),
					JSON.stringify(message.embeds || []),
					message.createdAt,
					message.updatedAt,
				],
			);
		} catch (error) {
			console.error(`❌ Error migrating message ${message.discordId}:`, error);
		}
	}
	console.log(`✅ Migrated ${messages.length} messages`);

	console.log("📊 Migrating voice sessions...");
	const voiceSessions = await db.collection("voiceSessions").find({}).toArray();
	for (const session of voiceSessions as MongoVoiceSession[]) {
		try {
			await executeQuery(
				`
				INSERT INTO voice_sessions (
					user_id, guild_id, channel_id, channel_name, display_name, joined_at,
					left_at, duration, created_at, updated_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				ON CONFLICT DO NOTHING
			`,
				[
					session.userId,
					session.guildId,
					session.channelId,
					session.channelName,
					session.displayName,
					session.joinedAt,
					session.leftAt,
					session.duration,
					session.createdAt,
					session.updatedAt,
				],
			);
		} catch (error) {
			console.error(`❌ Error migrating voice session ${session._id}:`, error);
		}
	}
	console.log(`✅ Migrated ${voiceSessions.length} voice sessions`);

	await mongoClient.close();
	console.log("🎉 Migration completed successfully!");
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	migrateData().catch(console.error);
}

export { migrateData };
