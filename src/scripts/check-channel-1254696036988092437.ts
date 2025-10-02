#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function checkChannel1254696036988092437() {
	try {
		console.log("🔍 Checking Channel 1254696036988092437");
		console.log("=".repeat(50));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const channelId = "1254696036988092437";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(20));

		// Get all voice sessions for this channel
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const channelSessions = allSessions.filter(
			(s) => s.channelId === channelId,
		);

		console.log(`📊 Total voice sessions: ${channelSessions.length}`);

		if (channelSessions.length === 0) {
			console.log("🔸 No voice sessions found for this channel");
			return;
		}

		// Find active sessions (no leftAt)
		const activeSessions = channelSessions.filter((s) => !s.leftAt);

		console.log(`📊 Active sessions: ${activeSessions.length}`);

		// Show recent sessions
		console.log(`\n📋 RECENT VOICE SESSIONS:`);
		console.log("-".repeat(40));

		const recentSessions = channelSessions
			.sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
			.slice(0, 10);

		for (const session of recentSessions) {
			const status = session.leftAt ? "LEFT" : "ACTIVE";
			const duration = session.leftAt
				? session.leftAt.getTime() - session.joinedAt.getTime()
				: Date.now() - session.joinedAt.getTime();

			const minutes = Math.floor(duration / (1000 * 60));
			const seconds = Math.floor((duration % (1000 * 60)) / 1000);

			console.log(
				`👤 ${session.userId}: ${session.joinedAt.toLocaleString()} - ${status} (${minutes}m ${seconds}s)`,
			);
		}

		// Check for multiple active sessions
		const userActiveSessions = new Map<string, any[]>();
		for (const session of activeSessions) {
			if (!userActiveSessions.has(session.userId)) {
				userActiveSessions.set(session.userId, []);
			}
			userActiveSessions.get(session.userId)!.push(session);
		}

		const usersWithMultipleSessions = Array.from(
			userActiveSessions.entries(),
		).filter(([_, sessions]) => sessions.length > 1);

		if (usersWithMultipleSessions.length > 0) {
			console.log(`\n🔸 MULTIPLE ACTIVE SESSIONS FOUND:`);
			console.log("-".repeat(40));
			for (const [userId, sessions] of usersWithMultipleSessions) {
				console.log(`👤 ${userId}: ${sessions.length} active sessions`);
			}
		}

		// Test the aggregation query for this channel
		console.log(`\n🔍 TESTING AGGREGATION QUERY:`);
		console.log("-".repeat(35));

		const db = await dbCore.core.getDatabase();
		const voiceSessionsCollection = db.collection("voiceSessions");

		const aggregationResult = await voiceSessionsCollection
			.aggregate([
				{
					$match: {
						channelId,
						guildId: config.guildId,
						$or: [
							{ leftAt: { $exists: false } },
							{ leftAt: { $type: "null" } },
						],
					},
				},
				{
					$group: {
						_id: "$userId",
						currentDuration: {
							$sum: {
								$divide: [{ $subtract: [new Date(), "$joinedAt"] }, 1000],
							},
						},
					},
				},
				{
					$project: {
						userId: "$_id",
						duration: { $floor: "$currentDuration" },
					},
				},
			])
			.toArray();

		console.log(`📊 Aggregation results:`);
		if (aggregationResult.length === 0) {
			console.log("🔸 No active sessions found in aggregation");
		} else {
			for (const result of aggregationResult) {
				const hours = Math.floor(result.duration / 3600);
				const minutes = Math.floor((result.duration % 3600) / 60);
				const seconds = result.duration % 60;
				console.log(`👤 ${result.userId}: ${hours}h ${minutes}m ${seconds}s`);
			}
		}

		console.log(`\n💡 DIAGNOSIS:`);
		console.log("-".repeat(20));
		console.log(
			"🔹 If aggregation shows 0 results, there are no active sessions",
		);
		console.log(
			"🔹 If aggregation shows durations but Discord shows 0s, it's a display issue",
		);
		console.log("🔹 Check if the channel-info command is working correctly");
	} catch (error) {
		console.error("🔸 Error checking channel:", error);
	} finally {
		process.exit(0);
	}
}

checkChannel1254696036988092437().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
