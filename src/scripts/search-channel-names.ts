#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";
import type { VoiceSession } from "../types/database.js";

/**
 * Script to search for specific channel names in the database
 */
async function searchChannelNames() {
	console.log("🔍 Searching for channel names in database...\n");

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

		// Get all unique channel names
		const uniqueChannelNames = new Set<string>();
		for (const session of allSessions) {
			uniqueChannelNames.add(session.channelName);
		}

		console.log(`📋 Found ${uniqueChannelNames.size} unique channel names\n`);

		// Search for channels that might contain "lana" or "alex" (case insensitive)
		const searchTerms = ["lana", "alex", "verified"];
		const matchingChannels = new Set<string>();

		for (const channelName of uniqueChannelNames) {
			const lowerName = channelName.toLowerCase();
			for (const term of searchTerms) {
				if (lowerName.includes(term)) {
					matchingChannels.add(channelName);
					break;
				}
			}
		}

		console.log(
			`🔍 Found ${matchingChannels.size} channels matching search terms: ${Array.from(matchingChannels).join(", ")}\n`,
		);

		if (matchingChannels.size === 0) {
			console.log("❌ No channels found matching search terms");
			console.log("\n📋 All unique channel names:");
			const sortedNames = Array.from(uniqueChannelNames).sort();
			for (let i = 0; i < Math.min(50, sortedNames.length); i++) {
				console.log(`  ${i + 1}. ${sortedNames[i]}`);
			}
			if (sortedNames.length > 50) {
				console.log(`  ... and ${sortedNames.length - 50} more`);
			}
			return;
		}

		// Analyze each matching channel
		for (const channelName of matchingChannels) {
			const channelSessions = allSessions.filter(
				(session) => session.channelName === channelName,
			);

			console.log(`\n📺 Channel: "${channelName}"`);
			console.log(`📊 Sessions: ${channelSessions.length}`);

			if (channelSessions.length > 0) {
				// Sort by join time
				channelSessions.sort(
					(a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
				);

				const firstSession = channelSessions[0];
				const lastSession = channelSessions[channelSessions.length - 1];

				console.log(`📅 First seen: ${firstSession.joinedAt.toLocaleString()}`);
				console.log(
					`📅 Last seen: ${lastSession.leftAt?.toLocaleString() || "Active"}`,
				);
				console.log(`🆔 Channel ID: ${firstSession.channelId}`);

				// Show unique users who used this channel
				const uniqueUsers = new Set(channelSessions.map((s) => s.userId));
				console.log(`👥 Unique users: ${uniqueUsers.size}`);

				// Show recent sessions
				console.log("\n📋 Recent sessions (last 5):");
				const recentSessions = channelSessions.slice(-5);
				for (const session of recentSessions) {
					const duration = session.duration
						? formatDuration(session.duration)
						: "Active";
					console.log(
						`  ${session.joinedAt.toLocaleString()} | ${session.userId.substring(0, 8)}... | ${duration}`,
					);
				}
			}
			console.log("-".repeat(60));
		}
	} catch (error) {
		console.error("🔸 Error searching channel names:", error);
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
if (import.meta.url === `file://${process.argv[1]}`) {
	searchChannelNames()
		.then(() => {
			console.log("\n✅ Search completed!");
			process.exit(0);
		})
		.catch((error) => {
			console.error("🔸 Search failed:", error);
			process.exit(1);
		});
}

export { searchChannelNames };
