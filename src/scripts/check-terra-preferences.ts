#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function checkTerraPreferences() {
	try {
		console.log("🔍 Checking Terra Praetorium's Preferences");
		console.log("=".repeat(50));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const cache = new DiscordDataCache();

		// Test channel ID
		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(30));

		// Check current ownership
		const owner = await cache.getChannelOwner(channelId);
		console.log(`👤 Current owner: ${owner ? owner.userId : "None"}`);

		if (!owner) {
			console.log("🔸 No owner found");
			return;
		}

		// Get owner's preferences
		console.log(`\n🔍 CHECKING OWNER PREFERENCES:`);
		console.log(`👤 Owner ID: ${owner.userId}`);

		// Try to get user preferences from database
		try {
			const db = await dbCore.getDatabase();
			const usersCollection = db.collection("users");
			const userData = await usersCollection.findOne({
				discordId: owner.userId,
			});

			if (userData) {
				console.log(`\n📊 USER DATA FOUND:`);
				console.log(`👤 Discord ID: ${userData.discordId}`);

				if (userData.preferences) {
					console.log(`\n🎯 PREFERENCES:`);
					console.log(
						`🏷️  Preferred Channel Name: ${userData.preferences.preferredChannelName || "Not set"}`,
					);
					console.log(
						`👥 Preferred User Limit: ${userData.preferences.preferredUserLimit || "Not set"}`,
					);
					console.log(
						`🔒 Preferred Locked: ${userData.preferences.preferredLocked !== undefined ? userData.preferences.preferredLocked : "Not set"}`,
					);
				} else {
					console.log(`\n🔸 No preferences found for this user`);
				}

				if (userData.modPreferences) {
					console.log(`\n🛡️  MODERATION PREFERENCES:`);
					console.log(
						`🚫 Banned Users: ${userData.modPreferences.bannedUsers?.length || 0}`,
					);
					console.log(
						`🔇 Muted Users: ${userData.modPreferences.mutedUsers?.length || 0}`,
					);
					console.log(
						`🔇 Deafened Users: ${userData.modPreferences.deafenedUsers?.length || 0}`,
					);
				}
			} else {
				console.log(`\n🔸 No user data found in database`);
			}
		} catch (error) {
			console.log(`🔸 Error getting user data: ${error}`);
		}

		// Check voice sessions for display names
		console.log(`\n🔍 VOICE SESSIONS FOR OWNER:`);
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const ownerSessions = allSessions.filter((s) => s.userId === owner.userId);

		console.log(`📊 Total sessions: ${ownerSessions.length}`);

		if (ownerSessions.length > 0) {
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
			} else {
				console.log(`\n🔸 No display names found in voice sessions`);
			}
		}

		console.log(`\n💡 CHANNEL NAMING LOGIC:`);
		console.log("-".repeat(30));
		console.log("🔹 1. Check if owner has preferredChannelName");
		console.log("🔹 2. If not, use owner's display name + 's Channel'");
		console.log("🔹 3. If no display name, use username + 's Channel'");
		console.log("🔹 4. Channel should be renamed to reflect the actual owner");

		console.log(`\n🎯 EXPECTED CHANNEL NAME:`);
		console.log("-".repeat(30));
		console.log("🔹 If Terra has preferredChannelName: Use that");
		console.log("🔹 If Terra has display name: Use 'Terra's Channel'");
		console.log("🔹 If Terra has username: Use 'TerraPraetorium's Channel'");
		console.log("🔹 Current name '01010101's Channel' is incorrect");
	} catch (error) {
		console.error("🔸 Error checking Terra's preferences:", error);
	} finally {
		process.exit(0);
	}
}

checkTerraPreferences().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
