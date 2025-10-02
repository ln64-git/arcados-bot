#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function testOrphanedChannelHandling() {
	try {
		console.log("🔍 Testing Orphaned Channel Handling Logic");
		console.log("=".repeat(50));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const cache = new DiscordDataCache();

		// Test channel ID
		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL ANALYSIS: ${channelId}`);
		console.log("-".repeat(30));

		// Check current ownership
		const owner = await cache.getChannelOwner(channelId);
		console.log(`👤 Current owner: ${owner ? owner.userId : "None"}`);

		// Get voice sessions for this channel
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const sessions = allSessions.filter((s) => s.channelId === channelId);
		console.log(`📊 Total voice sessions: ${sessions.length}`);

		if (sessions.length === 0) {
			console.log("🔸 No voice sessions found for this channel");
			return;
		}

		// Group sessions by user
		const userSessions = new Map<string, any[]>();
		for (const session of sessions) {
			if (!userSessions.has(session.userId)) {
				userSessions.set(session.userId, []);
			}
			userSessions.get(session.userId)!.push(session);
		}

		console.log(`\n👥 USERS IN CHANNEL:`);
		console.log("-".repeat(20));

		// Calculate total duration for each user
		const userDurations = new Map<string, number>();
		for (const [userId, userSessionList] of userSessions) {
			let totalDuration = 0;
			for (const session of userSessionList) {
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

		// Find longest-standing user
		if (sortedUsers.length > 0) {
			const [longestUserId, longestDuration] = sortedUsers[0];
			const hours = Math.floor(longestDuration / (1000 * 60 * 60));
			const minutes = Math.floor(
				(longestDuration % (1000 * 60 * 60)) / (1000 * 60),
			);

			console.log(`\n🏆 LONGEST-STANDING USER:`);
			console.log(`👤 User ID: ${longestUserId}`);
			console.log(`⏱️  Total Duration: ${hours}h ${minutes}m`);

			// Get their most common display name
			const longestUserSessions = userSessions.get(longestUserId)!;
			const displayNameCounts = new Map<string, number>();

			for (const session of longestUserSessions) {
				if (session.displayName) {
					const count = displayNameCounts.get(session.displayName) || 0;
					displayNameCounts.set(session.displayName, count + 1);
				}
			}

			if (displayNameCounts.size > 0) {
				const sortedNames = Array.from(displayNameCounts.entries()).sort(
					(a, b) => b[1] - a[1],
				);
				const [mostCommonName] = sortedNames[0];
				console.log(`📝 Most common display name: "${mostCommonName}"`);

				const expectedChannelName = `${mostCommonName}'s Channel`;
				console.log(`🏷️  Expected channel name: "${expectedChannelName}"`);
			}
		}

		console.log(`\n🤖 ORPHANED CHANNEL HANDLING SIMULATION:`);
		console.log("=".repeat(50));

		if (!owner) {
			console.log(
				"✅ Channel has no owner - would trigger handleOrphanedChannel()",
			);
			console.log("🔹 Would assign ownership to longest-standing user");
			console.log("🔹 Would rename channel to owner's display name");
			console.log("🔹 Would apply owner's preferences to channel");
			console.log("🔹 Would set owner permissions");
		} else {
			console.log(
				"ℹ️  Channel already has an owner - no orphaned handling needed",
			);
		}

		console.log(`\n💡 INTEGRATION POINTS:`);
		console.log("-".repeat(20));
		console.log(
			"🔹 handleUserLeft() calls handleOrphanedChannel() when no owner",
		);
		console.log("🔹 handleOrphanedChannel() assigns ownership to longest user");
		console.log("🔹 setChannelOwner() automatically renames the channel");
		console.log("🔹 All existing preferences and permissions are applied");
	} catch (error) {
		console.error("🔸 Error testing orphaned channel handling:", error);
	} finally {
		process.exit(0);
	}
}

testOrphanedChannelHandling().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
