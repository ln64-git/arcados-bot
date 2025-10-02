#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to analyze and fix channel ownership discrepancies
 * This handles cases where the database shows an owner but the channel doesn't behave as owned
 */
async function analyzeChannelOwnership(channelId: string) {
	console.log(`🔍 Analyzing ownership for channel: ${channelId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Analyzing channel ownership in guild: ${config.guildId}\n`);

		// Get owner from database
		const owner = await cache.getChannelOwner(channelId);

		if (!owner) {
			console.log("🔸 No owner found in database");

			// Check voice sessions to see if channel has been used
			const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
			const channelSessions = sessions.filter((s) => s.channelId === channelId);

			if (channelSessions.length > 0) {
				console.log(
					`📊 Found ${channelSessions.length} voice sessions for this channel`,
				);

				// Sort by join time
				channelSessions.sort(
					(a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
				);

				const firstSession = channelSessions[0];
				const lastSession = channelSessions[channelSessions.length - 1];

				console.log(
					`📅 First session: ${firstSession.joinedAt.toLocaleString()}`,
				);
				console.log(
					`📅 Last session: ${lastSession.leftAt?.toLocaleString() || "Active"}`,
				);
				console.log(`📝 Channel name: "${firstSession.channelName}"`);

				// Find potential owners
				const uniqueUsers = new Set(channelSessions.map((s) => s.userId));
				console.log(`👥 Total unique users: ${uniqueUsers.size}`);

				// Find user with longest total duration
				const userDurations = new Map<string, number>();
				for (const session of channelSessions) {
					const duration = session.duration || 0;
					const existing = userDurations.get(session.userId) || 0;
					userDurations.set(session.userId, existing + duration);
				}

				if (userDurations.size > 0) {
					const sortedUsers = Array.from(userDurations.entries()).sort(
						(a, b) => b[1] - a[1],
					);

					console.log(`\n👑 Potential owners (by total duration):`);
					for (let i = 0; i < Math.min(5, sortedUsers.length); i++) {
						const [userId, duration] = sortedUsers[i];
						const marker = i === 0 ? "👑" : "👤";
						console.log(`  ${marker} ${userId} (${formatDuration(duration)})`);
					}

					const [longestUserId, longestDuration] = sortedUsers[0];
					console.log(
						`\n💡 RECOMMENDATION: Assign ownership to ${longestUserId}`,
					);
					console.log(
						`   Reason: Longest total duration (${formatDuration(longestDuration)})`,
					);

					// Ask if user wants to assign ownership
					console.log(`\n🔧 To assign ownership, run:`);
					console.log(
						`   npx tsx src/scripts/assign-channel-ownership.ts ${channelId} ${longestUserId}`,
					);
				}
			} else {
				console.log("🔸 No voice sessions found for this channel");
				console.log("💡 This channel may have been deleted or never used");
			}
		} else {
			console.log(`👤 Database shows owner: ${owner.userId}`);
			console.log(`📅 Created: ${owner.createdAt.toLocaleString()}`);
			console.log(`⏰ Last Activity: ${owner.lastActivity.toLocaleString()}`);

			if (owner.previousOwnerId) {
				console.log(`🔄 Previous Owner: ${owner.previousOwnerId}`);
			}

			// Check if owner has been active recently
			const timeSinceActivity = Date.now() - owner.lastActivity.getTime();
			const hoursSinceActivity = timeSinceActivity / (1000 * 60 * 60);

			console.log(
				`⏱️  Time since last activity: ${hoursSinceActivity.toFixed(2)} hours`,
			);

			if (hoursSinceActivity > 24) {
				console.log(`🔸 Owner has been inactive for over 24 hours`);

				// Check voice sessions to see if someone else should be owner
				const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
				const channelSessions = sessions.filter(
					(s) => s.channelId === channelId,
				);

				if (channelSessions.length > 0) {
					// Find recent activity
					const recentSessions = channelSessions.filter((s) => {
						const sessionTime = s.joinedAt.getTime();
						return sessionTime > owner.lastActivity.getTime();
					});

					if (recentSessions.length > 0) {
						console.log(
							`📊 Found ${recentSessions.length} sessions after owner's last activity`,
						);

						// Find user with most recent activity
						const recentUsers = new Map<string, Date>();
						for (const session of recentSessions) {
							const existing = recentUsers.get(session.userId);
							if (!existing || session.joinedAt > existing) {
								recentUsers.set(session.userId, session.joinedAt);
							}
						}

						const sortedRecentUsers = Array.from(recentUsers.entries()).sort(
							(a, b) => b[1].getTime() - a[1].getTime(),
						);

						if (sortedRecentUsers.length > 0) {
							const [recentUserId, recentTime] = sortedRecentUsers[0];
							console.log(
								`👤 Most recent active user: ${recentUserId} (${recentTime.toLocaleString()})`,
							);
							console.log(
								`\n💡 RECOMMENDATION: Consider transferring ownership to ${recentUserId}`,
							);
							console.log(`   Reason: More recent activity than current owner`);
							console.log(`\n🔧 To transfer ownership, run:`);
							console.log(
								`   npx tsx src/scripts/transfer-channel-ownership.ts ${channelId} ${owner.userId} ${recentUserId}`,
							);
						}
					} else {
						console.log(`📊 No activity found after owner's last activity`);
						console.log(`💡 Current owner may still be appropriate`);
					}
				}
			} else {
				console.log(`✅ Owner has been active recently`);
			}
		}

		console.log("\n📋 SUMMARY:");
		console.log("=".repeat(50));

		if (owner) {
			console.log(`✅ Channel has owner: ${owner.userId}`);
			console.log(`📅 Owner since: ${owner.createdAt.toLocaleString()}`);
			console.log(`⏰ Last activity: ${owner.lastActivity.toLocaleString()}`);

			const timeSinceActivity = Date.now() - owner.lastActivity.getTime();
			const hoursSinceActivity = timeSinceActivity / (1000 * 60 * 60);

			if (hoursSinceActivity > 24) {
				console.log(
					`⚠️  Owner inactive for ${hoursSinceActivity.toFixed(2)} hours`,
				);
				console.log(`💡 Consider checking if owner is still in Discord`);
			} else {
				console.log(`✅ Owner appears active`);
			}
		} else {
			console.log(`🔸 Channel has no owner`);
			console.log(`💡 Consider assigning ownership to longest-standing user`);
		}
	} catch (error) {
		console.error("🔸 Error analyzing channel ownership:", error);
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
	console.log("Usage: tsx analyze-channel-ownership.ts <channelId>");
	process.exit(1);
}

// Run the script
analyzeChannelOwnership(channelId)
	.then(() => {
		console.log("\n✅ Channel ownership analysis completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Channel ownership analysis failed:", error);
		process.exit(1);
	});
