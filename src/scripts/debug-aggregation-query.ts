#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { getDatabase } from "../features/database-manager/DatabaseConnection.js";

async function debugAggregationQuery() {
	try {
		console.log("=".repeat(40));

		const channelId = "1423358562683326647";
		const terraUserId = "1301566367392075876";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log(`👤 TERRA USER ID: ${terraUserId}`);
		console.log("-".repeat(30));

		// Test the exact aggregation query used in getChannelState
		const db = await getDatabase();
		const voiceSessionsCollection = db.collection("voiceSessions");

		// First, let's see all of Terra's sessions
		console.log(`\n📋 ALL OF TERRA'S SESSIONS:`);
		console.log("-".repeat(35));

		const allTerraSessions = await voiceSessionsCollection
			.find({
				channelId,
				guildId: config.guildId,
				userId: terraUserId,
			})
			.sort({ joinedAt: -1 })
			.toArray();

		for (let i = 0; i < allTerraSessions.length; i++) {
			const session = allTerraSessions[i];
			console.log(`\n📅 SESSION ${i + 1}:`);
			console.log(`👤 User: ${session.userId}`);
			console.log(`📅 Joined: ${session.joinedAt.toLocaleString()}`);
			console.log(
				`📅 Left: ${session.leftAt ? session.leftAt.toLocaleString() : "Still active"}`,
			);
			console.log(`📊 Active: ${!session.leftAt ? "YES" : "NO"}`);

			if (!session.leftAt) {
				const duration = Date.now() - session.joinedAt.getTime();
				const minutes = Math.floor(duration / (1000 * 60));
				const seconds = Math.floor((duration % (1000 * 60)) / 1000);
				console.log(`⏱️  Duration: ${minutes}m ${seconds}s (ACTIVE)`);
			}
		}

		// Now test the aggregation query
		console.log(`\n🔍 AGGREGATION QUERY RESULT:`);
		console.log("-".repeat(35));

		const aggregationResult = await voiceSessionsCollection
			.aggregate([
				{
					$match: {
						channelId,
						guildId: config.guildId,
						userId: terraUserId,
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

		if (aggregationResult.length > 0) {
			const result = aggregationResult[0];
			const hours = Math.floor(result.duration / 3600);
			const minutes = Math.floor((result.duration % 3600) / 60);
			const seconds = result.duration % 60;

			console.log(`📊 Aggregation Result: ${hours}h ${minutes}m ${seconds}s`);
			console.log(`📊 Raw Duration: ${result.duration} seconds`);
		} else {
			console.log(`🔸 No aggregation result found`);
		}

		// Test the full channel aggregation (like in getChannelState)
		console.log(`\n🔍 FULL CHANNEL AGGREGATION:`);
		console.log("-".repeat(40));

		const channelAggregation = await voiceSessionsCollection
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

		console.log(`📊 Channel aggregation results:`);
		for (const result of channelAggregation) {
			const hours = Math.floor(result.duration / 3600);
			const minutes = Math.floor((result.duration % 3600) / 60);
			const seconds = result.duration % 60;

			if (result.userId === terraUserId) {
				console.log(
					`👤 ${result.userId}: ${hours}h ${minutes}m ${seconds}s (TERRA)`,
				);
			} else {
				console.log(`👤 ${result.userId}: ${hours}h ${minutes}m ${seconds}s`);
			}
		}

		console.log(`\n💡 DIAGNOSIS:`);
		console.log("-".repeat(20));
		console.log(
			"🔹 If Terra has only 1 active session, duration should be ~20 minutes",
		);
		console.log("🔹 If aggregation shows 5+ hours, there's still a bug");
		console.log("🔹 Check if the aggregation query is working correctly");
	} catch (error) {
		console.error("🔸 Error debugging aggregation query:", error);
	} finally {
		process.exit(0);
	}
}

debugAggregationQuery().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
