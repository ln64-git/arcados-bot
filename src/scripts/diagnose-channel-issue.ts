#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to diagnose specific channel ownership issues
 * This helps identify why a channel might not behave as owned despite having an owner
 */
async function diagnoseChannelIssue(channelId: string) {
	console.log(`🔍 Diagnosing issues for channel: ${channelId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Diagnosing channel issues in guild: ${config.guildId}\n`);

		// Get owner from database
		const owner = await cache.getChannelOwner(channelId);

		if (!owner) {
			console.log("🔸 ISSUE: No owner found in database");
			console.log("💡 SOLUTION: Channel needs ownership assignment");
			return;
		}

		console.log(`👤 Owner found: ${owner.userId}`);
		console.log(`📅 Created: ${owner.createdAt.toLocaleString()}`);
		console.log(`⏰ Last Activity: ${owner.lastActivity.toLocaleString()}`);

		// Check voice sessions for this channel
		const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const channelSessions = sessions.filter((s) => s.channelId === channelId);

		console.log(`\n📊 Voice Session Analysis:`);
		console.log(`📈 Total sessions: ${channelSessions.length}`);

		if (channelSessions.length > 0) {
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

			// Check if owner has sessions in this channel
			const ownerSessions = channelSessions.filter(
				(s) => s.userId === owner.userId,
			);
			console.log(`\n👤 Owner's sessions: ${ownerSessions.length}`);

			if (ownerSessions.length === 0) {
				console.log("🔸 ISSUE: Owner has never been in this channel!");
				console.log("💡 This suggests the ownership was assigned incorrectly");

				// Find who should be the owner
				const uniqueUsers = new Set(channelSessions.map((s) => s.userId));
				console.log(
					`\n👥 Users who have been in this channel: ${uniqueUsers.size}`,
				);

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

					console.log(`\n👑 Users by total duration:`);
					for (let i = 0; i < Math.min(5, sortedUsers.length); i++) {
						const [userId, duration] = sortedUsers[i];
						const marker = i === 0 ? "👑" : "👤";
						console.log(`  ${marker} ${userId} (${formatDuration(duration)})`);
					}

					const [correctOwnerId, duration] = sortedUsers[0];
					console.log(
						`\n💡 RECOMMENDATION: Transfer ownership to ${correctOwnerId}`,
					);
					console.log(
						`   Reason: Owner has never been in channel, ${correctOwnerId} has longest duration`,
					);
					console.log(`\n🔧 To fix this, run:`);
					console.log(
						`   npx tsx src/scripts/transfer-channel-ownership.ts ${channelId} ${owner.userId} ${correctOwnerId}`,
					);
				}
			} else {
				console.log("✅ Owner has been in this channel");

				// Check owner's last activity in this channel
				const ownerLastSession = ownerSessions.reduce((latest, current) =>
					current.joinedAt > latest.joinedAt ? current : latest,
				);

				console.log(
					`📅 Owner's last session: ${ownerLastSession.joinedAt.toLocaleString()}`,
				);
				console.log(
					`⏰ Owner's last activity: ${ownerLastSession.leftAt?.toLocaleString() || "Active"}`,
				);

				// Check if owner is currently active
				const activeSessions = channelSessions.filter((s) => !s.leftAt);
				const ownerActive = activeSessions.some(
					(s) => s.userId === owner.userId,
				);

				if (ownerActive) {
					console.log("✅ Owner is currently active in channel");
				} else {
					console.log("🔸 Owner is not currently active in channel");

					// Check if there are other active users
					const activeUsers = new Set(activeSessions.map((s) => s.userId));
					console.log(`👥 Currently active users: ${activeUsers.size}`);

					if (activeUsers.size > 0) {
						console.log("💡 Channel has active users but owner is not active");
						console.log("🔸 This might cause permission issues");
					}
				}
			}
		} else {
			console.log("🔸 No voice sessions found for this channel");
			console.log("💡 This channel may have been deleted or never used");
		}

		// Check for potential issues
		console.log(`\n🔍 POTENTIAL ISSUES:`);
		console.log("=".repeat(50));

		const ownerSessions = channelSessions.filter(
			(s) => s.userId === owner.userId,
		);

		if (ownerSessions.length === 0) {
			console.log("🔸 CRITICAL: Owner has never been in this channel");
			console.log("   This will cause all ownership-based commands to fail");
		}

		const timeSinceActivity = Date.now() - owner.lastActivity.getTime();
		const hoursSinceActivity = timeSinceActivity / (1000 * 60 * 60);

		if (hoursSinceActivity > 24) {
			console.log(
				`🔸 WARNING: Owner inactive for ${hoursSinceActivity.toFixed(2)} hours`,
			);
			console.log("   Commands may fail if owner is no longer in Discord");
		}

		if (channelSessions.length === 0) {
			console.log("🔸 WARNING: No voice sessions found");
			console.log("   Channel may have been deleted or is unused");
		}

		console.log(`\n📋 DIAGNOSIS SUMMARY:`);
		console.log("=".repeat(50));

		if (ownerSessions.length === 0) {
			console.log("🔸 PROBLEM: Owner has never been in this channel");
			console.log(
				"💡 SOLUTION: Transfer ownership to someone who has used the channel",
			);
		} else if (hoursSinceActivity > 24) {
			console.log("🔸 PROBLEM: Owner has been inactive for over 24 hours");
			console.log(
				"💡 SOLUTION: Check if owner is still in Discord, consider transfer",
			);
		} else {
			console.log("✅ Channel ownership appears to be working correctly");
			console.log(
				"💡 If you're still experiencing issues, check Discord permissions",
			);
		}
	} catch (error) {
		console.error("🔸 Error diagnosing channel issues:", error);
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
	console.log("Usage: tsx diagnose-channel-issue.ts <channelId>");
	process.exit(1);
}

// Run the script
diagnoseChannelIssue(channelId)
	.then(() => {
		console.log("\n✅ Channel diagnosis completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Channel diagnosis failed:", error);
		process.exit(1);
	});
