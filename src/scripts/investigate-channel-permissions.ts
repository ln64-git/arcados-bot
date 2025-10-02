#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";
import type { VoiceSession } from "../types/database.js";

/**
 * Script to investigate channel permission issues
 * Specifically looking at lanas/alexs channel and verified role permissions
 */
async function investigateChannelPermissions() {
	console.log("🔍 Investigating channel permission issues...\n");

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

		// Look for sessions related to "lanas" or "alexs" channels
		const lanasSessions = allSessions.filter((session: VoiceSession) => {
			const channelName = session.channelName.toLowerCase();
			return channelName.includes("lanas") || channelName.includes("alexs");
		});

		console.log(
			`🔧 Found ${lanasSessions.length} sessions related to lanas/alexs channels\n`,
		);

		if (lanasSessions.length === 0) {
			console.log("❌ No sessions found for lanas/alexs channels");
			return;
		}

		// Group sessions by channel ID to see ownership changes
		const channelGroups = new Map<string, VoiceSession[]>();

		for (const session of lanasSessions) {
			const channelId = session.channelId;
			if (!channelGroups.has(channelId)) {
				channelGroups.set(channelId, []);
			}
			channelGroups.get(channelId)!.push(session);
		}

		console.log("📋 CHANNEL ANALYSIS:\n");
		console.log("=".repeat(80));

		for (const [channelId, sessions] of channelGroups) {
			// Sort sessions by join time
			sessions.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

			console.log(`\n🆔 Channel ID: ${channelId}`);
			console.log(
				`📺 Channel Names Used: ${[...new Set(sessions.map((s) => s.channelName))].join(" → ")}`,
			);
			console.log(`👥 Total Sessions: ${sessions.length}`);
			console.log(
				`📅 Time Range: ${sessions[0].joinedAt.toLocaleString()} to ${sessions[sessions.length - 1].leftAt?.toLocaleString() || "Active"}`,
			);

			// Find potential ownership transfers (users who joined first)
			const firstJoiners = sessions.filter((session) => {
				const earliestJoin = Math.min(
					...sessions.map((s) => s.joinedAt.getTime()),
				);
				return session.joinedAt.getTime() === earliestJoin;
			});

			console.log(
				`👑 Potential Owners: ${[...new Set(firstJoiners.map((s) => s.userId))].join(", ")}`,
			);

			// Show session timeline
			console.log("\n📊 Session Timeline:");
			console.log("Time | User ID | Channel Name | Duration");
			console.log("-----|---------|--------------|----------");

			for (const session of sessions.slice(0, 10)) {
				// Show first 10 sessions
				const time = session.joinedAt.toLocaleString();
				const userId = session.userId.substring(0, 8) + "...";
				const channelName = session.channelName.substring(0, 12);
				const duration = session.duration
					? formatDuration(session.duration)
					: "Active";

				console.log(`${time} | ${userId} | ${channelName} | ${duration}`);
			}

			if (sessions.length > 10) {
				console.log(`... and ${sessions.length - 10} more sessions`);
			}

			console.log("-".repeat(80));
		}

		// Look for patterns in channel name changes
		console.log("\n🔍 CHANNEL NAME CHANGE ANALYSIS:\n");

		const nameChanges = new Map<
			string,
			Array<{ name: string; timestamp: Date; userId: string }>
		>();

		for (const [channelId, sessions] of channelGroups) {
			const changes: Array<{ name: string; timestamp: Date; userId: string }> =
				[];

			// Group sessions by channel name and find when names changed
			const nameGroups = new Map<string, VoiceSession[]>();
			for (const session of sessions) {
				if (!nameGroups.has(session.channelName)) {
					nameGroups.set(session.channelName, []);
				}
				nameGroups.get(session.channelName)!.push(session);
			}

			// Find the earliest timestamp for each name
			for (const [name, nameSessions] of nameGroups) {
				const earliestSession = nameSessions.reduce((earliest, current) =>
					current.joinedAt < earliest.joinedAt ? current : earliest,
				);
				changes.push({
					name,
					timestamp: earliestSession.joinedAt,
					userId: earliestSession.userId,
				});
			}

			// Sort by timestamp
			changes.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
			nameChanges.set(channelId, changes);
		}

		for (const [channelId, changes] of nameChanges) {
			if (changes.length > 1) {
				console.log(`🆔 Channel ${channelId}:`);
				for (let i = 0; i < changes.length; i++) {
					const change = changes[i];
					const marker = i === changes.length - 1 ? "🏁" : "📝";
					console.log(
						`  ${marker} ${change.timestamp.toLocaleString()}: "${change.name}" (User: ${change.userId.substring(0, 8)}...)`,
					);
				}
				console.log();
			}
		}

		// Look for verified role related issues
		console.log("\n🔍 VERIFIED ROLE PERMISSION ANALYSIS:\n");

		// This would require Discord API access to check actual permissions
		// For now, we'll analyze the data we have
		console.log(
			"📝 Note: To fully investigate verified role permissions, we would need to:",
		);
		console.log("  1. Fetch the actual channel permissions from Discord API");
		console.log("  2. Check if verified role has Connect permission");
		console.log("  3. Compare permissions before/after ownership transfers");
		console.log("  4. Check if permission cloning is working correctly");
	} catch (error) {
		console.error("🔸 Error investigating channel permissions:", error);
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
	investigateChannelPermissions()
		.then(() => {
			console.log("\n✅ Investigation completed!");
			process.exit(0);
		})
		.catch((error) => {
			console.error("🔸 Investigation failed:", error);
			process.exit(1);
		});
}

export { investigateChannelPermissions };
