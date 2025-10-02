#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to auto-assign ownership to all channels that need it
 * This finds channels without owners that aren't named "Available Channel"
 */
async function autoAssignAllChannels() {
	console.log(`🤖 Auto-assigning ownership for all channels that need it\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Scanning channels in guild: ${config.guildId}\n`);

		// Get all voice sessions
		const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		console.log(`📈 Found ${sessions.length} total voice sessions\n`);

		// Group sessions by channel
		const channelSessions = new Map<string, any[]>();
		for (const session of sessions) {
			if (!channelSessions.has(session.channelId)) {
				channelSessions.set(session.channelId, []);
			}
			channelSessions.get(session.channelId)!.push(session);
		}

		console.log(`📺 Found ${channelSessions.size} unique channels\n`);

		// Check each channel
		const channelsToProcess = [];
		for (const [channelId, channelSessions] of channelSessions) {
			// Check if channel has owner
			const owner = await cache.getChannelOwner(channelId);
			if (owner) {
				continue; // Skip channels that already have owners
			}

			// Get channel name from first session
			const firstSession = channelSessions.sort(
				(a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
			)[0];
			const channelName = firstSession.channelName;

			// Skip "Available Channel" or similar
			if (channelName.toLowerCase().includes("available")) {
				continue;
			}

			channelsToProcess.push({
				channelId,
				channelName,
				sessions: channelSessions,
			});
		}

		console.log(
			`🔍 Found ${channelsToProcess.length} channels that need ownership assignment\n`,
		);

		if (channelsToProcess.length === 0) {
			console.log(
				"✅ All channels already have owners or are available channels",
			);
			return;
		}

		// Process each channel
		for (const channel of channelsToProcess) {
			console.log(
				`\n📺 Processing: "${channel.channelName}" (${channel.channelId})`,
			);

			// Find user with longest duration
			const userDurations = new Map<string, number>();
			for (const session of channel.sessions) {
				const duration = session.duration || 0;
				const existing = userDurations.get(session.userId) || 0;
				userDurations.set(session.userId, existing + duration);
			}

			if (userDurations.size === 0) {
				console.log("🔸 No users found with duration data - skipping");
				continue;
			}

			// Get longest-standing user
			const sortedUsers = Array.from(userDurations.entries()).sort(
				(a, b) => b[1] - a[1],
			);

			const [longestUserId, longestDuration] = sortedUsers[0];

			console.log(
				`👑 Assigning to: ${longestUserId} (${formatDuration(longestDuration)})`,
			);

			// Assign ownership
			await cache.setChannelOwner(channel.channelId, {
				userId: longestUserId,
				channelId: channel.channelId,
				guildId: config.guildId,
				createdAt: new Date(),
				lastActivity: new Date(),
			});

			console.log(`✅ Ownership assigned!`);
		}

		console.log(`\n📋 SUMMARY:`);
		console.log("=".repeat(50));
		console.log(`✅ Processed ${channelsToProcess.length} channels`);
		console.log(`👑 All channels now have owners based on longest duration`);
		console.log(`💡 Owners can now use channel management commands`);
	} catch (error) {
		console.error("🔸 Error auto-assigning all channels:", error);
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

// Run the script
autoAssignAllChannels()
	.then(() => {
		console.log("\n✅ Auto-assignment for all channels completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Auto-assignment for all channels failed:", error);
		process.exit(1);
	});
