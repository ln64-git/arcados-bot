#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function checkOwnershipSources() {
	try {
		console.log("🔍 Checking Ownership Sources (Redis vs Database)");
		console.log("=".repeat(50));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const cache = new DiscordDataCache();

		// Test channel ID
		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(30));

		// Check Redis cache
		console.log(`\n🔍 REDIS CACHE:`);
		try {
			const redisOwner = await cache.getChannelOwner(channelId);
			console.log(`👤 Redis Owner: ${redisOwner ? redisOwner.userId : "None"}`);
			if (redisOwner) {
				console.log(
					`📅 Redis Created: ${redisOwner.createdAt.toLocaleString()}`,
				);
				console.log(
					`🕒 Redis Last Activity: ${redisOwner.lastActivity.toLocaleString()}`,
				);
			}
		} catch (error) {
			console.log(`🔸 Redis Error: ${error}`);
		}

		// Check database directly
		console.log(`\n🔍 DATABASE:`);
		try {
			const db = await dbCore.getDatabase();
			const ownershipCollection = db.collection("voiceChannelOwnership");
			const dbOwner = await ownershipCollection.findOne({ channelId });
			console.log(`👤 Database Owner: ${dbOwner ? dbOwner.userId : "None"}`);
			if (dbOwner) {
				console.log(
					`📅 Database Created: ${dbOwner.createdAt.toLocaleString()}`,
				);
				console.log(
					`🕒 Database Last Activity: ${dbOwner.lastActivity.toLocaleString()}`,
				);
			}
		} catch (error) {
			console.log(`🔸 Database Error: ${error}`);
		}

		// Check if there are multiple ownership records
		console.log(`\n🔍 ALL OWNERSHIP RECORDS:`);
		try {
			const db = await dbCore.getDatabase();
			const ownershipCollection = db.collection("voiceChannelOwnership");
			const allOwners = await ownershipCollection.find({ channelId }).toArray();
			console.log(`📊 Total records: ${allOwners.length}`);

			for (const owner of allOwners) {
				console.log(`👤 Owner: ${owner.userId}`);
				console.log(`📅 Created: ${owner.createdAt.toLocaleString()}`);
				console.log(`🕒 Last Activity: ${owner.lastActivity.toLocaleString()}`);
				console.log(`---`);
			}
		} catch (error) {
			console.log(`🔸 Error getting all records: ${error}`);
		}

		// Check voice sessions for this channel
		console.log(`\n🔍 VOICE SESSIONS:`);
		try {
			const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
			const channelSessions = allSessions.filter(
				(s) => s.channelId === channelId,
			);
			console.log(`📊 Total sessions: ${channelSessions.length}`);

			// Group by user
			const userSessions = new Map<string, any[]>();
			for (const session of channelSessions) {
				if (!userSessions.has(session.userId)) {
					userSessions.set(session.userId, []);
				}
				userSessions.get(session.userId)!.push(session);
			}

			console.log(`👥 Users in channel:`);
			for (const [userId, sessions] of userSessions) {
				console.log(`👤 ${userId}: ${sessions.length} sessions`);
			}
		} catch (error) {
			console.log(`🔸 Error getting voice sessions: ${error}`);
		}

		console.log(`\n💡 DIAGNOSIS:`);
		console.log("-".repeat(20));
		console.log("🔹 If Redis and Database differ, there's a cache sync issue");
		console.log(
			"🔹 If multiple ownership records exist, there's a data integrity issue",
		);
		console.log(
			"🔹 The bot should be reading from the same source as our scripts",
		);
	} catch (error) {
		console.error("🔸 Error checking ownership sources:", error);
	} finally {
		process.exit(0);
	}
}

checkOwnershipSources().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
