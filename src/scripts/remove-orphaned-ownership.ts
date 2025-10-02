#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";

/**
 * Script to remove orphaned channel ownership
 * This removes ownership when the owner is no longer in Discord
 */
async function removeOrphanedOwnership(channelId: string) {
	console.log(`🗑️  Removing orphaned ownership for channel: ${channelId}\n`);

	try {
		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Removing orphaned ownership in guild: ${config.guildId}\n`);

		// Get current owner
		const owner = await cache.getChannelOwner(channelId);

		if (!owner) {
			console.log("🔸 No owner found in database - nothing to remove");
			return;
		}

		console.log(`👤 Current owner: ${owner.userId} (marvinsdc)`);
		console.log(`📅 Owner since: ${owner.createdAt.toLocaleString()}`);
		console.log(`⏰ Last activity: ${owner.lastActivity.toLocaleString()}`);

		// Remove ownership
		console.log(`\n🗑️  Removing ownership...`);
		await cache.removeChannelOwner(channelId);

		console.log(`✅ Ownership removed successfully!`);
		console.log(`\n📋 RESULT:`);
		console.log("=".repeat(50));
		console.log(`🔸 Channel ${channelId} no longer has an owner`);
		console.log(`💡 Anyone can now claim the channel using /claim`);
		console.log(`👥 Current users in channel: alex, Soap like Suave, LUSH`);
		console.log(`\n🔧 Next steps:`);
		console.log(
			`1. One of the current users should use /claim to take ownership`,
		);
		console.log(
			`2. Or the channel will remain unowned until someone claims it`,
		);
	} catch (error) {
		console.error("🔸 Error removing orphaned ownership:", error);
		process.exit(1);
	}
}

// Get channel ID from command line argument
const channelId = process.argv[2];
if (!channelId) {
	console.error("🔸 Please provide a channel ID as an argument");
	console.log("Usage: tsx remove-orphaned-ownership.ts <channelId>");
	process.exit(1);
}

// Run the script
removeOrphanedOwnership(channelId)
	.then(() => {
		console.log("\n✅ Orphaned ownership removal completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Orphaned ownership removal failed:", error);
		process.exit(1);
	});
