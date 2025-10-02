#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { getDatabase } from "../features/database-manager/DatabaseConnection.js";

async function createTestVoiceSession() {
	try {
		console.log(
			"🔍 Creating Test Voice Session for Channel 1254696036988092437",
		);
		console.log("=".repeat(70));

		const channelId = "1254696036988092437";
		const testUserId = "1301566367392075876"; // Terra's user ID

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log(`👤 TEST USER: ${testUserId}`);
		console.log("-".repeat(30));

		// Create a test voice session
		const db = await getDatabase();
		const voiceSessionsCollection = db.collection("voiceSessions");

		const testSession = {
			userId: testUserId,
			guildId: config.guildId,
			channelId: channelId,
			channelName: "Test Channel",
			displayName: "Test User",
			joinedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
			leftAt: null, // Still active
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		console.log(`📅 Creating test session:`);
		console.log(`   👤 User: ${testSession.userId}`);
		console.log(`   📺 Channel: ${testSession.channelId}`);
		console.log(`   📅 Joined: ${testSession.joinedAt.toLocaleString()}`);
		console.log(`   📅 Status: ACTIVE`);

		// Insert the test session
		await voiceSessionsCollection.insertOne(testSession);
		console.log(`✅ Test session created successfully`);

		// Now test the aggregation query
		console.log(`\n🔍 TESTING AGGREGATION QUERY:`);
		console.log("-".repeat(35));

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

		// Test the formatDuration function
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

		console.log(`\n✅ TEST COMPLETED:`);
		console.log("-".repeat(20));
		console.log("🔹 Test voice session created");
		console.log("🔹 Aggregation query tested");
		console.log("🔹 Duration formatting tested");
		console.log(
			"🔹 If this works, the issue is RealtimeTracker not tracking the channel",
		);

		// Clean up - remove the test session
		console.log(`\n🧹 CLEANING UP:`);
		console.log("-".repeat(20));
		await voiceSessionsCollection.deleteOne({
			userId: testUserId,
			channelId: channelId,
			guildId: config.guildId,
		});
		console.log(`✅ Test session removed`);
	} catch (error) {
		console.error("🔸 Error creating test voice session:", error);
	} finally {
		process.exit(0);
	}
}

createTestVoiceSession().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
