#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function triggerInactiveOwnerFix() {
	try {
		console.log("🔍 Triggering Inactive Owner Fix");
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
		console.log(`👤 Current owner: ${owner ? owner.userId : "None"}`);

		if (!owner) {
			console.log("🔸 No owner found - channel is already orphaned");
			return;
		}

		// Get voice sessions to simulate current channel members
		const allSessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const sessions = allSessions.filter((s) => s.channelId === channelId);

		// Simulate current channel members (users with recent sessions)
		const recentSessions = sessions.filter((s) => {
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
			return s.joinedAt > oneHourAgo || (s.leftAt && s.leftAt > oneHourAgo);
		});

		const currentMembers = new Set<string>();
		for (const session of recentSessions) {
			currentMembers.add(session.userId);
		}

		console.log(`\n👥 CURRENT CHANNEL MEMBERS:`);
		for (const userId of currentMembers) {
			console.log(`👤 ${userId}`);
		}

		// Check if owner is in current members
		const ownerInChannel = currentMembers.has(owner.userId);
		console.log(`\n🔍 OWNER STATUS:`);
		console.log(`👤 Owner ID: ${owner.userId}`);
		console.log(`📍 Owner in channel: ${ownerInChannel ? "✅ YES" : "❌ NO"}`);

		if (!ownerInChannel) {
			console.log(`\n🤖 TRIGGERING INACTIVE OWNER FIX:`);
			console.log("=".repeat(40));

			// Remove ownership
			console.log("🔹 Removing ownership from inactive owner...");
			await cache.removeChannelOwner(channelId);
			console.log("✅ Ownership removed");

			// Find longest-standing user
			const userDurations = new Map<string, number>();
			for (const userId of currentMembers) {
				const userSessions = sessions.filter((s) => s.userId === userId);
				let totalDuration = 0;
				for (const session of userSessions) {
					if (session.leftAt) {
						totalDuration +=
							session.leftAt.getTime() - session.joinedAt.getTime();
					}
				}
				userDurations.set(userId, totalDuration);
			}

			const sortedUsers = Array.from(userDurations.entries()).sort(
				(a, b) => b[1] - a[1],
			);

			if (sortedUsers.length > 0) {
				const [longestUserId, longestDuration] = sortedUsers[0];
				const hours = Math.floor(longestDuration / (1000 * 60 * 60));
				const minutes = Math.floor(
					(longestDuration % (1000 * 60 * 60)) / (1000 * 60),
				);

				console.log(`\n🏆 ASSIGNING TO LONGEST-STANDING USER:`);
				console.log(`👤 User ID: ${longestUserId}`);
				console.log(`⏱️  Duration: ${hours}h ${minutes}m`);

				// Assign new ownership
				const newOwner = {
					channelId,
					userId: longestUserId,
					guildId: config.guildId,
					createdAt: new Date(),
					lastActivity: new Date(),
					previousOwnerId: owner.userId,
				};

				await cache.setChannelOwner(channelId, newOwner);
				console.log("✅ New ownership assigned");

				// Verify the change
				const newOwnerCheck = await cache.getChannelOwner(channelId);
				console.log(`\n✅ VERIFICATION:`);
				console.log(
					`👤 New owner: ${newOwnerCheck ? newOwnerCheck.userId : "None"}`,
				);
			}
		} else {
			console.log(`\n✅ Owner is present in channel - no fix needed`);
		}
	} catch (error) {
		console.error("🔸 Error triggering inactive owner fix:", error);
	} finally {
		process.exit(0);
	}
}

triggerInactiveOwnerFix().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
