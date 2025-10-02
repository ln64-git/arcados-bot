#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to auto-assign ownership to longest-standing user
 * This handles channels that don't have owners and aren't named "Available Channel"
 */
async function autoAssignOwnership(channelId: string) {
	console.log(`🤖 Auto-assigning ownership for channel: ${channelId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Auto-assigning ownership in guild: ${config.guildId}\n`);

		// Check if channel already has an owner
		const existingOwner = await cache.getChannelOwner(channelId);
		if (existingOwner) {
			console.log(`✅ Channel already has owner: ${existingOwner.userId}`);
			console.log("💡 No action needed");
			return;
		}

		console.log("🔸 Channel has no owner - proceeding with auto-assignment\n");

		// Get voice sessions for this channel
		const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const channelSessions = sessions.filter((s) => s.channelId === channelId);

		if (channelSessions.length === 0) {
			console.log("🔸 No voice sessions found for this channel");
			console.log("💡 Channel may have been deleted or never used");
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

		// Check if channel is named "Available Channel" (should not auto-assign)
		if (firstSession.channelName.toLowerCase().includes("available")) {
			console.log(
				"🔸 Channel is named 'Available Channel' - skipping auto-assignment",
			);
			console.log("💡 Available channels should remain unowned");
			return;
		}

		// Find user with longest total duration in this channel
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

		// Sort users by total duration
		const sortedUsers = Array.from(userDurations.entries()).sort(
			(a, b) => b[1] - a[1],
		);

		console.log(`\n👑 Users by total duration:`);
		for (let i = 0; i < Math.min(5, sortedUsers.length); i++) {
			const [userId, duration] = sortedUsers[i];
			const marker = i === 0 ? "👑" : "👤";
			console.log(`  ${marker} ${userId} (${formatDuration(duration)})`);
		}

		// Get the user with longest duration
		const [longestUserId, longestDuration] = sortedUsers[0];

		console.log(`\n🤖 AUTO-ASSIGNING OWNERSHIP:`);
		console.log(`👤 New owner: ${longestUserId}`);
		console.log(
			`⏰ Reason: Longest total duration (${formatDuration(longestDuration)})`,
		);
		console.log(`📝 Channel: "${firstSession.channelName}"`);

		// Assign ownership
		await cache.setChannelOwner(channelId, {
			userId: longestUserId,
			channelId,
			guildId: config.guildId,
			createdAt: new Date(),
			lastActivity: new Date(),
		});

		console.log(`✅ Ownership assigned successfully!`);

		// Show ownership details
		console.log(`\n📋 OWNERSHIP DETAILS:`);
		console.log("=".repeat(50));
		console.log(`👤 Owner: ${longestUserId}`);
		console.log(`📅 Assigned: ${new Date().toLocaleString()}`);
		console.log(`📝 Channel: "${firstSession.channelName}"`);
		console.log(`⏰ Total time: ${formatDuration(longestDuration)}`);
		console.log(`📊 Sessions: ${channelSessions.length}`);

		console.log(`\n💡 The new owner can now:`);
		console.log(`- Use /rename to change the channel name`);
		console.log(`- Use /limit to set user limits`);
		console.log(`- Use /lock to lock/unlock the channel`);
		console.log(`- Use moderation commands like /kick, /mute, etc.`);
	} catch (error) {
		console.error("🔸 Error auto-assigning ownership:", error);
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
	console.log("Usage: tsx auto-assign-ownership.ts <channelId>");
	process.exit(1);
}

// Run the script
autoAssignOwnership(channelId)
	.then(() => {
		console.log("\n✅ Auto-assignment completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Auto-assignment failed:", error);
		process.exit(1);
	});
