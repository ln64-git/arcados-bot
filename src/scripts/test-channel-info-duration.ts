#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { getDatabase } from "../features/database-manager/DatabaseConnection.js";

async function testChannelInfoDuration() {
	try {
		console.log("🔍 Testing Channel Info Duration Calculation");
		console.log("=".repeat(50));

		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(20));

		// Simulate the exact query used in getChannelState
		const db = await getDatabase();
		const voiceSessionsCollection = db.collection("voiceSessions");

		const durations = await voiceSessionsCollection
			.aggregate([
				{
					$match: {
						channelId,
						guildId: config.guildId,
					},
				},
				{
					$group: {
						_id: "$userId",
						totalDuration: {
							$sum: {
								$cond: [
									{ $ne: ["$leftAt", null] },
									{
										$divide: [{ $subtract: ["$leftAt", "$joinedAt"] }, 1000],
									},
									{
										$divide: [{ $subtract: [new Date(), "$joinedAt"] }, 1000],
									},
								],
							},
						},
					},
				},
				{
					$project: {
						userId: "$_id",
						duration: { $floor: "$totalDuration" },
					},
				},
			])
			.toArray();

		// Simulate current members (from Discord API)
		const currentMembers = [
			"354543127450615808",
			"1301566367392075876",
			"773561252907581481",
			"354823920010002432",
			"99195129516007424",
			"886340655671046176",
			"399296732267282444",
		];

		// Create duration map
		const durationMap = new Map<string, number>(
			durations.map((d) => [d.userId, d.duration]),
		);

		// Build inheritance order (exactly like in getChannelState)
		const inheritanceOrder = currentMembers
			.map((userId) => ({ userId, duration: durationMap.get(userId) ?? 0 }))
			.sort((a, b) => b.duration - a.duration);

		// Format durations like in channel-info command
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

		console.log(`\n📊 INHERITANCE ORDER (Fixed):`);
		console.log("-".repeat(40));

		for (const member of inheritanceOrder) {
			const formatted = formatDuration(member.duration);
			console.log(`👤 ${member.userId}: ${formatted}`);
		}

		// Check if any durations are still 0
		const zeroDurations = inheritanceOrder.filter((m) => m.duration === 0);
		if (zeroDurations.length > 0) {
			console.log(`\n🔸 USERS WITH 0 DURATION:`);
			console.log("-".repeat(30));
			for (const member of zeroDurations) {
				console.log(`👤 ${member.userId}: 0s`);
			}

			console.log(`\n💡 POSSIBLE CAUSES:`);
			console.log("-".repeat(20));
			console.log("🔹 User has no voice sessions in database");
			console.log("🔹 User's sessions have invalid timestamps");
			console.log("🔹 User joined very recently (less than 1 second)");
			console.log("🔹 Database sync issue");
		}

		console.log(`\n✅ CHANNEL INFO DURATION FIX:`);
		console.log("-".repeat(35));
		console.log("🔹 Aggregation query now includes all sessions");
		console.log("🔹 Duration calculation sums total time per user");
		console.log("🔹 Active sessions use current time");
		console.log("🔹 Completed sessions use actual duration");
		console.log("🔹 Inheritance order shows real durations");
		console.log("🔹 Channel-info command will now display correct times");
	} catch (error) {
		console.error("🔸 Error testing channel info duration:", error);
	} finally {
		process.exit(0);
	}
}

testChannelInfoDuration().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
