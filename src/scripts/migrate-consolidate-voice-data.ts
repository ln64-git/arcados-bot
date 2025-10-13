#!/usr/bin/env bun
/**
 * Migration script to consolidate voice channel data
 *
 * This script:
 * 1. Adds voice_interactions column to users table
 * 2. Migrates existing voice_sessions data to voice_interactions
 * 3. Migrates moderation_logs to mod_preferences.modHistory
 * 4. Migrates voice_channel_owners to Redis cache
 * 5. Drops old tables
 * 6. Creates GIN indexes
 */

import { config } from "../config";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache";
import { DatabaseCore } from "../features/database-manager/PostgresCore";

interface VoiceSession {
	id: string;
	userId: string;
	guildId: string;
	channelId: string;
	channelName: string;
	joinedAt: Date;
	leftAt?: Date;
	duration?: number;
}

interface ModerationLog {
	id: string;
	action: string;
	channelId: string;
	guildId: string;
	performerId: string;
	targetId?: string;
	reason?: string;
	timestamp: Date;
}

interface VoiceChannelOwner {
	channelId: string;
	userId: string;
	guildId: string;
	ownedSince: Date;
	previousOwnerId?: string;
}

async function migrateVoiceData() {
	console.log("🚀 Starting voice data consolidation migration...");

	const dbCore = new DatabaseCore();
	const cache = new DiscordDataCache();

	try {
		// Initialize connections
		await dbCore.initialize();
		await cache.initialize();

		console.log("✅ Database connections initialized");

		// Step 1: Add voice_interactions column if it doesn't exist
		console.log("📝 Step 1: Adding voice_interactions column...");
		await addVoiceInteractionsColumn(dbCore);

		// Step 2: Migrate voice_sessions to voice_interactions
		console.log("📝 Step 2: Migrating voice_sessions data...");
		await migrateVoiceSessions(dbCore);

		// Step 3: Migrate moderation_logs to mod_preferences.modHistory
		console.log("📝 Step 3: Migrating moderation logs...");
		await migrateModerationLogs(dbCore);

		// Step 4: Migrate voice_channel_owners to Redis cache
		console.log("📝 Step 4: Migrating channel ownership to Redis...");
		await migrateChannelOwnership(dbCore, cache);

		// Step 5: Create GIN indexes
		console.log("📝 Step 5: Creating GIN indexes...");
		await createGinIndexes(dbCore);

		// Step 6: Drop old tables
		console.log("📝 Step 6: Dropping old tables...");
		await dropOldTables(dbCore);

		console.log("🎉 Migration completed successfully!");
	} catch (error) {
		console.error("❌ Migration failed:", error);
		throw error;
	} finally {
		// Cleanup - DatabaseCore doesn't have cleanup method
		console.log("🧹 Migration cleanup completed");
	}
}

async function addVoiceInteractionsColumn(dbCore: DatabaseCore): Promise<void> {
	const query = `
		ALTER TABLE users 
		ADD COLUMN IF NOT EXISTS voice_interactions JSONB DEFAULT '[]'
	`;

	await dbCore.executeQuery(query);
	console.log("✅ Added voice_interactions column");
}

async function migrateVoiceSessions(dbCore: DatabaseCore): Promise<void> {
	// Check if voice_sessions table exists
	const checkTableQuery = `
		SELECT EXISTS (
			SELECT FROM information_schema.tables 
			WHERE table_schema = 'public' 
			AND table_name = 'voice_sessions'
		);
	`;

	const tableExists = await dbCore.executeQueryOne(checkTableQuery);

	if (!tableExists?.exists) {
		console.log("ℹ️ voice_sessions table doesn't exist, skipping migration");
		return;
	}

	// Get all voice sessions
	const sessionsQuery = `
		SELECT id, user_id, guild_id, channel_id, channel_name, joined_at, left_at, duration
		FROM voice_sessions
		ORDER BY user_id, guild_id, joined_at
	`;

	const sessions = (await dbCore.executeQuery(sessionsQuery)) as VoiceSession[];
	console.log(`📊 Found ${sessions.length} voice sessions to migrate`);

	// Group sessions by user and guild
	const userSessions = new Map<string, VoiceSession[]>();

	for (const session of sessions) {
		const key = `${session.userId}-${session.guildId}`;
		if (!userSessions.has(key)) {
			userSessions.set(key, []);
		}
		userSessions.get(key)!.push(session);
	}

	// Migrate each user's sessions
	let migratedCount = 0;
	for (const [key, userSessionList] of userSessions) {
		const [userId, guildId] = key.split("-");

		// Convert sessions to voice interactions format
		const voiceInteractions = userSessionList.map((session) => ({
			channelId: session.channelId,
			channelName: session.channelName,
			guildId: session.guildId,
			joinedAt: session.joinedAt,
			leftAt: session.leftAt,
			duration: session.duration,
		}));

		// Update user's voice_interactions
		const updateQuery = `
			UPDATE users 
			SET voice_interactions = $1::jsonb,
				updated_at = CURRENT_TIMESTAMP
			WHERE discord_id = $2 AND guild_id = $3
		`;

		await dbCore.executeQuery(updateQuery, [
			JSON.stringify(voiceInteractions),
			userId,
			guildId,
		]);

		migratedCount += userSessionList.length;
	}

	console.log(
		`✅ Migrated ${migratedCount} voice sessions for ${userSessions.size} users`,
	);
}

