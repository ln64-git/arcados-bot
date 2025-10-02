#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function testInactiveOwnerByUserId() {
	try {
		console.log("🔍 Testing Inactive Owner Detection (User ID Based)");
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
		console.log(`👤 Current owner ID: ${owner ? owner.userId : "None"}`);

		// Get voice sessions for this channel
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const sessions = allSessions.filter((s) => s.channelId === channelId);
		console.log(`📊 Total voice sessions: ${sessions.length}`);

		if (sessions.length === 0) {
			console.log("🔸 No voice sessions found for this channel");
			return;
		}

		// Get current active users (simulate Discord channel members)
		// Users with recent sessions (within last hour) or currently active sessions
		const recentSessions = sessions.filter((s) => {
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
			return s.joinedAt > oneHourAgo || (s.leftAt && s.leftAt > oneHourAgo);
		});

		const currentMembers = new Set<string>();
		for (const session of recentSessions) {
			currentMembers.add(session.userId);
		}

		console.log(`\n👥 CURRENT CHANNEL MEMBERS (by User ID):`);
		console.log("-".repeat(40));

		for (const userId of currentMembers) {
			console.log(`👤 ${userId}`);
		}

		// Check if owner is in current members
		if (owner) {
			const ownerInChannel = currentMembers.has(owner.userId);
			console.log(`\n🔍 OWNER STATUS CHECK:`);
			console.log("-".repeat(20));
			console.log(`👤 Owner ID: ${owner.userId}`);
			console.log(
				`📍 Owner in channel: ${ownerInChannel ? "✅ YES" : "❌ NO"}`,
			);

			if (!ownerInChannel) {
				console.log(`\n🤖 INACTIVE OWNER DETECTION:`);
				console.log("=".repeat(40));
				console.log("✅ Owner is not in channel - would trigger reassignment");
				console.log("🔹 Would remove current owner from database");
				console.log(
					"🔹 Would assign ownership to longest-standing user in channel",
				);
				console.log("🔹 Would rename channel to new owner's display name");
			} else {
				console.log(
					`\n✅ Owner is present in channel - no reassignment needed`,
				);
			}
		} else {
			console.log(`\n🤖 NO OWNER DETECTED:`);
			console.log("=".repeat(30));
			console.log("✅ Channel has no owner - would trigger auto-assignment");
		}

		// Find longest-standing user among current members (by user ID and duration)
		if (currentMembers.size > 0) {
			const userDurations = new Map<string, number>();
			for (const userId of currentMembers) {
				const userSessions = sessions.filter((s) => s.userId === userId);
				let totalDuration = 0;
				for (const session of userSessions) {
					if (session.leftAt) {
						totalDuration +=
							session.leftAt.getTime() - session.joinedAt.getTime();
					}
				}
				userDurations.set(userId, totalDuration);
			}

			const sortedUsers = Array.from(userDurations.entries()).sort(
				(a, b) => b[1] - a[1],
			);

			if (sortedUsers.length > 0) {
				const [longestUserId, longestDuration] = sortedUsers[0];
				const hours = Math.floor(longestDuration / (1000 * 60 * 60));
				const minutes = Math.floor(
					(longestDuration % (1000 * 60 * 60)) / (1000 * 60),
				);

				console.log(`\n🏆 LONGEST-STANDING USER IN CHANNEL:`);
				console.log(`👤 User ID: ${longestUserId}`);
				console.log(`⏱️  Total Duration: ${hours}h ${minutes}m`);
				console.log(`💡 This user would become the new owner`);
			}
		}

		console.log(`\n💡 LOGIC SUMMARY:`);
		console.log("-".repeat(20));
		console.log("🔹 Ownership detection: User ID based");
		console.log("🔹 Active member check: User ID in channel members");
		console.log("🔹 Duration calculation: User ID + voice session data");
		console.log("🔹 Channel renaming: Display name (for user-friendly names)");
	} catch (error) {
		console.error("🔸 Error testing inactive owner detection:", error);
	} finally {
		process.exit(0);
	}
}

testInactiveOwnerByUserId().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
