#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to simulate the VoiceManager's renaming logic
 * This shows what the channel name should be based on the owner
 */
async function simulateChannelRename(channelId: string) {
	console.log(`🔧 Simulating channel rename for: ${channelId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Simulating rename in guild: ${config.guildId}\n`);

		// Get current owner
		const owner = await cache.getChannelOwner(channelId);
		if (!owner) {
			console.log("🔸 No owner found - cannot rename");
			return;
		}

		console.log(`👤 Current owner: ${owner.userId}`);
		console.log(`📅 Owner since: ${owner.createdAt.toLocaleString()}`);

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
			console.log(
				"💡 The VoiceManager will use the owner's current Discord display name",
			);
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

		const expectedChannelName = `${mostCommonName}'s Channel`;

		console.log(`\n🎯 VOICE MANAGER SIMULATION:`);
		console.log("=".repeat(50));
		console.log(`👤 Owner: ${owner.userId}`);
		console.log(`📝 Expected channel name: "${expectedChannelName}"`);
		console.log(`📅 Ownership since: ${owner.createdAt.toLocaleString()}`);

		console.log(`\n💡 WHAT THE VOICE MANAGER WILL DO:`);
		console.log(`1. Check if owner has preferredChannelName preference`);
		console.log(`2. If not, use owner's Discord display name`);
		console.log(`3. Rename channel to "${expectedChannelName}"`);
		console.log(`4. Skip if channel name contains "available"`);

		console.log(`\n🔧 TO APPLY THIS CHANGE:`);
		console.log(`The owner can use: /rename "${expectedChannelName}"`);
		console.log(
			`Or the VoiceManager will auto-rename when someone joins the channel`,
		);
	} catch (error) {
		console.error("🔸 Error simulating channel rename:", error);
		process.exit(1);
	}
}

// Get channel ID from command line argument
const channelId = process.argv[2];
if (!channelId) {
	console.error("🔸 Please provide a channel ID as an argument");
	console.log("Usage: tsx simulate-channel-rename.ts <channelId>");
	process.exit(1);
}

// Run the script
simulateChannelRename(channelId)
	.then(() => {
		console.log("\n✅ Channel rename simulation completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Channel rename simulation failed:", error);
		process.exit(1);
	});
