#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { getDatabase } from "../features/database-manager/DatabaseConnection.js";

async function testChannelTracking() {
	try {
		console.log("🔍 Testing Channel Tracking for 1254696036988092437");
		console.log("=".repeat(60));

		const channelId = "1254696036988092437";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(20));

		// Check if this channel has any sessions at all (including from other guilds)
		const db = await getDatabase();
		const voiceSessionsCollection = db.collection("voiceSessions");

		// Check all sessions for this channel ID across all guilds
		const allChannelSessions = await voiceSessionsCollection
			.find({ channelId })
			.sort({ joinedAt: -1 })
			.limit(10)
			.toArray();

		console.log(
			`📊 Sessions for channel ${channelId}: ${allChannelSessions.length}`,
		);

		if (allChannelSessions.length > 0) {
			console.log(`\n📋 RECENT SESSIONS:`);
			console.log("-".repeat(30));
			for (const session of allChannelSessions) {
				const status = session.leftAt ? "LEFT" : "ACTIVE";
				console.log(
					`👤 ${session.userId} (Guild: ${session.guildId}): ${session.joinedAt.toLocaleString()} - ${status}`,
				);
			}
		}

		// Check if there are any sessions in the target guild
		const guildSessions = await voiceSessionsCollection
			.find({ channelId, guildId: config.guildId })
			.toArray();

		console.log(`\n📊 Sessions in target guild: ${guildSessions.length}`);

		// Check if there are any recent sessions in the target guild (last 24 hours)
		const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const recentGuildSessions = await voiceSessionsCollection
			.find({
				channelId,
				guildId: config.guildId,
				joinedAt: { $gte: oneDayAgo },
			})
			.sort({ joinedAt: -1 })
			.toArray();

		console.log(`📊 Recent sessions (24h): ${recentGuildSessions.length}`);

		// Check if there are any active sessions in the target guild
		const activeGuildSessions = await voiceSessionsCollection
			.find({
				channelId,
				guildId: config.guildId,
				$or: [{ leftAt: { $exists: false } }, { leftAt: { $type: "null" } }],
			})
			.toArray();

		console.log(`📊 Active sessions: ${activeGuildSessions.length}`);

		// Check if the channel name might be causing issues
		console.log(`\n🔍 CHANNEL ANALYSIS:`);
		console.log("-".repeat(25));
		console.log(`📺 Channel ID: ${channelId}`);
		console.log(`🏠 Guild ID: ${config.guildId}`);
		console.log(`📊 Total sessions in guild: ${allChannelSessions.length}`);
		console.log(`📊 Sessions in target guild: ${guildSessions.length}`);

		if (guildSessions.length === 0) {
			console.log(`\n🔸 ISSUE IDENTIFIED:`);
			console.log("-".repeat(25));
			console.log(
				"🔹 No voice sessions found for this channel in the target guild",
			);
			console.log("🔹 This means RealtimeTracker is not tracking this channel");
			console.log("🔹 Possible causes:");
			console.log("   - Channel is treated as AFK channel");
			console.log("   - Channel is filtered out by some other logic");
			console.log("   - RealtimeTracker is not running for this guild");
			console.log("   - Channel doesn't exist or is inaccessible");
		}

		// Check if there are any sessions in the target guild at all
		const anyGuildSessions = await voiceSessionsCollection
			.find({ guildId: config.guildId })
			.limit(5)
			.toArray();

		console.log(
			`\n📊 ANY SESSIONS IN TARGET GUILD: ${anyGuildSessions.length}`,
		);
		if (anyGuildSessions.length > 0) {
			console.log(`📋 Sample sessions:`);
			for (const session of anyGuildSessions) {
				console.log(
					`   👤 ${session.userId} in ${session.channelId}: ${session.joinedAt.toLocaleString()}`,
				);
			}
		}

		console.log(`\n💡 NEXT STEPS:`);
		console.log("-".repeat(20));
		console.log(
			"🔹 If no sessions exist for this channel, RealtimeTracker is not working",
		);
		console.log("🔹 Check if the channel exists and is accessible");
		console.log(
			"🔹 Verify RealtimeTracker is running and not filtering this channel",
		);
		console.log(
			"🔹 Test by having someone join the channel and see if sessions are created",
		);
	} catch (error) {
		console.error("🔸 Error testing channel tracking:", error);
	} finally {
		process.exit(0);
	}
}

testChannelTracking().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
