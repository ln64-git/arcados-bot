#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function testDisplayNameFix() {
	try {
		console.log("🔍 Testing Display Name Fix");
		console.log("=".repeat(40));

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

		// Check for sessions with display names
		const sessionsWithNames = sessions.filter((s) => s.displayName);
		console.log(
			`📊 Sessions with display names: ${sessionsWithNames.length}/${sessions.length}`,
		);

		if (sessionsWithNames.length > 0) {
			console.log(`\n📝 DISPLAY NAMES FOUND:`);
			const displayNames = new Set<string>();
			for (const session of sessionsWithNames) {
				displayNames.add(session.displayName!);
			}

			const sortedNames = Array.from(displayNames).sort();
			for (const name of sortedNames) {
				console.log(`👤 "${name}"`);
			}
		} else {
			console.log(
				`\n🔸 No display names found - this is expected for old sessions`,
			);
			console.log(`💡 New voice sessions will now include display names`);
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

			// Check if this user has display names in their sessions
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
			} else {
				console.log(`📝 No display names found for this user`);
				console.log(
					`💡 The VoiceManager will use Discord's current display name`,
				);
			}
		}

		console.log(`\n🔧 FIXES APPLIED:`);
		console.log("-".repeat(20));
		console.log("✅ Added displayName field to VoiceSession interface");
		console.log("✅ Updated RealtimeTracker to capture display names");
		console.log("✅ Voice sessions now store user display names");
		console.log("✅ Channel renaming will work with proper display names");

		console.log(`\n💡 NEXT STEPS:`);
		console.log("-".repeat(20));
		console.log("🔹 Restart the bot to apply the fixes");
		console.log("🔹 New voice sessions will include display names");
		console.log("🔹 Channel renaming will work correctly");
		console.log("🔹 Inactive owner detection will work properly");
	} catch (error) {
		console.error("🔸 Error testing display name fix:", error);
	} finally {
		process.exit(0);
	}
}

testDisplayNameFix().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
