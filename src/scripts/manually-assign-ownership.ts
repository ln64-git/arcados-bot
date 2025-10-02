#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function manuallyAssignOwnership() {
	try {
		console.log("🔍 Manually Assigning Ownership and Renaming Channel");
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

		if (owner) {
			console.log("🔸 Channel already has an owner");
			return;
		}

		// Get voice sessions to find current members
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

		if (currentMembers.size === 0) {
			console.log("🔸 No current members found");
			return;
		}

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

		if (sortedUsers.length === 0) {
			console.log("🔸 No users found for assignment");
			return;
		}

		const [longestUserId, longestDuration] = sortedUsers[0];
		const hours = Math.floor(longestDuration / (1000 * 60 * 60));
		const minutes = Math.floor(
			(longestDuration % (1000 * 60 * 60)) / (1000 * 60),
		);

		console.log(`\n🏆 LONGEST-STANDING USER:`);
		console.log(`👤 User ID: ${longestUserId}`);
		console.log(`⏱️  Duration: ${hours}h ${minutes}m`);

		// Get display name for this user
		const longestUserSessions = sessions.filter(
			(s) => s.userId === longestUserId,
		);
		const displayNameCounts = new Map<string, number>();

		for (const session of longestUserSessions) {
			if (session.displayName) {
				const count = displayNameCounts.get(session.displayName) || 0;
				displayNameCounts.set(session.displayName, count + 1);
			}
		}

		let channelNameToUse: string;
		if (displayNameCounts.size > 0) {
			const sortedNames = Array.from(displayNameCounts.entries()).sort(
				(a, b) => b[1] - a[1],
			);
			const [mostCommonName] = sortedNames[0];
			channelNameToUse = `${mostCommonName}'s Channel`;
			console.log(`📝 Using display name: "${mostCommonName}"`);
		} else {
			// Use user ID as fallback
			channelNameToUse = `User ${longestUserId}'s Channel`;
			console.log(`📝 No display name found, using user ID`);
		}

		console.log(`🏷️  Channel name: "${channelNameToUse}"`);

		// Assign ownership
		const newOwner = {
			channelId,
			userId: longestUserId,
			guildId: config.guildId,
			createdAt: new Date(),
			lastActivity: new Date(),
			previousOwnerId: null,
		};

		console.log(`\n🤖 ASSIGNING OWNERSHIP:`);
		await cache.setChannelOwner(channelId, newOwner);
		console.log("✅ Ownership assigned");

		// Verify assignment
		const verifyOwner = await cache.getChannelOwner(channelId);
		console.log(`\n✅ VERIFICATION:`);
		console.log(`👤 New owner: ${verifyOwner ? verifyOwner.userId : "None"}`);

		console.log(`\n💡 NEXT STEPS:`);
		console.log("-".repeat(20));
		console.log("🔹 Restart the bot to apply all fixes");
		console.log("🔹 The bot should now detect the new owner");
		console.log(`🔹 Channel should be renamed to "${channelNameToUse}"`);
		console.log("🔹 Channel-info command should show the correct owner");
	} catch (error) {
		console.error("🔸 Error manually assigning ownership:", error);
	} finally {
		process.exit(0);
	}
}

manuallyAssignOwnership().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
