#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";

/**
 * Script to trigger channel renaming by calling setChannelOwner
 * This will use the VoiceManager's integrated renaming logic
 */
async function triggerChannelRename(channelId: string) {
	console.log(`🔧 Triggering channel rename for: ${channelId}\n`);

	try {
		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Triggering rename in guild: ${config.guildId}\n`);

		// Get current owner
		const owner = await cache.getChannelOwner(channelId);
		if (!owner) {
			console.log("🔸 No owner found - cannot rename");
			return;
		}

		console.log(`👤 Current owner: ${owner.userId}`);
		console.log(`📅 Owner since: ${owner.createdAt.toLocaleString()}`);

		// Import VoiceManager to use its setChannelOwner method
		const { VoiceManager } = await import(
			"../features/voice-manager/VoiceManager.js"
		);

		// Create a mock client (we only need the setChannelOwner method)
		const mockClient = {
			channels: {
				cache: new Map(),
			},
		} as any;

		const voiceManager = new VoiceManager(mockClient);

		// Call setChannelOwner to trigger the renaming logic
		console.log(`🔧 Calling setChannelOwner to trigger renaming...`);
		await voiceManager.setChannelOwner(channelId, owner.userId, config.guildId);

		console.log(`✅ Channel rename triggered successfully!`);

		console.log(`\n📋 RESULT:`);
		console.log("=".repeat(50));
		console.log(`👤 Owner: ${owner.userId}`);
		console.log(`📅 Ownership since: ${owner.createdAt.toLocaleString()}`);
		console.log(
			`💡 Channel should now be renamed to reflect the owner's display name`,
		);
	} catch (error) {
		console.error("🔸 Error triggering channel rename:", error);
		process.exit(1);
	}
}

// Get channel ID from command line argument
const channelId = process.argv[2];
if (!channelId) {
	console.error("🔸 Please provide a channel ID as an argument");
	console.log("Usage: tsx trigger-channel-rename.ts <channelId>");
	process.exit(1);
}

// Run the script
triggerChannelRename(channelId)
	.then(() => {
		console.log("\n✅ Channel rename trigger completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Channel rename trigger failed:", error);
		process.exit(1);
	});
