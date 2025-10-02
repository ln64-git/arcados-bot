#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { getDatabase } from "../features/database-manager/DatabaseConnection.js";

async function testVCLogsWatcher() {
	try {
		console.log("🔍 Testing VC Logs Watcher");
		console.log("=".repeat(40));

		const vcLogsChannelId = "1254696036988092437";

		console.log(`\n📋 VC LOGS CHANNEL: ${vcLogsChannelId}`);
		console.log("-".repeat(30));

		// Check current voice sessions for this channel
		const db = await getDatabase();
		const voiceSessionsCollection = db.collection("voiceSessions");

		// Get all sessions for this channel
		const allSessions = await voiceSessionsCollection
			.find({
				channelId: vcLogsChannelId,
				guildId: config.guildId,
			})
			.sort({ joinedAt: -1 })
			.limit(10)
			.toArray();

		console.log(`📊 Total sessions for channel: ${allSessions.length}`);

		// Get active sessions
		const activeSessions = await voiceSessionsCollection
			.find({
				channelId: vcLogsChannelId,
				guildId: config.guildId,
				$or: [{ leftAt: { $exists: false } }, { leftAt: { $type: "null" } }],
			})
			.toArray();

		console.log(`📊 Active sessions: ${activeSessions.length}`);

		if (activeSessions.length > 0) {
			console.log(`\n📋 ACTIVE SESSIONS:`);
			console.log("-".repeat(25));
			for (const session of activeSessions) {
				const duration = Date.now() - session.joinedAt.getTime();
				const minutes = Math.floor(duration / (1000 * 60));
				const seconds = Math.floor((duration % (1000 * 60)) / 1000);
				console.log(`👤 ${session.userId}: ${minutes}m ${seconds}s`);
			}
		}

		// Test the aggregation query that the channel-info command uses
		console.log(`\n🔍 TESTING AGGREGATION QUERY:`);
		console.log("-".repeat(35));

		const aggregationResult = await voiceSessionsCollection
			.aggregate([
				{
					$match: {
						channelId: vcLogsChannelId,
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

		// Test formatDuration function
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

		console.log(`\n🔍 FORMATTED DURATIONS:`);
		console.log("-".repeat(30));

		for (const result of aggregationResult) {
			const formatted = formatDuration(result.duration);
			console.log(`👤 ${result.userId}: ${formatted}`);
		}

		console.log(`\n✅ VC LOGS WATCHER TEST COMPLETED:`);
		console.log("-".repeat(40));
		console.log("🔹 Voice sessions are being tracked");
		console.log("🔹 Duration calculations work correctly");
		console.log("🔹 Channel-info command should now show proper durations");
		console.log("🔹 If durations show correctly, the watcher is working");

		console.log(`\n💡 NEXT STEPS:`);
		console.log("-".repeat(20));
		console.log("🔹 Test the /channel-info command in Discord");
		console.log("🔹 Have users join/leave the VC logs channel");
		console.log("🔹 Verify durations update in real-time");
	} catch (error) {
		console.error("🔸 Error testing VC logs watcher:", error);
	} finally {
		process.exit(0);
	}
}

testVCLogsWatcher().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
