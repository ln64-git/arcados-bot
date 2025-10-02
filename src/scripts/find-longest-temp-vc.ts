#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";
import type { VoiceSession } from "../types/database.js";

/**
 * Get all unique channel names for a specific channel during a time period
 */
async function getChannelNameHistory(
	channelId: string,
	startTime: Date,
	endTime: Date,
): Promise<Array<{ channelName: string; timestamp: Date }>> {
	const dbCore = new DatabaseCore();
	await dbCore.initialize();

	if (!config.guildId) {
		throw new Error("🔸 GUILD_ID not configured in environment variables");
	}

	// Get all voice sessions for this specific channel during the time period
	const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);

	const channelSessions = allSessions.filter((session) => {
		return (
			session.channelId === channelId &&
			session.joinedAt >= startTime &&
			session.joinedAt <= endTime
		);
	});

	// Create a map of unique channel names with their earliest timestamp
	const nameMap = new Map<string, Date>();

	for (const session of channelSessions) {
		const existingTimestamp = nameMap.get(session.channelName);
		if (!existingTimestamp || session.joinedAt < existingTimestamp) {
			nameMap.set(session.channelName, session.joinedAt);
		}
	}

	// Convert to array and sort by timestamp
	const nameHistory = Array.from(nameMap.entries())
		.map(([channelName, timestamp]) => ({ channelName, timestamp }))
		.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

	return nameHistory;
}

/**
 * Script to find the longest running temporary voice channel in server history
 * Excludes "Cantina" and "Dojo" channels
 */
async function findLongestTempVC() {
	console.log(
		"🔍 Searching for the longest running temporary voice channel...\n",
	);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Analyzing voice sessions for guild: ${config.guildId}\n`);

		// Get all voice sessions for the guild
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		console.log(`📈 Found ${allSessions.length} total voice sessions\n`);

		// Filter out Cantina and Dojo channels, and only include completed sessions
		const filteredSessions = allSessions.filter((session: VoiceSession) => {
			const channelName = session.channelName.toLowerCase();
			const isExcluded =
				channelName.includes("cantina") || channelName.includes("dojo");
			const hasDuration = session.duration && session.duration > 0;
			const hasLeftAt = session.leftAt;

			return !isExcluded && hasDuration && hasLeftAt;
		});

		console.log(
			`🔧 After filtering (excluding Cantina/Dojo, completed sessions): ${filteredSessions.length} sessions\n`,
		);

		if (filteredSessions.length === 0) {
			console.log(
				"❌ No completed voice sessions found (excluding Cantina/Dojo)",
			);
			return;
		}

		// Sort by duration (longest first)
		const sortedSessions = filteredSessions.sort(
			(a, b) => (b.duration || 0) - (a.duration || 0),
		);

		// Display top 10 longest sessions
		console.log("🏆 TOP 10 LONGEST RUNNING TEMPORARY VOICE CHANNELS:\n");
		console.log("Rank | Duration | Channel Name | Joined At | Left At");
		console.log("-----|----------|--------------|-----------|--------");

		const topSessions = sortedSessions.slice(0, 10);

		topSessions.forEach((session, index) => {
			const rank = (index + 1).toString().padStart(4);
			const duration = formatDuration(session.duration || 0);
			const channelName = session.channelName.padEnd(12);
			const joinedAt = session.joinedAt.toLocaleDateString();
			const leftAt = session.leftAt?.toLocaleDateString() || "N/A";

			console.log(
				`${rank} | ${duration} | ${channelName} | ${joinedAt} | ${leftAt}`,
			);
		});

		// Highlight the longest session
		const longestSession = sortedSessions[0];
		console.log(`\n${"=".repeat(60)}`);
		console.log("🥇 LONGEST RUNNING TEMPORARY VOICE CHANNEL:");
		console.log("=".repeat(60));
		console.log(`📺 Channel Name: ${longestSession.channelName}`);
		console.log(`⏱️  Duration: ${formatDuration(longestSession.duration || 0)}`);
		console.log(`📅 Joined: ${longestSession.joinedAt.toLocaleString()}`);
		console.log(`📅 Left: ${longestSession.leftAt?.toLocaleString() || "N/A"}`);
		console.log(`👤 User ID: ${longestSession.userId}`);
		console.log(`🆔 Channel ID: ${longestSession.channelId}`);

		// Find all channel name changes for this channel during this time period
		const channelNameHistory = await getChannelNameHistory(
			longestSession.channelId,
			longestSession.joinedAt,
			longestSession.leftAt || new Date(),
		);

		if (channelNameHistory.length > 1) {
			console.log("\n📝 CHANNEL NAME HISTORY:");
			console.log("-".repeat(40));
			channelNameHistory.forEach((entry, index) => {
				const timestamp = entry.timestamp.toLocaleString();
				const isLast = index === channelNameHistory.length - 1;
				const marker = isLast ? "🏁" : "📝";
				console.log(`${marker} ${timestamp}: "${entry.channelName}"`);
			});
		} else {
			console.log("\n📝 Channel name remained unchanged during this session");
		}

		console.log("=".repeat(60));

		// Additional statistics
		const totalDuration = filteredSessions.reduce(
			(sum, session) => sum + (session.duration || 0),
			0,
		);
		const averageDuration = totalDuration / filteredSessions.length;

		console.log("\n📊 STATISTICS:");
		console.log(`📈 Total sessions analyzed: ${filteredSessions.length}`);
		console.log(`⏱️  Total time in voice: ${formatDuration(totalDuration)}`);
		console.log(
			`📊 Average session duration: ${formatDuration(averageDuration)}`,
		);
		console.log(
			`🏆 Longest session: ${formatDuration(longestSession.duration || 0)}`,
		);
	} catch (error) {
		console.error("🔸 Error finding longest temp VC:", error);
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
		return `${days}d ${hours}h ${minutes}m ${secs}s`.padStart(15);
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m ${secs}s`.padStart(15);
	}
	if (minutes > 0) {
		return `${minutes}m ${secs}s`.padStart(15);
	}
	return `${secs}s`.padStart(15);
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
	findLongestTempVC()
		.then(() => {
			console.log("\n✅ Script completed successfully!");
			process.exit(0);
		})
		.catch((error) => {
			console.error("🔸 Script failed:", error);
			process.exit(1);
		});
}

export { findLongestTempVC };