async function migrateModerationLogs(dbCore: DatabaseCore): Promise<void> {
	// Check if moderation_logs table exists
	const checkTableQuery = `
		SELECT EXISTS (
			SELECT FROM information_schema.tables 
			WHERE table_schema = 'public' 
			AND table_name = 'moderation_logs'
		);
	`;

	const tableExists = await dbCore.executeQueryOne(checkTableQuery);

	if (!tableExists?.exists) {
		console.log("ℹ️ moderation_logs table doesn't exist, skipping migration");
		return;
	}

	// Get all moderation logs
	const logsQuery = `
		SELECT id, action, channel_id, guild_id, performer_id, target_id, reason, timestamp
		FROM moderation_logs
		ORDER BY performer_id, guild_id, timestamp
	`;

	const logs = (await dbCore.executeQuery(logsQuery)) as ModerationLog[];
	console.log(`📊 Found ${logs.length} moderation logs to migrate`);

	// Group logs by performer and guild
	const userLogs = new Map<string, ModerationLog[]>();

	for (const log of logs) {
		const key = `${log.performerId}-${log.guildId}`;
		if (!userLogs.has(key)) {
			userLogs.set(key, []);
		}
		userLogs.get(key)!.push(log);
	}

	// Migrate each user's logs
	let migratedCount = 0;
	for (const [key, userLogList] of userLogs) {
		const [userId, guildId] = key.split("-");

		// Convert logs to mod history format
		const modHistory = userLogList.map((log) => ({
			action: log.action,
			targetUserId: log.targetId || "unknown",
			channelId: log.channelId,
			reason: log.reason,
			timestamp: log.timestamp,
		}));

		// Update user's mod_preferences.modHistory
		const updateQuery = `
			UPDATE users 
			SET mod_preferences = jsonb_set(
				COALESCE(mod_preferences, '{}'::jsonb),
				'{modHistory}',
				$1::jsonb
			),
			updated_at = CURRENT_TIMESTAMP
			WHERE discord_id = $2 AND guild_id = $3
		`;

		await dbCore.executeQuery(updateQuery, [
			JSON.stringify(modHistory),
			userId,
			guildId,
		]);

		migratedCount += userLogList.length;
	}

	console.log(
		`✅ Migrated ${migratedCount} moderation logs for ${userLogs.size} users`,
	);
}

async function migrateChannelOwnership(
	dbCore: DatabaseCore,
	cache: DiscordDataCache,
): Promise<void> {
	// Check if voice_channel_owners table exists
	const checkTableQuery = `
		SELECT EXISTS (
			SELECT FROM information_schema.tables 
			WHERE table_schema = 'public' 
			AND table_name = 'voice_channel_owners'
		);
	`;

	const tableExists = await dbCore.executeQueryOne(checkTableQuery);

	if (!tableExists?.exists) {
		console.log(
			"ℹ️ voice_channel_owners table doesn't exist, skipping migration",
		);
		return;
	}

	// Get all channel owners
	const ownersQuery = `
		SELECT channel_id, user_id, guild_id, owned_since, previous_owner_id
		FROM voice_channel_owners
	`;

	const owners = (await dbCore.executeQuery(
		ownersQuery,
	)) as VoiceChannelOwner[];
	console.log(`📊 Found ${owners.length} channel owners to migrate to Redis`);

	// Migrate to Redis cache
	let migratedCount = 0;
	for (const owner of owners) {
		await cache.setChannelOwnershipCache(owner.channelId, {
			userId: owner.userId,
			ownedSince: owner.ownedSince,
			previousOwnerId: owner.previousOwnerId,
		});
		migratedCount++;
	}

	console.log(`✅ Migrated ${migratedCount} channel owners to Redis cache`);
}

async function createGinIndexes(dbCore: DatabaseCore): Promise<void> {
	const indexes = [
		"CREATE INDEX IF NOT EXISTS idx_users_voice_interactions ON users USING GIN(voice_interactions)",
		"CREATE INDEX IF NOT EXISTS idx_users_mod_preferences ON users USING GIN(mod_preferences)",
	];

	for (const indexQuery of indexes) {
		await dbCore.executeQuery(indexQuery);
	}

	console.log("✅ Created GIN indexes");
}

async function dropOldTables(dbCore: DatabaseCore): Promise<void> {
	const tablesToDrop = [
		"voice_sessions",
		"moderation_logs",
		"voice_channel_owners",
	];

	for (const tableName of tablesToDrop) {
		// Check if table exists before dropping
		const checkTableQuery = `
			SELECT EXISTS (
				SELECT FROM information_schema.tables 
				WHERE table_schema = 'public' 
				AND table_name = $1
			);
		`;

		const tableExists = await dbCore.executeQueryOne(checkTableQuery, [
			tableName,
		]);

		if (tableExists?.exists) {
			await dbCore.executeQuery(`DROP TABLE ${tableName}`);
			console.log(`✅ Dropped table: ${tableName}`);
		} else {
			console.log(`ℹ️ Table ${tableName} doesn't exist, skipping`);
		}
	}
}

// Run migration if this script is executed directly
if (import.meta.main) {
	migrateVoiceData()
		.then(() => {
			console.log("🎉 Migration completed successfully!");
			process.exit(0);
		})
		.catch((error) => {
			console.error("❌ Migration failed:", error);
			process.exit(1);
		});
}

export { migrateVoiceData };
