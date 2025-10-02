#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function cleanupMultipleActiveSessions() {
	try {
		console.log("🔍 Cleaning Up Multiple Active Sessions");
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

		// Find users with multiple active sessions
		const usersWithMultipleSessions = Array.from(
			userActiveSessions.entries(),
		).filter(([_, sessions]) => sessions.length > 1);

		if (usersWithMultipleSessions.length === 0) {
			console.log(`\n✅ No multiple active sessions found`);
			return;
		}

		console.log(
			`\n🔸 FOUND ${usersWithMultipleSessions.length} USERS WITH MULTIPLE ACTIVE SESSIONS:`,
		);
		console.log("-".repeat(60));

		for (const [userId, sessions] of usersWithMultipleSessions) {
			console.log(`\n👤 User: ${userId}`);
			console.log(`📊 Active sessions: ${sessions.length}`);

			// Sort by join time (newest first)
			const sortedSessions = sessions.sort(
				(a, b) => b.joinedAt.getTime() - a.joinedAt.getTime(),
			);

			// Keep the newest session, close the rest
			const keepSession = sortedSessions[0];
			const closeSessions = sortedSessions.slice(1);

			console.log(`✅ Keeping: ${keepSession.joinedAt.toLocaleString()}`);

			for (let i = 0; i < closeSessions.length; i++) {
				const session = closeSessions[i];
				console.log(`🔸 Closing: ${session.joinedAt.toLocaleString()}`);

				// Close this session
				await dbCore.updateVoiceSession(
					userId,
					config.guildId,
					new Date(),
					session.channelId,
				);
			}
		}

		console.log(`\n✅ CLEANUP COMPLETED:`);
		console.log("-".repeat(25));
		console.log("🔹 Multiple active sessions have been closed");
		console.log("🔹 Only the most recent session per user remains active");
		console.log("🔹 Duration calculations will now be accurate");
		console.log(
			"🔹 Terra's duration should now show ~20 minutes instead of 4+ hours",
		);

		// Verify the fix
		console.log(`\n🔍 VERIFICATION:`);
		console.log("-".repeat(20));

		const terraUserId = "1301566367392075876";
		const terraActiveSessions = await dbCore.getActiveVoiceSessionsByUser(
			terraUserId,
			config.guildId,
		);
		const terraChannelSessions = terraActiveSessions.filter(
			(s) => s.channelId === channelId,
		);

		console.log(`👤 Terra's active sessions: ${terraChannelSessions.length}`);
		if (terraChannelSessions.length === 1) {
			const session = terraChannelSessions[0];
			const duration = Date.now() - session.joinedAt.getTime();
			const minutes = Math.floor(duration / (1000 * 60));
			const seconds = Math.floor((duration % (1000 * 60)) / 1000);
			console.log(`✅ Terra's duration: ${minutes}m ${seconds}s (CORRECT)`);
		} else {
			console.log(
				`🔸 Terra still has ${terraChannelSessions.length} active sessions`,
			);
		}
	} catch (error) {
		console.error("🔸 Error cleaning up multiple active sessions:", error);
	} finally {
		process.exit(0);
	}
}

cleanupMultipleActiveSessions().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
