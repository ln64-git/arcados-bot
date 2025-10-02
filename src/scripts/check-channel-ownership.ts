#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to check ownership status of a specific channel
 */
async function checkChannelOwnership(channelId: string) {
	console.log(`🔍 Checking ownership for channel: ${channelId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Checking channel ownership in guild: ${config.guildId}\n`);

		// Check ownership via cache (which checks both Redis and MongoDB)
		const owner = await cache.getChannelOwner(channelId);

		if (owner) {
			console.log("✅ CHANNEL HAS OWNER:");
			console.log(`👤 Owner ID: ${owner.userId}`);
			console.log(`🆔 Channel ID: ${owner.channelId}`);
			console.log(`🏰 Guild ID: ${owner.guildId}`);
			console.log(`📅 Created: ${owner.createdAt.toLocaleString()}`);
			console.log(`⏰ Last Activity: ${owner.lastActivity.toLocaleString()}`);
			if (owner.previousOwnerId) {
				console.log(`🔄 Previous Owner: ${owner.previousOwnerId}`);
			}
		} else {
			console.log("🔸 CHANNEL HAS NO OWNER");

			// Check if channel exists in voice sessions
			const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
			const channelSessions = sessions.filter((s) => s.channelId === channelId);

			if (channelSessions.length > 0) {
				console.log(
					`\n📊 Found ${channelSessions.length} voice sessions for this channel:`,
				);

				// Sort by join time
				channelSessions.sort(
					(a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
				);

				const firstSession = channelSessions[0];
				const lastSession = channelSessions[channelSessions.length - 1];

				console.log(
					`📅 First session: ${firstSession.joinedAt.toLocaleString()}`,
				);
				console.log(
					`📅 Last session: ${lastSession.leftAt?.toLocaleString() || "Active"}`,
				);
				console.log(`📝 Channel name: "${firstSession.channelName}"`);

				// Show potential owners (users who joined first)
				const uniqueUsers = new Set(channelSessions.map((s) => s.userId));
				console.log(`👥 Total unique users: ${uniqueUsers.size}`);

				// Find first user to join (potential owner)
				const firstUser = firstSession.userId;
				console.log(`👑 First user to join: ${firstUser}`);

				// Check if this user is still active
				const activeSessions = channelSessions.filter((s) => !s.leftAt);
				const activeUsers = new Set(activeSessions.map((s) => s.userId));
				console.log(`🟢 Currently active users: ${activeUsers.size}`);

				if (activeUsers.has(firstUser)) {
					console.log(
						`✅ First user is still active - they should be the owner`,
					);
				} else {
					console.log(`🔸 First user is no longer active`);

					// Find longest active user
					const userDurations = new Map<string, number>();
					for (const session of channelSessions) {
						if (!session.leftAt) continue; // Skip active sessions

						const duration = session.duration || 0;
						const existing = userDurations.get(session.userId) || 0;
						userDurations.set(session.userId, existing + duration);
					}

					if (userDurations.size > 0) {
						const longestUser = Array.from(userDurations.entries()).sort(
							(a, b) => b[1] - a[1],
						)[0];
						console.log(
							`⏰ Longest duration user: ${longestUser[0]} (${formatDuration(longestUser[1])})`,
						);
					}
				}
			} else {
				console.log("🔸 No voice sessions found for this channel");
			}
		}

		// Check if channel exists in Discord
		console.log(`\n🔍 Checking if channel exists in Discord...`);
		try {
			const { Client, GatewayIntentBits } = await import("discord.js");
			const client = new Client({
				intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
			});

			await client.login(process.env.DISCORD_TOKEN);
			await client.guilds.fetch();

			const guild = client.guilds.cache.get(config.guildId);
			if (guild) {
				const channel = guild.channels.cache.get(channelId);
				if (channel) {
					console.log(`✅ Channel exists in Discord: "${channel.name}"`);
					console.log(`📝 Type: ${channel.type}`);
					console.log(
						`👥 Member count: ${channel.isVoiceBased() ? (channel as any).members?.size || "Unknown" : "N/A"}`,
					);
				} else {
					console.log(
						`🔸 Channel not found in Discord (may have been deleted)`,
					);
				}
			} else {
				console.log(`🔸 Guild not found`);
			}

			client.destroy();
		} catch (error) {
			console.log(`🔸 Could not check Discord channel: ${error}`);
		}
	} catch (error) {
		console.error("🔸 Error checking channel ownership:", error);
		process.exit(1);
	}
}

/**
 * Format duration in seconds to human readable format
 */
function formatDuration(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	if (days > 0) {
		return `${days}d ${hours}h ${minutes}m`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${secs}s`;
	}
	return `${secs}s`;
}

// Get channel ID from command line argument
const channelId = process.argv[2];
if (!channelId) {
	console.error("🔸 Please provide a channel ID as an argument");
	console.log("Usage: tsx check-channel-ownership.ts <channelId>");
	process.exit(1);
}

// Run the script
checkChannelOwnership(channelId)
	.then(() => {
		console.log("\n✅ Channel ownership check completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Channel ownership check failed:", error);
		process.exit(1);
	});
