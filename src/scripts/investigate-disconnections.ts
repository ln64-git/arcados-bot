#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";
import type { VoiceSession } from "../types/database.js";

/**
 * Script to investigate why users are getting randomly disconnected when others join voice channels
 * This analyzes the specific case where Lana got disconnected when 01010101 joined
 */
async function investigateDisconnections() {
	console.log("🔍 Investigating random disconnections in voice channels...\n");

	try {
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		console.log(`📈 Found ${allSessions.length} total voice sessions\n`);

		// Look for sessions involving "Lana" and "01010101"
		const lanaSessions = allSessions.filter((session) =>
			session.channelName.toLowerCase().includes("lana"),
		);

		const binarySessions = allSessions.filter((session) =>
			session.channelName.toLowerCase().includes("01010101"),
		);

		console.log(`🔍 Found ${lanaSessions.length} sessions involving "Lana"`);
		console.log(
			`🔍 Found ${binarySessions.length} sessions involving "01010101"\n`,
		);

		// Analyze recent sessions to find the disconnection event
		const recentSessions = allSessions
			.sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
			.slice(0, 50);

		console.log("📋 RECENT VOICE SESSIONS (last 50):\n");
		console.log("=".repeat(100));
		console.log("Channel Name | User ID | Joined At | Left At | Duration");
		console.log("=".repeat(100));

		for (const session of recentSessions) {
			const duration = session.duration
				? `${Math.floor(session.duration / 60)}m`
				: "ongoing";
			const leftAt = session.leftAt
				? session.leftAt.toLocaleString()
				: "Still in";
			const userId = session.userId.substring(0, 8) + "...";

			console.log(
				`${session.channelName.padEnd(20)} | ${userId.padEnd(8)} | ${session.joinedAt.toLocaleString()} | ${leftAt.padEnd(20)} | ${duration}`,
			);
		}

		console.log("\n" + "=".repeat(100));

		// Look for potential disconnection patterns
		console.log("\n🔍 ANALYZING DISCONNECTION PATTERNS:\n");

		// Group sessions by channel ID to find channels with multiple users
		const channelGroups = new Map<string, VoiceSession[]>();
		for (const session of allSessions) {
			if (!channelGroups.has(session.channelId)) {
				channelGroups.set(session.channelId, []);
			}
			channelGroups.get(session.channelId)?.push(session);
		}

		// Find channels with multiple users and analyze timing
		const multiUserChannels = Array.from(channelGroups.entries())
			.filter(([_channelId, sessions]) => sessions.length > 1)
			.slice(0, 10); // Top 10 channels with most users

		console.log(
			"📊 CHANNELS WITH MULTIPLE USERS (analyzing for disconnection patterns):\n",
		);

		for (const [channelId, sessions] of multiUserChannels) {
			const sortedSessions = sessions.sort(
				(a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
			);
			const channelName = sortedSessions[0]?.channelName || "Unknown";

			console.log(`🆔 Channel: ${channelName} (${channelId})`);
			console.log(`👥 Users: ${sessions.length}`);

			// Look for suspicious timing patterns (users leaving shortly after others join)
			for (let i = 0; i < sortedSessions.length - 1; i++) {
				const currentSession = sortedSessions[i];
				const nextSession = sortedSessions[i + 1];

				const timeDiff =
					nextSession.joinedAt.getTime() - currentSession.joinedAt.getTime();
				const timeDiffSeconds = Math.floor(timeDiff / 1000);

				// If someone joins within 30 seconds of someone else, flag it
				if (timeDiffSeconds < 30 && timeDiffSeconds > 0) {
					console.log(
						`⚠️  SUSPICIOUS: ${currentSession.userId.substring(0, 8)}... joined, then ${nextSession.userId.substring(0, 8)}... joined ${timeDiffSeconds}s later`,
					);

					// Check if the first user left shortly after
					if (currentSession.leftAt) {
						const leaveTime = currentSession.leftAt.getTime();
						const nextJoinTime = nextSession.joinedAt.getTime();
						const leaveAfterJoin = leaveTime - nextJoinTime;

						if (leaveAfterJoin > 0 && leaveAfterJoin < 60000) {
							// Left within 1 minute
							console.log(
								`🚨 DISCONNECTION: ${currentSession.userId.substring(0, 8)}... left ${Math.floor(leaveAfterJoin / 1000)}s after ${nextSession.userId.substring(0, 8)}... joined`,
							);
						}
					}
				}
			}
			console.log("-".repeat(80));
		}

		console.log("\n🔧 POTENTIAL CAUSES OF RANDOM DISCONNECTIONS:\n");
		console.log("1. 🚫 User Preferences System:");
		console.log(
			"   - When someone joins a channel, the bot checks the channel owner's preferences",
		);
		console.log(
			"   - If the new joiner is in the owner's 'bannedUsers' list, they get disconnected",
		);
		console.log(
			"   - This could happen if preferences are corrupted or incorrectly populated",
		);

		console.log("\n2. 🔄 Permission Changes:");
		console.log("   - Channel ownership transfers might change permissions");
		console.log(
			"   - Users might lose 'Connect' permission and get disconnected",
		);

		console.log("\n3. 📊 Rate Limiting:");
		console.log("   - Discord API rate limits might cause connection issues");
		console.log(
			"   - Bot might be hitting limits when processing multiple joins",
		);

		console.log("\n4. 🐛 Bot Logic Issues:");
		console.log("   - applyPreferencesToNewJoiner() method might have bugs");
		console.log("   - Channel state management might be inconsistent");

		console.log("\n🎯 RECOMMENDED INVESTIGATION STEPS:\n");
		console.log(
			"1. Check the bot logs for the specific time when Lana got disconnected",
		);
		console.log("2. Look for 'Owner preferences: pre-banned' messages in logs");
		console.log(
			"3. Check if 01010101 or Lana are in each other's banned users list",
		);
		console.log("4. Verify channel permissions haven't been corrupted");
		console.log(
			"5. Check if there are any error messages during the disconnection",
		);

		console.log("\n📋 DEBUGGING COMMANDS:\n");
		console.log("Run these commands to investigate further:");
		console.log(
			"1. Check user preferences: /debug-user-preferences user:@lana",
		);
		console.log(
			"2. Check channel state: /debug-channel-state channel:<channel-id>",
		);
		console.log("3. Check bot logs around the time of disconnection");
	} catch (error) {
		console.error("🔸 Error during disconnection investigation:", error);
	} finally {
		console.log("\n✅ Disconnection investigation completed!\n");
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	investigateDisconnections().catch(console.error);
}
