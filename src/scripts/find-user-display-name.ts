#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to find user display name from voice session data
 */
async function findUserDisplayName(userId: string) {
	console.log(`🔍 Looking up display name for user: ${userId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Searching voice sessions in guild: ${config.guildId}\n`);

		// Get all voice sessions for the guild
		const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		console.log(`📈 Found ${sessions.length} total voice sessions\n`);

		// Find sessions for this specific user
		const userSessions = sessions.filter((s) => s.userId === userId);

		if (userSessions.length === 0) {
			console.log("🔸 No voice sessions found for this user");
			console.log("💡 This user may have never joined a voice channel");
			return;
		}

		console.log(
			`📊 Found ${userSessions.length} voice sessions for this user\n`,
		);

		// Sort by join time to see chronological order
		userSessions.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

		const firstSession = userSessions[0];
		const lastSession = userSessions[userSessions.length - 1];

		console.log(`📅 First session: ${firstSession.joinedAt.toLocaleString()}`);
		console.log(
			`📅 Last session: ${lastSession.leftAt?.toLocaleString() || "Active"}`,
		);
		console.log(`📝 Channel name: "${firstSession.channelName}"`);

		// Extract display name from channel name pattern
		// Channel names typically follow pattern: "DisplayName's Room | #123"
		const channelName = firstSession.channelName;
		const displayNameMatch = channelName.match(/^(.+?)'s Room/);

		if (displayNameMatch) {
			const displayName = displayNameMatch[1];
			console.log(`\n✅ DISPLAY NAME FOUND: "${displayName}"`);
			console.log(`📝 Extracted from channel name: "${channelName}"`);
		} else {
			console.log(
				`\n🔸 Could not extract display name from channel name: "${channelName}"`,
			);
			console.log(`💡 Channel name doesn't follow expected pattern`);
		}

		// Show all channel names this user has been in
		const uniqueChannelNames = [
			...new Set(userSessions.map((s) => s.channelName)),
		];
		console.log(`\n📺 Channels this user has been in:`);
		for (const channelName of uniqueChannelNames) {
			console.log(`  📝 "${channelName}"`);
		}

		// Calculate total time in voice
		const totalDuration = userSessions.reduce((total, session) => {
			return total + (session.duration || 0);
		}, 0);

		console.log(`\n⏰ Total time in voice: ${formatDuration(totalDuration)}`);

		// Show recent activity
		console.log(`\n📋 Recent Activity (last 10 sessions):`);
		const recentSessions = userSessions.slice(-10);
		for (const session of recentSessions) {
			const duration = session.duration
				? formatDuration(session.duration)
				: "Active";
			const status = session.leftAt ? "✅ Completed" : "🟢 Active";
			console.log(
				`  ${session.joinedAt.toLocaleString()} | "${session.channelName}" | ${duration} | ${status}`,
			);
		}
	} catch (error) {
		console.error("🔸 Error looking up user display name:", error);
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

// Get user ID from command line argument
const userId = process.argv[2];
if (!userId) {
	console.error("🔸 Please provide a user ID as an argument");
	console.log("Usage: tsx find-user-display-name.ts <userId>");
	process.exit(1);
}

// Run the script
findUserDisplayName(userId)
	.then(() => {
		console.log("\n✅ User lookup completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 User lookup failed:", error);
		process.exit(1);
	});
