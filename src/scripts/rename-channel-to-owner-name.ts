#!/usr/bin/env tsx

import { ChannelType, Client, GatewayIntentBits } from "discord.js";
import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to rename a channel to match its owner's name
 * This requires Discord API access to actually rename the channel
 */
async function renameChannelToOwnerName(channelId: string) {
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

		const newChannelName = `${mostCommonName}'s Channel`;
		console.log(`\n🔧 ATTEMPTING TO RENAME:`);
		console.log(`📝 New channel name: "${newChannelName}"`);

		// Initialize Discord client
		const client = new Client({
			intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
		});

		await client.login(process.env.DISCORD_TOKEN);
		await client.guilds.fetch();

		const guild = client.guilds.cache.get(config.guildId);
		if (!guild) {
			throw new Error("🔸 Guild not found");
		}

		// Get channel from Discord
		const channel = guild.channels.cache.get(channelId);
		if (!channel) {
			console.log("🔸 Channel not found in Discord (may have been deleted)");
			return;
		}

		if (!channel.isVoiceBased() || channel.type !== ChannelType.GuildVoice) {
			console.log("🔸 Channel is not a voice channel");
			return;
		}

		const voiceChannel = channel as any; // VoiceChannel type

		console.log(`📺 Current channel name: "${voiceChannel.name}"`);
		console.log(`📺 New channel name: "${newChannelName}"`);

		if (voiceChannel.name === newChannelName) {
			console.log("✅ Channel is already correctly named");
			return;
		}

		// Rename the channel
		try {
			await voiceChannel.setName(newChannelName);
			console.log(`✅ Channel renamed successfully to "${newChannelName}"`);
		} catch (error) {
			console.log(`🔸 Failed to rename channel: ${error}`);
			console.log("💡 The owner can manually rename using /rename command");
		}

		client.destroy();

		console.log(`\n📋 RESULT:`);
		console.log("=".repeat(50));
		console.log(`👤 Owner: ${owner.userId} (${mostCommonName})`);
		console.log(`📝 Channel name: "${newChannelName}"`);
		console.log(`📅 Ownership since: ${owner.createdAt.toLocaleString()}`);
	} catch (error) {
		console.error("🔸 Error renaming channel:", error);
		process.exit(1);
	}
}

// Get channel ID from command line argument
const channelId = process.argv[2];
if (!channelId) {
	console.error("🔸 Please provide a channel ID as an argument");
	console.log("Usage: tsx rename-channel-to-owner-name.ts <channelId>");
	process.exit(1);
}

// Run the script
renameChannelToOwnerName(channelId)
	.then(() => {
		console.log("\n✅ Channel rename completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Channel rename failed:", error);
		process.exit(1);
	});
