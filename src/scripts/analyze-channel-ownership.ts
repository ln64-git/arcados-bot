#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";
import type { VoiceSession } from "../types/database.js";

/**
 * Script to analyze channel ownership transfers and permission issues
 * Focus on Lana's Channel -> alex's Channel transition
 */
async function analyzeChannelOwnership() {
	console.log(
		"🔍 Analyzing channel ownership transfers and permission issues...\n",
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

		// Focus on the specific channels we found
		const targetChannels = [
			"Lana's Channel",
			"alex's Channel",
			"┗ Lana's Channel",
			"┗ alex's Channel",
		];

		console.log("🎯 ANALYZING TARGET CHANNELS:\n");
		console.log("=".repeat(80));

		for (const channelName of targetChannels) {
			const channelSessions = allSessions.filter(
				(session) => session.channelName === channelName,
			);

			if (channelSessions.length === 0) continue;

			console.log(`\n📺 Channel: "${channelName}"`);
			console.log(`🆔 Channel ID: ${channelSessions[0].channelId}`);
			console.log(`📊 Total Sessions: ${channelSessions.length}`);

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

			// Analyze ownership patterns
			const uniqueUsers = new Set(channelSessions.map((s) => s.userId));
			console.log(`👥 Unique users: ${uniqueUsers.size}`);

			// Find potential ownership transfers
			const userJoinTimes = new Map<string, Date>();
			for (const session of channelSessions) {
				const existingTime = userJoinTimes.get(session.userId);
				if (!existingTime || session.joinedAt < existingTime) {
					userJoinTimes.set(session.userId, session.joinedAt);
				}
			}

			// Sort users by join time
			const sortedUsers = Array.from(userJoinTimes.entries()).sort(
				(a, b) => a[1].getTime() - b[1].getTime(),
			);

			console.log(`👑 Potential Owners (by join time):`);
			for (let i = 0; i < Math.min(5, sortedUsers.length); i++) {
				const [userId, joinTime] = sortedUsers[i];
				const marker = i === 0 ? "👑" : "👤";
				console.log(
					`  ${marker} ${userId.substring(0, 8)}... (${joinTime.toLocaleString()})`,
				);
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
					`  ${session.joinedAt.toLocaleString()} | ${session.userId.substring(0, 8)}... | ${duration} | ${status}`,
				);
			}

			console.log("-".repeat(80));
		}

		// Look for channel ID reuse patterns
		console.log("\n🔍 CHANNEL ID REUSE ANALYSIS:\n");

		const channelIdMap = new Map<string, string[]>();
		for (const session of allSessions) {
			if (!channelIdMap.has(session.channelId)) {
				channelIdMap.set(session.channelId, []);
			}
			channelIdMap.get(session.channelId)!.push(session.channelName);
		}

		// Find channels that had multiple names
		const multiNameChannels = new Map<string, string[]>();
		for (const [channelId, names] of channelIdMap) {
			const uniqueNames = [...new Set(names)];
			if (uniqueNames.length > 1) {
				multiNameChannels.set(channelId, uniqueNames);
			}
		}

		console.log(
			`📊 Found ${multiNameChannels.size} channels that had multiple names\n`,
		);

		for (const [channelId, names] of multiNameChannels) {
			console.log(`🆔 Channel ID: ${channelId}`);
			console.log(`📝 Names: ${names.join(" → ")}`);

			// Get sessions for this channel
			const channelSessions = allSessions.filter(
				(s) => s.channelId === channelId,
			);
			channelSessions.sort(
				(a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
			);

			console.log(`📊 Total sessions: ${channelSessions.length}`);
			console.log(
				`📅 Time span: ${channelSessions[0].joinedAt.toLocaleString()} to ${channelSessions[channelSessions.length - 1].leftAt?.toLocaleString() || "Active"}`,
			);

			// Show name change timeline
			const nameTimeline = new Map<string, Date>();
			for (const session of channelSessions) {
				const existingTime = nameTimeline.get(session.channelName);
				if (!existingTime || session.joinedAt < existingTime) {
					nameTimeline.set(session.channelName, session.joinedAt);
				}
			}

			const sortedNames = Array.from(nameTimeline.entries()).sort(
				(a, b) => a[1].getTime() - b[1].getTime(),
			);

			console.log(`📝 Name change timeline:`);
			for (let i = 0; i < sortedNames.length; i++) {
				const [name, timestamp] = sortedNames[i];
				const marker = i === sortedNames.length - 1 ? "🏁" : "📝";
				console.log(`  ${marker} ${timestamp.toLocaleString()}: "${name}"`);
			}

			console.log();
		}

		// Analyze the specific Lana's -> alex's transition
		console.log("\n🎯 SPECIFIC ANALYSIS: Lana's Channel → alex's Channel\n");

		const lanasChannelId = "1422748089848037477"; // From the search results
		const alexsChannelId = "1423089114353369230"; // From the search results

		console.log(
			`🔍 Checking if these are the same channel with different names...`,
		);

		// Check if these channel IDs appear in the multi-name list
		if (multiNameChannels.has(lanasChannelId)) {
			console.log(
				`✅ Channel ${lanasChannelId} had multiple names: ${multiNameChannels.get(lanasChannelId)?.join(" → ")}`,
			);
		}
		if (multiNameChannels.has(alexsChannelId)) {
			console.log(
				`✅ Channel ${alexsChannelId} had multiple names: ${multiNameChannels.get(alexsChannelId)?.join(" → ")}`,
			);
		}

		// Look for overlapping time periods
		const lanasSessions = allSessions.filter(
			(s) => s.channelId === lanasChannelId,
		);
		const alexsSessions = allSessions.filter(
			(s) => s.channelId === alexsChannelId,
		);

		if (lanasSessions.length > 0 && alexsSessions.length > 0) {
			const lanasLast = lanasSessions.reduce((latest, current) =>
				current.joinedAt > latest.joinedAt ? current : latest,
			);
			const alexsFirst = alexsSessions.reduce((earliest, current) =>
				current.joinedAt < earliest.joinedAt ? current : earliest,
			);

			console.log(
				`\n📅 Lana's Channel last activity: ${lanasLast.joinedAt.toLocaleString()}`,
			);
			console.log(
				`📅 alex's Channel first activity: ${alexsFirst.joinedAt.toLocaleString()}`,
			);

			const timeDiff =
				alexsFirst.joinedAt.getTime() - lanasLast.joinedAt.getTime();
			const hoursDiff = timeDiff / (1000 * 60 * 60);

			console.log(`⏱️  Time difference: ${hoursDiff.toFixed(2)} hours`);

			if (timeDiff < 24 * 60 * 60 * 1000) {
				// Less than 24 hours
				console.log(
					`🔍 This suggests a possible ownership transfer or channel rename within 24 hours`,
				);
			}
		}

		console.log("\n📋 PERMISSION ISSUE ANALYSIS:");
		console.log(
			"Based on the code analysis, here are potential causes for permission loss:",
		);
		console.log(
			"1. 🔄 Ownership transfer clears all permission overwrites except new owner",
		);
		console.log(
			"2. 🔧 Permission cloning from spawn channel might not include verified role",
		);
		console.log("3. 📝 Channel renaming might trigger permission reset");
		console.log(
			"4. ⚠️  User preferences application might override existing permissions",
		);
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

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
	analyzeChannelOwnership()
		.then(() => {
			console.log("\n✅ Analysis completed!");
			process.exit(0);
		})
		.catch((error) => {
			console.error("🔸 Analysis failed:", error);
			process.exit(1);
		});
}

export { analyzeChannelOwnership };
