#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to manually rename a channel to its owner's name
 * This fixes channels that were auto-assigned but not renamed
 */
async function renameChannelToOwner(channelId: string) {
	console.log(`🔧 Renaming channel to owner's name: ${channelId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Renaming channel in guild: ${config.guildId}\n`);

		// Get current owner
		const owner = await cache.getChannelOwner(channelId);
		if (!owner) {
			console.log("🔸 No owner found - cannot rename");
			return;
		}

		console.log(`👤 Current owner: ${owner.userId}`);

		// Get voice sessions to find the owner's most common display name
		const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const ownerSessions = sessions.filter((s) => s.userId === owner.userId);

		if (ownerSessions.length === 0) {
			console.log("🔸 No voice sessions found for owner");
			return;
		}

		// Find the most common display name from channel names
		const displayNameCounts = new Map<string, number>();
		for (const session of ownerSessions) {
			const channelName = session.channelName;
			const match = channelName.match(/^(.+?)'s (Room|Channel)/);
			if (match) {
				const displayName = match[1];
				const count = displayNameCounts.get(displayName) || 0;
				displayNameCounts.set(displayName, count + 1);
			}
		}

		if (displayNameCounts.size === 0) {
			console.log("🔸 Could not determine display name from voice sessions");
			return;
		}

		// Get the most common display name
		const sortedNames = Array.from(displayNameCounts.entries()).sort(
			(a, b) => b[1] - a[1],
		);

		const [mostCommonName, count] = sortedNames[0];

		console.log(
			`📝 Most common display name: "${mostCommonName}" (used ${count} times)`,
		);

		// Show all display names found
		console.log(`\n📋 All display names found:`);
		for (const [name, usageCount] of sortedNames) {
			console.log(`  📝 "${name}" (${usageCount} times)`);
		}

		const newChannelName = `${mostCommonName}'s Channel`;
		console.log(`\n🔧 RECOMMENDED ACTION:`);
		console.log(`📝 Rename channel to: "${newChannelName}"`);
		console.log(`👤 Owner: ${owner.userId} (${mostCommonName})`);
		console.log(`📅 Assigned: ${owner.createdAt.toLocaleString()}`);

		console.log(`\n💡 The owner can now:`);
		console.log(`1. Use /rename "${newChannelName}" to rename the channel`);
		console.log(
			`2. Or the channel will keep its current name until manually renamed`,
		);
	} catch (error) {
		console.error("🔸 Error renaming channel to owner:", error);
		process.exit(1);
	}
}

// Get channel ID from command line argument
const channelId = process.argv[2];
if (!channelId) {
	console.error("🔸 Please provide a channel ID as an argument");
	console.log("Usage: tsx rename-channel-to-owner.ts <channelId>");
	process.exit(1);
}

// Run the script
renameChannelToOwner(channelId)
	.then(() => {
		console.log("\n✅ Channel rename recommendation completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Channel rename recommendation failed:", error);
		process.exit(1);
	});
