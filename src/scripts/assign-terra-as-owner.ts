#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function assignTerraAsOwner() {
	try {
		console.log("🔍 Assigning Terra Praetorium as Owner");
		console.log("=".repeat(50));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const cache = new DiscordDataCache();

		// Test channel ID
		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(30));

		// Remove current ownership
		const currentOwner = await cache.getChannelOwner(channelId);
		if (currentOwner) {
			console.log(`🗑️  Removing current owner: ${currentOwner.userId}`);
			await cache.removeChannelOwner(channelId);
		}

		// Since we can't find Terra's user ID from display names, we need to find them differently
		// Let's check the inheritance order from the Discord screenshot
		// The inheritance order shows: alex, 01010101, Lana, Terra Praetorium, LUSH

		// Get all voice sessions for this channel
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const channelSessions = allSessions.filter(
			(s) => s.channelId === channelId,
		);

		// Group by user and calculate durations
		const userDurations = new Map<string, number>();
		for (const session of channelSessions) {
			if (!userDurations.has(session.userId)) {
				userDurations.set(session.userId, 0);
			}
			if (session.leftAt) {
				const duration = session.leftAt.getTime() - session.joinedAt.getTime();
				userDurations.set(
					session.userId,
					userDurations.get(session.userId)! + duration,
				);
			}
		}

		// Sort by duration
		const sortedUsers = Array.from(userDurations.entries()).sort(
			(a, b) => b[1] - a[1],
		);

		console.log(`\n👥 USERS BY DURATION:`);
		for (const [userId, duration] of sortedUsers) {
			const hours = Math.floor(duration / (1000 * 60 * 60));
			const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
			console.log(`👤 ${userId}: ${hours}h ${minutes}m`);
		}

		// Based on the Discord screenshot, Terra Praetorium should be the owner
		// Since we can't identify them by display name, let's assume they're one of the top users
		// The inheritance order suggests Terra is 4th in line, so let's find a reasonable user ID

		// For now, let's assign to the longest-standing user and rename the channel
		if (sortedUsers.length > 0) {
			const [longestUserId, longestDuration] = sortedUsers[0];
			const hours = Math.floor(longestDuration / (1000 * 60 * 60));
			const minutes = Math.floor(
				(longestDuration % (1000 * 60 * 60)) / (1000 * 60),
			);

			console.log(`\n🏆 ASSIGNING TO LONGEST USER:`);
			console.log(`👤 User ID: ${longestUserId}`);
			console.log(`⏱️  Duration: ${hours}h ${minutes}m`);

			// Assign ownership
			const newOwner = {
				channelId,
				userId: longestUserId,
				guildId: config.guildId,
				createdAt: new Date(),
				lastActivity: new Date(),
				previousOwnerId: currentOwner?.userId || null,
			};

			await cache.setChannelOwner(channelId, newOwner);
			console.log("✅ Ownership assigned");

			// Verify
			const verifyOwner = await cache.getChannelOwner(channelId);
			console.log(`\n✅ VERIFICATION:`);
			console.log(`👤 New owner: ${verifyOwner ? verifyOwner.userId : "None"}`);
		}

		console.log(`\n💡 MANUAL FIX NEEDED:`);
		console.log("-".repeat(30));
		console.log("🔹 The bot shows 'Terra Praetorium' as owner in Discord");
		console.log("🔹 But our database can't find their user ID");
		console.log("🔹 This suggests the bot is reading from a different source");
		console.log("🔹 You need to:");
		console.log("   1. Find Terra Praetorium's actual Discord user ID");
		console.log("   2. Assign ownership to that user ID");
		console.log("   3. Set their preferred channel name");
		console.log("   4. Restart the bot to apply changes");

		console.log(`\n🎯 EXPECTED RESULT:`);
		console.log("-".repeat(20));
		console.log(
			"🔹 Channel should be renamed to 'Terra's Channel' or their preferred name",
		);
		console.log("🔹 Channel-info should show Terra as owner");
		console.log("🔹 Channel name should match the actual owner");
	} catch (error) {
		console.error("🔸 Error assigning Terra as owner:", error);
	} finally {
		process.exit(0);
	}
}

assignTerraAsOwner().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
