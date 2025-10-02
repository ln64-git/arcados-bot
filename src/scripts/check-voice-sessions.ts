#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function checkVoiceSessions() {
	try {
		console.log("🔍 Checking Voice Sessions Data");
		console.log("=".repeat(40));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Get all voice sessions
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);

		console.log(`📊 Total voice sessions: ${allSessions.length}`);

		if (allSessions.length === 0) {
			console.log("🔸 No voice sessions found");
			return;
		}

		// Show sample sessions
		console.log(`\n📋 SAMPLE VOICE SESSIONS (first 10):`);
		console.log("-".repeat(50));

		const sampleSessions = allSessions.slice(0, 10);
		for (const session of sampleSessions) {
			console.log(`👤 User: ${session.userId}`);
			console.log(`📝 Display Name: ${session.displayName || "null"}`);
			console.log(`📍 Channel: ${session.channelId}`);
			console.log(`🕒 Joined: ${session.joinedAt.toLocaleString()}`);
			console.log(
				`🕒 Left: ${session.leftAt ? session.leftAt.toLocaleString() : "null"}`,
			);
			console.log(`---`);
		}

		// Check for sessions with display names
		const sessionsWithNames = allSessions.filter((s) => s.displayName);
		console.log(
			`\n📊 Sessions with display names: ${sessionsWithNames.length}/${allSessions.length}`,
		);

		if (sessionsWithNames.length > 0) {
			console.log(`\n📝 UNIQUE DISPLAY NAMES:`);
			const displayNames = new Set<string>();
			for (const session of sessionsWithNames) {
				displayNames.add(session.displayName!);
			}

			const sortedNames = Array.from(displayNames).sort();
			for (const name of sortedNames) {
				console.log(`👤 "${name}"`);
			}
		}

		// Check specific channel
		const channelId = "1423358562683326647";
		const channelSessions = allSessions.filter(
			(s) => s.channelId === channelId,
		);

		console.log(`\n📋 CHANNEL ${channelId} SESSIONS:`);
		console.log("-".repeat(30));
		console.log(`📊 Total sessions: ${channelSessions.length}`);

		if (channelSessions.length > 0) {
			// Group by user
			const userSessions = new Map<string, any[]>();
			for (const session of channelSessions) {
				if (!userSessions.has(session.userId)) {
					userSessions.set(session.userId, []);
				}
				userSessions.get(session.userId)!.push(session);
			}

			for (const [userId, sessions] of userSessions) {
				console.log(`\n👤 User ID: ${userId}`);
				console.log(`📊 Sessions: ${sessions.length}`);

				// Get display names
				const displayNames = new Set<string>();
				for (const session of sessions) {
					if (session.displayName) {
						displayNames.add(session.displayName);
					}
				}

				if (displayNames.size > 0) {
					console.log(`📝 Display names:`);
					for (const name of displayNames) {
						console.log(`   - "${name}"`);
					}
				} else {
					console.log(`📝 Display names: None stored`);
				}
			}
		}
	} catch (error) {
		console.error("🔸 Error checking voice sessions:", error);
	} finally {
		process.exit(0);
	}
}

checkVoiceSessions().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
