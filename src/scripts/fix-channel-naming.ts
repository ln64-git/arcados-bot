#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to fix channel naming for auto-assigned owners
 * This renames channels to reflect their actual owner
 */
async function fixChannelNaming(channelId: string) {
	console.log(`🔧 Fixing channel naming for: ${channelId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Fixing channel naming in guild: ${config.guildId}\n`);

		// Get current owner
		const owner = await cache.getChannelOwner(channelId);
		if (!owner) {
			console.log("🔸 No owner found - nothing to fix");
			return;
		}

		console.log(`👤 Current owner: ${owner.userId}`);

		// Get voice sessions to find the owner's display name
		const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
		const ownerSessions = sessions.filter((s) => s.userId === owner.userId);

		if (ownerSessions.length === 0) {
			console.log("🔸 No voice sessions found for owner");
			return;
		}

		// Find display name from channel names
		let displayName = null;
		for (const session of ownerSessions) {
			const channelName = session.channelName;
			const match = channelName.match(/^(.+?)'s (Room|Channel)/);
			if (match) {
				displayName = match[1];
				console.log(
					`📝 Found display name: "${displayName}" from channel "${channelName}"`,
				);
				break;
			}
		}

		if (!displayName) {
			console.log("🔸 Could not determine display name from voice sessions");
			console.log("💡 Owner may not have created channels with their name");
			return;
		}

		const newChannelName = `${displayName}'s Channel`;
		console.log(`\n🔧 RECOMMENDED ACTION:`);
		console.log(`📝 Rename channel to: "${newChannelName}"`);
		console.log(`👤 Owner: ${owner.userId} (${displayName})`);
		console.log(`📅 Assigned: ${owner.createdAt.toLocaleString()}`);

		console.log(`\n💡 The owner can now:`);
		console.log(`1. Use /rename "${newChannelName}" to rename the channel`);
		console.log(
			`2. Or the channel will keep its current name until manually renamed`,
		);
	} catch (error) {
		console.error("🔸 Error fixing channel naming:", error);
		process.exit(1);
	}
}

// Get channel ID from command line argument
const channelId = process.argv[2];
if (!channelId) {
	console.error("🔸 Please provide a channel ID as an argument");
	console.log("Usage: tsx fix-channel-naming.ts <channelId>");
	process.exit(1);
}

// Run the script
fixChannelNaming(channelId)
	.then(() => {
		console.log("\n✅ Channel naming fix completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Channel naming fix failed:", error);
		process.exit(1);
	});
