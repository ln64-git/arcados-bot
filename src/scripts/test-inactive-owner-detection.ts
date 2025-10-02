#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function testInactiveOwnerDetection() {
	try {
		console.log("🔍 Testing Inactive Owner Detection Logic");
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

		if (owner) {
			console.log(`📅 Ownership since: ${owner.createdAt.toLocaleString()}`);
			console.log(`🕒 Last activity: ${owner.lastActivity.toLocaleString()}`);
		}

		// Get voice sessions for this channel
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const sessions = allSessions.filter((s) => s.channelId === channelId);
		console.log(`📊 Total voice sessions: ${sessions.length}`);

		if (sessions.length === 0) {
			console.log("🔸 No voice sessions found for this channel");
			return;
		}

		// Get current active users (simulate Discord channel members)
		const userSessions = new Map<string, any[]>();
		for (const session of sessions) {
			if (!userSessions.has(session.userId)) {
				userSessions.set(session.userId, []);
			}
			userSessions.get(session.userId)!.push(session);
		}

		// Simulate current channel members (users who have recent sessions)
		const recentSessions = sessions.filter((s) => {
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
			return s.joinedAt > oneHourAgo || (s.leftAt && s.leftAt > oneHourAgo);
		});

		const currentMembers = new Set<string>();
		for (const session of recentSessions) {
			currentMembers.add(session.userId);
		}

		console.log(`\n👥 CURRENT CHANNEL MEMBERS (simulated):`);
		console.log("-".repeat(40));

		for (const userId of currentMembers) {
			const sessions = userSessions.get(userId)!;
			let totalDuration = 0;
			for (const session of sessions) {
				if (session.leftAt) {
					totalDuration +=
						session.leftAt.getTime() - session.joinedAt.getTime();
				}
			}
			const hours = Math.floor(totalDuration / (1000 * 60 * 60));
			const minutes = Math.floor(
				(totalDuration % (1000 * 60 * 60)) / (1000 * 60),
			);
			console.log(
				`👤 ${userId}: ${hours}h ${minutes}m (${sessions.length} sessions)`,
			);
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
				console.log("🔹 Would rename channel to new owner's name");
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

		// Find longest-standing user among current members
		if (currentMembers.size > 0) {
			const userDurations = new Map<string, number>();
			for (const userId of currentMembers) {
				const userSessionList = userSessions.get(userId)!;
				let totalDuration = 0;
				for (const session of userSessionList) {
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
		}

		console.log(`\n💡 INTEGRATION POINTS:`);
		console.log("-".repeat(20));
		console.log("🔹 checkAndAutoAssignOwnership() detects inactive owners");
		console.log("🔹 handleOrphanedChannel() removes inactive owners");
		console.log("🔹 Both methods assign ownership to longest user in channel");
		console.log("🔹 setChannelOwner() automatically renames the channel");
	} catch (error) {
		console.error("🔸 Error testing inactive owner detection:", error);
	} finally {
		process.exit(0);
	}
}

testInactiveOwnerDetection().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
