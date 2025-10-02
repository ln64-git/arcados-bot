#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function identifyOwner() {
	try {
		console.log("🔍 Identifying Channel Owner");
		console.log("=".repeat(40));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const cache = new DiscordDataCache();

		// Test channel ID
		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(30));

		// Check current ownership
		const owner = await cache.getChannelOwner(channelId);
		console.log(`👤 Owner ID: ${owner ? owner.userId : "None"}`);

		if (!owner) {
			console.log("🔸 No owner found");
			return;
		}

		// Get voice sessions to find this user's display names
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const ownerSessions = allSessions.filter((s) => s.userId === owner.userId);

		console.log(`\n📊 OWNER'S VOICE SESSIONS:`);
		console.log(`📈 Total sessions: ${ownerSessions.length}`);

		if (ownerSessions.length > 0) {
			// Get all display names used by this user
			const displayNames = new Set<string>();
			for (const session of ownerSessions) {
				if (session.displayName) {
					displayNames.add(session.displayName);
				}
			}

			if (displayNames.size > 0) {
				console.log(`\n📝 DISPLAY NAMES USED:`);
				for (const name of displayNames) {
					console.log(`👤 "${name}"`);
				}

				// Check if any contain "Terra" or "Praetorium"
				const terraNames = Array.from(displayNames).filter(
					(name) =>
						name.toLowerCase().includes("terra") ||
						name.toLowerCase().includes("praetorium"),
				);

				if (terraNames.length > 0) {
					console.log(`\n🎯 TERRA PRAETORIUM MATCHES:`);
					for (const name of terraNames) {
						console.log(`👤 "${name}"`);
					}
				} else {
					console.log(`\n🔸 No "Terra" or "Praetorium" found in display names`);
				}
			} else {
				console.log(`\n🔸 No display names found for this user`);
			}

			// Show recent sessions
			const recentSessions = ownerSessions
				.sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
				.slice(0, 5);

			console.log(`\n🕒 RECENT SESSIONS:`);
			for (const session of recentSessions) {
				const joined = session.joinedAt.toLocaleString();
				const left = session.leftAt
					? session.leftAt.toLocaleString()
					: "Still active";
				const displayName = session.displayName || "No display name";
				console.log(`📅 ${joined} to ${left} (${displayName})`);
			}
		}

		// Check if this user is currently in the channel
		const channelSessions = allSessions.filter(
			(s) => s.channelId === channelId,
		);
		const recentSessions = channelSessions.filter((s) => {
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
			return s.joinedAt > oneHourAgo || (s.leftAt && s.leftAt > oneHourAgo);
		});

		const currentMembers = new Set<string>();
		for (const session of recentSessions) {
			currentMembers.add(session.userId);
		}

		const ownerInChannel = currentMembers.has(owner.userId);
		console.log(`\n📍 OWNER STATUS:`);
		console.log(`👤 Owner ID: ${owner.userId}`);
		console.log(`📍 In channel: ${ownerInChannel ? "✅ YES" : "❌ NO"}`);

		if (!ownerInChannel) {
			console.log(`\n🤖 OWNER IS INACTIVE - SHOULD BE REASSIGNED`);
		} else {
			console.log(`\n✅ OWNER IS ACTIVE - NO REASSIGNMENT NEEDED`);
		}

		console.log(`\n💡 CONCLUSION:`);
		console.log("-".repeat(20));
		console.log("🔹 If owner is inactive, the bot should reassign ownership");
		console.log(
			"🔹 If bot shows 'Terra Praetorium', there might be a display name issue",
		);
		console.log(
			"🔹 The bot should use our database, not Discord's channel permissions",
		);
	} catch (error) {
		console.error("🔸 Error identifying owner:", error);
	} finally {
		process.exit(0);
	}
}

identifyOwner().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
