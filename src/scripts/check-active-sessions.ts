#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function checkActiveSessions() {
	try {
		console.log("🔍 Checking for Multiple Active Sessions");
		console.log("=".repeat(50));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(20));

		// Get all voice sessions for this channel
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const channelSessions = allSessions.filter(
			(s) => s.channelId === channelId,
		);

		// Find active sessions (no leftAt)
		const activeSessions = channelSessions.filter((s) => !s.leftAt);

		console.log(`📊 Total sessions: ${channelSessions.length}`);
		console.log(`📊 Active sessions: ${activeSessions.length}`);

		// Group by user to find duplicates
		const userActiveSessions = new Map<string, any[]>();
		for (const session of activeSessions) {
			if (!userActiveSessions.has(session.userId)) {
				userActiveSessions.set(session.userId, []);
			}
			userActiveSessions.get(session.userId)!.push(session);
		}

		console.log(`\n🔍 ACTIVE SESSIONS BY USER:`);
		console.log("-".repeat(35));

		for (const [userId, sessions] of userActiveSessions) {
			console.log(`\n👤 User: ${userId}`);
			console.log(`📊 Active sessions: ${sessions.length}`);

			if (sessions.length > 1) {
				console.log(`🔸 MULTIPLE ACTIVE SESSIONS DETECTED!`);
				for (let i = 0; i < sessions.length; i++) {
					const session = sessions[i];
					const duration = Date.now() - session.joinedAt.getTime();
					const minutes = Math.floor(duration / (1000 * 60));
					const seconds = Math.floor((duration % (1000 * 60)) / 1000);
					console.log(
						`   Session ${i + 1}: Joined ${session.joinedAt.toLocaleString()} (${minutes}m ${seconds}s)`,
					);
				}
			} else {
				const session = sessions[0];
				const duration = Date.now() - session.joinedAt.getTime();
				const minutes = Math.floor(duration / (1000 * 60));
				const seconds = Math.floor((duration % (1000 * 60)) / 1000);
				console.log(
					`   Joined: ${session.joinedAt.toLocaleString()} (${minutes}m ${seconds}s)`,
				);
			}
		}

		// Check for users with multiple active sessions
		const usersWithMultipleSessions = Array.from(
			userActiveSessions.entries(),
		).filter(([_, sessions]) => sessions.length > 1);

		if (usersWithMultipleSessions.length > 0) {
			console.log(`\n🔸 ISSUE FOUND:`);
			console.log("-".repeat(20));
			console.log("🔹 Some users have multiple active sessions");
			console.log("🔹 This causes incorrect duration calculations");
			console.log("🔹 Duration should only count the current session");
			console.log(
				"🔹 Previous sessions should be marked as leftAt when user rejoins",
			);
		} else {
			console.log(`\n✅ No multiple active sessions found`);
		}

		console.log(`\n💡 SOLUTION:`);
		console.log("-".repeat(15));
		console.log(
			"🔹 When user joins, mark all their previous active sessions as leftAt",
		);
		console.log("🔹 Only count duration from the most recent join time");
		console.log("🔹 This will fix the 4h+ duration issue");
	} catch (error) {
		console.error("🔸 Error checking active sessions:", error);
	} finally {
		process.exit(0);
	}
}

checkActiveSessions().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
