#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function findTerraUserId() {
	try {
		console.log("🔍 Finding Terra Praetorium's User ID");
		console.log("=".repeat(50));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Test channel ID
		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(30));

		// Get all voice sessions for this channel
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const channelSessions = allSessions.filter(
			(s) => s.channelId === channelId,
		);

		console.log(`📊 Total voice sessions: ${channelSessions.length}`);

		// Group by user
		const userSessions = new Map<string, any[]>();
		for (const session of channelSessions) {
			if (!userSessions.has(session.userId)) {
				userSessions.set(session.userId, []);
			}
			userSessions.get(session.userId)!.push(session);
		}

		console.log(`\n👥 ALL USERS IN CHANNEL:`);
		console.log("-".repeat(30));

		// Calculate duration for each user
		const userDurations = new Map<string, number>();
		for (const [userId, sessions] of userSessions) {
			let totalDuration = 0;
			for (const session of sessions) {
				if (session.leftAt) {
					totalDuration +=
						session.leftAt.getTime() - session.joinedAt.getTime();
				}
			}
			userDurations.set(userId, totalDuration);
		}

		// Sort by duration (longest first)
		const sortedUsers = Array.from(userDurations.entries()).sort(
			(a, b) => b[1] - a[1],
		);

		for (const [userId, duration] of sortedUsers) {
			const hours = Math.floor(duration / (1000 * 60 * 60));
			const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
			console.log(
				`👤 ${userId}: ${hours}h ${minutes}m (${userSessions.get(userId)!.length} sessions)`,
			);
		}

		// Check if any user has "Terra" or "Praetorium" in their display names
		console.log(`\n🔍 SEARCHING FOR TERRA PRAETORIUM:`);
		console.log("-".repeat(40));

		let terraUserId: string | null = null;
		for (const [userId, sessions] of userSessions) {
			for (const session of sessions) {
				if (session.displayName) {
					if (
						session.displayName.toLowerCase().includes("terra") ||
						session.displayName.toLowerCase().includes("praetorium")
					) {
						terraUserId = userId;
						console.log(`🎯 FOUND TERRA: ${userId}`);
						console.log(`📝 Display name: "${session.displayName}"`);
						break;
					}
				}
			}
			if (terraUserId) break;
		}

		if (!terraUserId) {
			console.log(
				`🔸 No user found with "Terra" or "Praetorium" in display name`,
			);
			console.log(
				`💡 This suggests Terra Praetorium might have a different user ID`,
			);
			console.log(`💡 Or the display names aren't being stored properly`);
		}

		// Check current ownership
		const cache = new DiscordDataCache();
		const owner = await cache.getChannelOwner(channelId);
		console.log(`\n📋 CURRENT OWNERSHIP:`);
		console.log(`👤 Database owner: ${owner ? owner.userId : "None"}`);

		if (owner && terraUserId && owner.userId !== terraUserId) {
			console.log(`\n🔸 MISMATCH DETECTED:`);
			console.log(`👤 Database owner: ${owner.userId}`);
			console.log(`👤 Terra's user ID: ${terraUserId}`);
			console.log(
				`💡 The bot is showing Terra as owner but database has different user`,
			);
		}

		console.log(`\n💡 CONCLUSION:`);
		console.log("-".repeat(20));
		console.log(
			"🔹 If Terra is shown as owner in Discord, they should be the owner",
		);
		console.log(
			"🔹 Channel should be renamed to Terra's preferred name or 'Terra's Channel'",
		);
		console.log("🔹 Current name '01010101's Channel' is incorrect");
	} catch (error) {
		console.error("🔸 Error finding Terra's user ID:", error);
	} finally {
		process.exit(0);
	}
}

findTerraUserId().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
