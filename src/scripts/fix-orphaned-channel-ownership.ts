#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to fix channel ownership when owner is no longer in the channel
 * This handles cases where the database shows an owner but they're not actually in Discord
 */
async function fixOrphanedChannelOwnership(channelId: string) {
	console.log(`🔧 Fixing orphaned ownership for channel: ${channelId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Fixing orphaned ownership in guild: ${config.guildId}\n`);

		// Get owner from database
		const owner = await cache.getChannelOwner(channelId);

		if (!owner) {
			console.log("🔸 No owner found in database - nothing to fix");
			return;
		}

		console.log(`👤 Database shows owner: ${owner.userId} (marvinsdc)`);
		console.log(`📅 Created: ${owner.createdAt.toLocaleString()}`);
		console.log(`⏰ Last Activity: ${owner.lastActivity.toLocaleString()}`);

		// Get voice sessions for this channel
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
			console.log(`📝 Database channel name: "${firstSession.channelName}"`);

			// Check if owner has sessions in this channel
			const ownerSessions = channelSessions.filter(
				(s) => s.userId === owner.userId,
			);
			console.log(`\n👤 Owner's sessions: ${ownerSessions.length}`);

			if (ownerSessions.length > 0) {
				// Check owner's last activity
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

				if (!ownerActive) {
					console.log("🔸 Owner is not currently active in channel");
					console.log("💡 This explains why the channel appears unowned");

					// Find who should be the new owner
					const activeUsers = new Set(activeSessions.map((s) => s.userId));
					console.log(`👥 Currently active users: ${activeUsers.size}`);

					if (activeUsers.size > 0) {
						console.log(`\n👥 Active users in channel:`);
						for (const userId of activeUsers) {
							console.log(`  👤 ${userId}`);
						}

						// Find user with longest total duration who's currently active
						const userDurations = new Map<string, number>();
						for (const session of channelSessions) {
							const duration = session.duration || 0;
							const existing = userDurations.get(session.userId) || 0;
							userDurations.set(session.userId, existing + duration);
						}

						const sortedUsers = Array.from(userDurations.entries()).sort(
							(a, b) => b[1] - a[1],
						);

						// Find the first user who's currently active
						let newOwnerId = null;
						for (const [userId, duration] of sortedUsers) {
							if (activeUsers.has(userId)) {
								newOwnerId = userId;
								console.log(
									`\n👑 Recommended new owner: ${userId} (${formatDuration(duration)} total time)`,
								);
								break;
							}
						}

						if (newOwnerId) {
							console.log(`\n🔧 RECOMMENDED ACTION:`);
							console.log(
								`1. Remove current ownership (marvinsdc is not in channel)`,
							);
							console.log(
								`2. Assign ownership to ${newOwnerId} (currently active)`,
							);
							console.log(`\n🔧 To fix this, run:`);
							console.log(
								`   npx tsx src/scripts/transfer-channel-ownership.ts ${channelId} ${owner.userId} ${newOwnerId}`,
							);
						} else {
							console.log(`\n🔧 RECOMMENDED ACTION:`);
							console.log(
								`1. Remove current ownership (marvinsdc is not in channel)`,
							);
							console.log(`2. Leave channel unowned until someone claims it`);
							console.log(`\n🔧 To fix this, run:`);
							console.log(
								`   npx tsx src/scripts/remove-channel-ownership.ts ${channelId}`,
							);
						}
					} else {
						console.log("🔸 No active users in channel");
						console.log("💡 Channel should be deleted or ownership removed");
					}
				} else {
					console.log("✅ Owner is currently active in channel");
					console.log("💡 Database appears to be correct");
				}
			} else {
				console.log("🔸 Owner has never been in this channel!");
				console.log("💡 This is a critical database error");
			}
		} else {
			console.log("🔸 No voice sessions found for this channel");
			console.log("💡 Channel may have been deleted or is unused");
		}

		console.log(`\n📋 SUMMARY:`);
		console.log("=".repeat(50));
		console.log(
			"🔸 ISSUE: Database shows marvinsdc as owner but they're not in Discord",
		);
		console.log("💡 CAUSE: Database is out of sync with Discord state");
		console.log(
			"🔧 SOLUTION: Transfer ownership to someone currently in the channel",
		);
	} catch (error) {
		console.error("🔸 Error fixing orphaned ownership:", error);
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
	console.log("Usage: tsx fix-orphaned-channel-ownership.ts <channelId>");
	process.exit(1);
}

// Run the script
fixOrphanedChannelOwnership(channelId)
	.then(() => {
		console.log("\n✅ Orphaned ownership fix completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Orphaned ownership fix failed:", error);
		process.exit(1);
	});
