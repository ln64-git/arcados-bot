#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function checkAllVoiceSessions() {
	try {
		console.log("🔍 Checking All Voice Sessions");
		console.log("=".repeat(40));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Get all voice sessions
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);

		console.log(`📊 Total voice sessions: ${allSessions.length}`);

		if (allSessions.length === 0) {
			console.log("🔸 No voice sessions found in database at all!");
			console.log(
				"💡 This suggests voice session tracking is completely broken",
			);
			return;
		}

		// Group by channel
		const channelSessions = new Map<string, any[]>();
		for (const session of allSessions) {
			if (!channelSessions.has(session.channelId)) {
				channelSessions.set(session.channelId, []);
			}
			channelSessions.get(session.channelId)!.push(session);
		}

		console.log(`\n📋 VOICE SESSIONS BY CHANNEL:`);
		console.log("-".repeat(40));

		for (const [channelId, sessions] of channelSessions) {
			const activeSessions = sessions.filter((s) => !s.leftAt);
			console.log(
				`📺 Channel ${channelId}: ${sessions.length} total, ${activeSessions.length} active`,
			);
		}

		// Check the specific channels mentioned
		const targetChannels = [
			"1423358562683326647", // Original channel
			"1254696036988092437", // Channel with VC logs
		];

		console.log(`\n🔍 TARGET CHANNELS:`);
		console.log("-".repeat(25));

		for (const channelId of targetChannels) {
			const sessions = channelSessions.get(channelId) || [];
			const activeSessions = sessions.filter((s) => !s.leftAt);

			console.log(`\n📺 Channel ${channelId}:`);
			console.log(`   📊 Total sessions: ${sessions.length}`);
			console.log(`   📊 Active sessions: ${activeSessions.length}`);

			if (sessions.length > 0) {
				const recentSessions = sessions
					.sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
					.slice(0, 3);

				console.log(`   📋 Recent sessions:`);
				for (const session of recentSessions) {
					const status = session.leftAt ? "LEFT" : "ACTIVE";
					console.log(
						`      👤 ${session.userId}: ${session.joinedAt.toLocaleString()} - ${status}`,
					);
				}
			}
		}

		// Check if voice session tracking is working at all
		console.log(`\n🔍 VOICE SESSION TRACKING STATUS:`);
		console.log("-".repeat(40));

		const recentSessions = allSessions
			.sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
			.slice(0, 5);

		console.log(`📋 Most recent sessions:`);
		for (const session of recentSessions) {
			const status = session.leftAt ? "LEFT" : "ACTIVE";
			const duration = session.leftAt
				? session.leftAt.getTime() - session.joinedAt.getTime()
				: Date.now() - session.joinedAt.getTime();

			const minutes = Math.floor(duration / (1000 * 60));
			const seconds = Math.floor((duration % (1000 * 60)) / 1000);

			console.log(
				`👤 ${session.userId} in ${session.channelId}: ${session.joinedAt.toLocaleString()} - ${status} (${minutes}m ${seconds}s)`,
			);
		}

		console.log(`\n💡 DIAGNOSIS:`);
		console.log("-".repeat(20));
		console.log("🔹 If no sessions exist, voice tracking is broken");
		console.log(
			"🔹 If sessions exist but not for target channels, tracking is partial",
		);
		console.log("🔹 Check if RealtimeTracker is working correctly");
	} catch (error) {
		console.error("🔸 Error checking voice sessions:", error);
	} finally {
		process.exit(0);
	}
}

checkAllVoiceSessions().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
