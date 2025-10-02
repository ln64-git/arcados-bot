#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function findTerraPraetorium() {
	try {
		console.log("🔍 Finding Terra Praetorium User ID");
		console.log("=".repeat(40));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Get all voice sessions to find Terra Praetorium
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);

		// Look for sessions with display name containing "Terra" or "Praetorium"
		const terraSessions = allSessions.filter(
			(s) =>
				s.displayName &&
				(s.displayName.toLowerCase().includes("terra") ||
					s.displayName.toLowerCase().includes("praetorium")),
		);

		console.log(`\n🔍 TERRA PRAETORIUM SESSIONS:`);
		console.log("-".repeat(30));

		if (terraSessions.length === 0) {
			console.log(
				"🔸 No sessions found with 'Terra' or 'Praetorium' in display name",
			);

			// Let's check all unique display names to see what we have
			const displayNames = new Set<string>();
			for (const session of allSessions) {
				if (session.displayName) {
					displayNames.add(session.displayName);
				}
			}

			console.log(
				`\n📝 ALL UNIQUE DISPLAY NAMES (${displayNames.size} total):`,
			);
			const sortedNames = Array.from(displayNames).sort();
			for (const name of sortedNames) {
				console.log(`👤 "${name}"`);
			}
		} else {
			// Group by user ID
			const terraUsers = new Map<string, any[]>();
			for (const session of terraSessions) {
				if (!terraUsers.has(session.userId)) {
					terraUsers.set(session.userId, []);
				}
				terraUsers.get(session.userId)!.push(session);
			}

			for (const [userId, sessions] of terraUsers) {
				console.log(`\n👤 User ID: ${userId}`);
				console.log(`📊 Sessions: ${sessions.length}`);

				// Get all unique display names for this user
				const userDisplayNames = new Set<string>();
				for (const session of sessions) {
					if (session.displayName) {
						userDisplayNames.add(session.displayName);
					}
				}

				console.log(`📝 Display names used:`);
				for (const name of userDisplayNames) {
					console.log(`   - "${name}"`);
				}

				// Show recent sessions
				const recentSessions = sessions
					.sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
					.slice(0, 3);

				console.log(`🕒 Recent sessions:`);
				for (const session of recentSessions) {
					const joined = session.joinedAt.toLocaleString();
					const left = session.leftAt
						? session.leftAt.toLocaleString()
						: "Still active";
					console.log(`   - ${joined} to ${left} (${session.displayName})`);
				}
			}
		}

		// Check current channel ownership
		const cache = new DiscordDataCache();
		const channelId = "1423358562683326647";
		const owner = await cache.getChannelOwner(channelId);

		console.log(`\n📋 CURRENT CHANNEL OWNERSHIP:`);
		console.log("-".repeat(30));
		console.log(`👤 Owner ID: ${owner ? owner.userId : "None"}`);

		if (owner) {
			// Find sessions for this owner
			const ownerSessions = allSessions.filter(
				(s) => s.userId === owner.userId,
			);
			if (ownerSessions.length > 0) {
				const displayNames = new Set<string>();
				for (const session of ownerSessions) {
					if (session.displayName) {
						displayNames.add(session.displayName);
					}
				}

				console.log(`📝 Owner's display names:`);
				for (const name of displayNames) {
					console.log(`   - "${name}"`);
				}
			}
		}
	} catch (error) {
		console.error("🔸 Error finding Terra Praetorium:", error);
	} finally {
		process.exit(0);
	}
}

findTerraPraetorium().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
