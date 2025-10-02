#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function debugCallDuration() {
	try {
		console.log("🔍 Debugging Call Duration Calculation");
		console.log("=".repeat(50));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const cache = new DiscordDataCache();

		// Test channel ID
		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(30));

		// Get voice sessions for this channel
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const channelSessions = allSessions.filter(
			(s) => s.channelId === channelId,
		);

		console.log(`📊 Total voice sessions: ${channelSessions.length}`);

		if (channelSessions.length === 0) {
			console.log("🔸 No voice sessions found");
			return;
		}

		// Show sample sessions to debug duration calculation
		console.log(`\n📋 SAMPLE VOICE SESSIONS:`);
		console.log("-".repeat(40));

		const sampleSessions = channelSessions.slice(0, 5);
		for (const session of sampleSessions) {
			console.log(`👤 User: ${session.userId}`);
			console.log(`📅 Joined: ${session.joinedAt.toLocaleString()}`);
			console.log(
				`📅 Left: ${session.leftAt ? session.leftAt.toLocaleString() : "Still active"}`,
			);

			if (session.leftAt) {
				const duration = session.leftAt.getTime() - session.joinedAt.getTime();
				const seconds = Math.floor(duration / 1000);
				const minutes = Math.floor(seconds / 60);
				const hours = Math.floor(minutes / 60);
				console.log(
					`⏱️  Duration: ${hours}h ${minutes % 60}m ${seconds % 60}s (${duration}ms)`,
				);
			} else {
				console.log(`⏱️  Duration: Still active`);
			}
			console.log(`---`);
		}

		// Group by user and calculate total durations
		console.log(`\n👥 USER DURATIONS:`);
		console.log("-".repeat(30));

		const userDurations = new Map<string, number>();
		const userSessions = new Map<string, any[]>();

		for (const session of channelSessions) {
			if (!userSessions.has(session.userId)) {
				userSessions.set(session.userId, []);
			}
			userSessions.get(session.userId)!.push(session);

			if (session.leftAt) {
				const duration = session.leftAt.getTime() - session.joinedAt.getTime();
				const currentDuration = userDurations.get(session.userId) || 0;
				userDurations.set(session.userId, currentDuration + duration);
			}
		}

		// Sort by duration
		const sortedUsers = Array.from(userDurations.entries()).sort(
			(a, b) => b[1] - a[1],
		);

		for (const [userId, totalDuration] of sortedUsers) {
			const sessions = userSessions.get(userId)!;
			const hours = Math.floor(totalDuration / (1000 * 60 * 60));
			const minutes = Math.floor(
				(totalDuration % (1000 * 60 * 60)) / (1000 * 60),
			);
			const seconds = Math.floor((totalDuration % (1000 * 60)) / 1000);

			console.log(
				`👤 ${userId}: ${hours}h ${minutes}m ${seconds}s (${sessions.length} sessions)`,
			);
		}

		// Check if there are any active sessions (no leftAt)
		console.log(`\n🔍 ACTIVE SESSIONS:`);
		console.log("-".repeat(20));

		const activeSessions = channelSessions.filter((s) => !s.leftAt);
		console.log(`📊 Active sessions: ${activeSessions.length}`);

		for (const session of activeSessions) {
			const duration = Date.now() - session.joinedAt.getTime();
			const hours = Math.floor(duration / (1000 * 60 * 60));
			const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
			const seconds = Math.floor((duration % (1000 * 60)) / 1000);

			console.log(
				`👤 ${session.userId}: ${hours}h ${minutes}m ${seconds}s (active)`,
			);
		}

		// Test the formatDuration function used in channel-info
		console.log(`\n🔍 FORMAT DURATION TEST:`);
		console.log("-".repeat(30));

		function formatDuration(seconds: number): string {
			const minutes = Math.floor(seconds / 60);
			const hours = Math.floor(minutes / 60);
			const days = Math.floor(hours / 24);

			if (days > 0) {
				return `${days}d ${hours % 24}h ${minutes % 60}m`;
			}
			if (hours > 0) {
				return `${hours}h ${minutes % 60}m`;
			}
			if (minutes > 0) {
				return `${minutes}m ${seconds % 60}s`;
			}
			return `${seconds}s`;
		}

		// Test with some durations
		const testDurations = [0, 30, 90, 3661, 86400]; // 0s, 30s, 1.5m, 1h1m1s, 1d
		for (const seconds of testDurations) {
			console.log(`${seconds}s -> "${formatDuration(seconds)}"`);
		}

		console.log(`\n💡 DIAGNOSIS:`);
		console.log("-".repeat(20));
		console.log(
			"🔹 If durations show 0s, the issue is in duration calculation",
		);
		console.log(
			"🔹 If durations show correctly here but 0s in Discord, it's a formatting issue",
		);
		console.log("🔹 Check if leftAt timestamps are being set properly");
		console.log("🔹 Verify the formatDuration function is working correctly");
	} catch (error) {
		console.error("🔸 Error debugging call duration:", error);
	} finally {
		process.exit(0);
	}
}

debugCallDuration().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
