#!/usr/bin/env tsx

import { ChannelType, Client, GatewayIntentBits } from "discord.js";
import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to fix channel ownership discrepancies
 * This handles cases where the database shows an owner but the channel doesn't behave as owned
 */
async function fixChannelOwnership(channelId: string) {
	console.log(`🔧 Fixing ownership for channel: ${channelId}\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		// Initialize cache
		const cache = new DiscordDataCache();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

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
			// Clean up database entry
			await cache.removeChannelOwner(channelId);
			console.log("✅ Removed orphaned ownership record from database");
			return;
		}

		if (!channel.isVoiceBased() || channel.type !== ChannelType.GuildVoice) {
			console.log("🔸 Channel is not a voice channel");
			return;
		}

		const voiceChannel = channel as any; // VoiceChannel type

		console.log(`📺 Channel: "${voiceChannel.name}"`);
		console.log(`👥 Members: ${voiceChannel.members?.size || 0}`);

		// Get owner from database
		const owner = await cache.getChannelOwner(channelId);

		if (!owner) {
			console.log("🔸 No owner found in database");

			// Check if channel has members and assign ownership to longest-standing user
			if (voiceChannel.members && voiceChannel.members.size > 0) {
				console.log(
					"🔍 Channel has members but no owner - attempting to assign ownership",
				);

				// Get voice sessions to find longest-standing user
				const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
				const channelSessions = sessions.filter(
					(s) => s.channelId === channelId,
				);

				if (channelSessions.length > 0) {
					// Find user with longest total duration in this channel
					const userDurations = new Map<string, number>();
					for (const session of channelSessions) {
						const duration = session.duration || 0;
						const existing = userDurations.get(session.userId) || 0;
						userDurations.set(session.userId, existing + duration);
					}

					// Sort by duration and find someone who's currently in the channel
					const sortedUsers = Array.from(userDurations.entries()).sort(
						(a, b) => b[1] - a[1],
					);

					for (const [userId, duration] of sortedUsers) {
						if (voiceChannel.members.has(userId)) {
							console.log(
								`👑 Assigning ownership to ${userId} (${formatDuration(duration)} total time)`,
							);

							// Set ownership
							await cache.setChannelOwner(channelId, {
								userId,
								channelId,
								guildId: config.guildId,
								createdAt: new Date(),
								lastActivity: new Date(),
							});

							// Set permissions
							await voiceChannel.permissionOverwrites.create(userId, {
								ManageChannels: true,
								CreateInstantInvite: true,
								Connect: true,
								Speak: true,
								UseVAD: true,
								PrioritySpeaker: true,
								Stream: true,
							});

							console.log("✅ Ownership assigned and permissions set");
							break;
						}
					}
				}
			}
		} else {
			console.log(`👤 Database shows owner: ${owner.userId}`);

			// Check if owner is still in the channel
			const ownerInChannel = voiceChannel.members?.has(owner.userId);

			if (!ownerInChannel) {
				console.log("🔸 Owner is not in the channel");

				// Check if channel is empty
				if (!voiceChannel.members || voiceChannel.members.size === 0) {
					console.log("🔸 Channel is empty - removing ownership");
					await cache.removeChannelOwner(channelId);
					console.log("✅ Removed ownership for empty channel");
				} else {
					console.log(
						"🔸 Channel has members but owner is gone - transferring ownership",
					);

					// Find longest-standing user who's currently in the channel
					const sessions = await dbCore.getVoiceSessionsByGuild(config.guildId);
					const channelSessions = sessions.filter(
						(s) => s.channelId === channelId,
					);

					if (channelSessions.length > 0) {
						const userDurations = new Map<string, number>();
						for (const session of channelSessions) {
							const duration = session.duration || 0;
							const existing = userDurations.get(session.userId) || 0;
							userDurations.set(session.userId, existing + duration);
						}

						const sortedUsers = Array.from(userDurations.entries()).sort(
							(a, b) => b[1] - a[1],
						);

						for (const [userId, duration] of sortedUsers) {
							if (voiceChannel.members.has(userId)) {
								console.log(
									`🔄 Transferring ownership from ${owner.userId} to ${userId}`,
								);

								// Update ownership with previous owner info
								await cache.setChannelOwner(channelId, {
									userId,
									channelId,
									guildId: config.guildId,
									createdAt: owner.createdAt,
									lastActivity: new Date(),
									previousOwnerId: owner.userId,
								});

								// Clear old owner permissions
								const oldOverwrite =
									voiceChannel.permissionOverwrites.cache.get(owner.userId);
								if (oldOverwrite) {
									await oldOverwrite.delete("Ownership transfer");
								}

								// Set new owner permissions
								await voiceChannel.permissionOverwrites.create(userId, {
									ManageChannels: true,
									CreateInstantInvite: true,
									Connect: true,
									Speak: true,
									UseVAD: true,
									PrioritySpeaker: true,
									Stream: true,
								});

								console.log("✅ Ownership transferred and permissions updated");
								break;
							}
						}
					}
				}
			} else {
				console.log("✅ Owner is still in the channel");

				// Verify permissions are correct
				const ownerOverwrite = voiceChannel.permissionOverwrites.cache.get(
					owner.userId,
				);
				if (!ownerOverwrite) {
					console.log("🔸 Owner doesn't have permission overwrites - fixing");
					await voiceChannel.permissionOverwrites.create(owner.userId, {
						ManageChannels: true,
						CreateInstantInvite: true,
						Connect: true,
						Speak: true,
						UseVAD: true,
						PrioritySpeaker: true,
						Stream: true,
					});
					console.log("✅ Owner permissions restored");
				} else {
					console.log("✅ Owner has proper permissions");
				}
			}
		}

		client.destroy();
		console.log("\n✅ Channel ownership fix completed!");
	} catch (error) {
		console.error("🔸 Error fixing channel ownership:", error);
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
	console.log("Usage: tsx fix-channel-ownership.ts <channelId>");
	process.exit(1);
}

// Run the script
fixChannelOwnership(channelId)
	.then(() => {
		console.log("\n✅ Channel ownership fix completed!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Channel ownership fix failed:", error);
		process.exit(1);
	});
