#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function investigateTerraDuration() {
	try {
		console.log("🔍 Investigating Terra Praetorium Duration Discrepancy");
		console.log("=".repeat(60));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const channelId = "1423358562683326647";
		const terraUserId = "1301566367392075876"; // From our previous findings

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log(`👤 TERRA USER ID: ${terraUserId}`);
		console.log("-".repeat(40));

		// Get ALL voice sessions for Terra in this channel
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const terraSessions = allSessions.filter(
			(s) => s.channelId === channelId && s.userId === terraUserId,
		);

		console.log(`📊 Terra's voice sessions: ${terraSessions.length}`);

		if (terraSessions.length === 0) {
			console.log("🔸 No voice sessions found for Terra");
			return;
		}

		// Show ALL of Terra's sessions with detailed timing
		console.log(`\n📋 TERRA'S VOICE SESSIONS:`);
		console.log("-".repeat(50));

		let totalDuration = 0;
		for (let i = 0; i < terraSessions.length; i++) {
			const session = terraSessions[i];
			console.log(`\n📅 SESSION ${i + 1}:`);
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
				console.log(`⏱️  Duration: ${hours}h ${minutes % 60}m ${seconds % 60}s`);
				totalDuration += duration;
			} else {
				// Active session - calculate from join time to now
				const duration = Date.now() - session.joinedAt.getTime();
				const seconds = Math.floor(duration / 1000);
				const minutes = Math.floor(seconds / 60);
				const hours = Math.floor(minutes / 60);
				console.log(
					`⏱️  Duration: ${hours}h ${minutes % 60}m ${seconds % 60}s (ACTIVE)`,
				);
				totalDuration += duration;
			}
		}

		// Calculate total duration
		const totalSeconds = Math.floor(totalDuration / 1000);
		const totalMinutes = Math.floor(totalSeconds / 60);
		const totalHours = Math.floor(totalMinutes / 60);

		console.log(`\n📊 TOTAL DURATION CALCULATION:`);
		console.log("-".repeat(40));
		console.log(
			`⏱️  Total Duration: ${totalHours}h ${totalMinutes % 60}m ${totalSeconds % 60}s`,
		);
		console.log(`📊 Total Milliseconds: ${totalDuration}`);

		// Check if there are any sessions from before today
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const oldSessions = terraSessions.filter((s) => s.joinedAt < today);
		if (oldSessions.length > 0) {
			console.log(`\n🔸 OLD SESSIONS FOUND:`);
			console.log("-".repeat(25));
			for (const session of oldSessions) {
				console.log(
					`📅 ${session.joinedAt.toLocaleString()} - ${session.leftAt ? session.leftAt.toLocaleString() : "Active"}`,
				);
			}
		}

		// Check for sessions with invalid timestamps
		const invalidSessions = terraSessions.filter((s) => {
			return s.joinedAt > new Date() || (s.leftAt && s.leftAt < s.joinedAt);
		});

		if (invalidSessions.length > 0) {
			console.log(`\n🔸 INVALID TIMESTAMPS FOUND:`);
			console.log("-".repeat(30));
			for (const session of invalidSessions) {
				console.log(`📅 Joined: ${session.joinedAt.toLocaleString()}`);
				console.log(
					`📅 Left: ${session.leftAt ? session.leftAt.toLocaleString() : "Active"}`,
				);
			}
		}

		// Test the aggregation query that's used in getChannelState
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
						userId: terraUserId,
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

		console.log(`\n💡 DIAGNOSIS:`);
		console.log("-".repeat(20));
		console.log(
			"🔹 If Terra joined at 6:53 PM, duration should be ~17 minutes",
		);
		console.log(
			"🔹 4h 42m suggests sessions from previous days are being counted",
		);
		console.log("🔹 Check if sessions have incorrect timestamps");
		console.log("🔹 Verify aggregation query is working correctly");
	} catch (error) {
		console.error("🔸 Error investigating Terra duration:", error);
	} finally {
		process.exit(0);
	}
}

investigateTerraDuration().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
