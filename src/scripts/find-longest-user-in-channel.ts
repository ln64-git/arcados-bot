#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to find who has been in a specific channel the longest
 * This checks actual time spent in THIS channel, not historical data
 */
async function findLongestUserInChannel(channelId: string) {
	console.log(`🔍 Finding longest-standing user in channel: ${channelId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(
			`📊 Analyzing channel ${channelId} in guild: ${config.guildId}\n`,
		);

		// Get voice sessions for THIS specific channel only
		const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const channelSessions = sessions.filter((s) => s.channelId === channelId);

		if (channelSessions.length === 0) {
			console.log("🔸 No voice sessions found for this channel");
			return;
		}

		console.log(
			`📊 Found ${channelSessions.length} voice sessions for this channel`,
		);

		// Sort by join time
		channelSessions.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

		const firstSession = channelSessions[0];
		const lastSession = channelSessions[channelSessions.length - 1];

		console.log(`📅 First session: ${firstSession.joinedAt.toLocaleString()}`);
		console.log(
			`📅 Last session: ${lastSession.leftAt?.toLocaleString() || "Active"}`,
		);
		console.log(`📝 Channel name: "${firstSession.channelName}"`);

		// Calculate total duration for each user in THIS channel
		const userDurations = new Map<string, number>();
		for (const session of channelSessions) {
			const duration = session.duration || 0;
			const existing = userDurations.get(session.userId) || 0;
			userDurations.set(session.userId, existing + duration);
		}

		if (userDurations.size === 0) {
			console.log("🔸 No users found with duration data");
			return;
		}

		// Sort users by total duration in THIS channel
		const sortedUsers = Array.from(userDurations.entries()).sort(
			(a, b) => b[1] - a[1],
		);

		console.log(`\n👑 Users by total duration in THIS channel:`);
		for (let i = 0; i < Math.min(10, sortedUsers.length); i++) {
			const [userId, duration] = sortedUsers[i];
			const marker = i === 0 ? "👑" : "👤";
			console.log(`  ${marker} ${userId} (${formatDuration(duration)})`);
		}

		// Get current owner
		const currentOwner = await cache.getChannelOwner(channelId);
		if (currentOwner) {
			const currentOwnerDuration = userDurations.get(currentOwner.userId) || 0;
			const currentOwnerRank =
				sortedUsers.findIndex(([userId]) => userId === currentOwner.userId) + 1;

			console.log(`\n👤 Current owner: ${currentOwner.userId}`);
			console.log(
				`⏰ Current owner's duration: ${formatDuration(currentOwnerDuration)}`,
			);
			console.log(`📊 Current owner's rank: #${currentOwnerRank}`);
		}

		// Get the longest-standing user
		const [longestUserId, longestDuration] = sortedUsers[0];

		console.log(`\n🎯 ANALYSIS:`);
		console.log(`👑 Longest-standing user: ${longestUserId}`);
		console.log(`⏰ Total duration: ${formatDuration(longestDuration)}`);
		console.log(`📝 Channel: "${firstSession.channelName}"`);

		if (currentOwner && currentOwner.userId === longestUserId) {
			console.log(
				`✅ Current owner is correct - they have the longest duration`,
			);
		} else {
			console.log(`🔸 Current owner is NOT the longest-standing user`);
			console.log(`💡 Ownership should be transferred to ${longestUserId}`);

			console.log(`\n🔧 RECOMMENDED ACTION:`);
			if (currentOwner) {
				console.log(
					`1. Transfer ownership from ${currentOwner.userId} to ${longestUserId}`,
				);
				console.log(
					`2. Reason: ${longestUserId} has spent ${formatDuration(longestDuration)} in this channel`,
				);
				console.log(`\n🔧 To fix this, run:`);
				console.log(
					`   npx tsx src/scripts/transfer-channel-ownership.ts ${channelId} ${currentOwner.userId} ${longestUserId}`,
				);
			} else {
				console.log(`1. Assign ownership to ${longestUserId}`);
				console.log(
					`2. Reason: ${longestUserId} has spent ${formatDuration(longestDuration)} in this channel`,
				);
				console.log(`\n🔧 To fix this, run:`);
				console.log(
					`   npx tsx src/scripts/auto-assign-ownership.ts ${channelId}`,
				);
			}
		}

		// Show recent activity
		console.log(`\n📋 Recent Activity (last 10 sessions):`);
		const recentSessions = channelSessions.slice(-10);
		for (const session of recentSessions) {
			const duration = session.duration
				? formatDuration(session.duration)
				: "Active";
			const status = session.leftAt ? "✅ Completed" : "🟢 Active";
			console.log(
				`  ${session.joinedAt.toLocaleString()} | ${session.userId} | ${duration} | ${status}`,
			);
		}
	} catch (error) {
		console.error("🔸 Error finding longest user in channel:", error);
		process.exit(1);
	}
}

/**
 * Format duration in seconds to human readable format
 */
function formatDuration(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	if (days > 0) {
		return `${days}d ${hours}h ${minutes}m`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${secs}s`;
	}
	return `${secs}s`;
}

// Get channel ID from command line argument
const channelId = process.argv[2];
if (!channelId) {
	console.error("🔸 Please provide a channel ID as an argument");
	console.log("Usage: tsx find-longest-user-in-channel.ts <channelId>");
	process.exit(1);
}

// Run the script
findLongestUserInChannel(channelId)
	.then(() => {
		console.log("\n✅ Longest user analysis completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Longest user analysis failed:", error);
		process.exit(1);
	});
