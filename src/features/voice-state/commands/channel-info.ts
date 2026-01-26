import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
	voiceStateCoordinator?: VoiceStateCoordinator;
}

export const channelInfoCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("channel-info")
		.setDescription("Display information about your current voice channel"),

	async execute(interaction) {
		if (!interaction.guild || !interaction.member) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server.",
				ephemeral: true,
			});
			return;
		}

		const member = interaction.member;
		if (!("voice" in member)) {
			await interaction.reply({
				content: "🔸 This command requires a guild member.",
				ephemeral: true,
			});
			return;
		}

		const voiceChannel = member.voice.channel;

		if (!voiceChannel) {
			await interaction.reply({
				content: "🔸 You must be in a voice channel to use this command.",
				ephemeral: true,
			});
			return;
		}

		// Get the voice state coordinator from the bot
		const bot = interaction.client as BotClient;
		const coordinator = bot.voiceStateCoordinator;

		if (!coordinator) {
			await interaction.reply({
				content: "🔸 Voice state coordinator is not available.",
				ephemeral: true,
			});
			return;
		}

		try {
			await interaction.deferReply({ ephemeral: true });

			// Get channel owner
			const ownershipService = coordinator.getOwnershipService();
			const ownerId = await ownershipService.getOwner(voiceChannel.id);

			if (!ownerId) {
				await interaction.editReply({
					content: "🔸 This is not a user-owned voice channel.",
				});
				return;
			}

			// Get owner's preferences
			const spawnChannelService = coordinator.getSpawnChannelService();
			const preferences = await spawnChannelService.getPreferences(
				ownerId,
				interaction.guild.id,
			);

			// Get owner member
			const ownerMember = await interaction.guild.members.fetch(ownerId).catch(() => null);
			const ownerName = ownerMember?.displayName || ownerMember?.user.tag || "Unknown";

			// Build embed
			const embed = new EmbedBuilder()
				.setTitle(`Channel Info: ${voiceChannel.name}`)
				.setColor(0x5865f2)
				.addFields(
					{
						name: "Owner",
						value: ownerName,
						inline: true,
					},
					{
						name: "Members",
						value: `${voiceChannel.members.size} / ${voiceChannel.userLimit || "∞"}`,
						inline: true,
					},
					{
						name: "Hidden",
						value: preferences.hidden ? "Yes" : "No",
						inline: true,
					},
				);

			// Add whitelist
			const whitelist = (preferences.whitelist as string[]) || [];
			if (whitelist.length > 0) {
				const whitelistMentions = await Promise.all(
					whitelist.slice(0, 10).map(async (userId) => {
						try {
							const user = await interaction.client.users.fetch(userId);
							return user.tag;
						} catch {
							return `Unknown (${userId})`;
						}
					}),
				);
				embed.addFields({
					name: `Whitelist (${whitelist.length})`,
					value: whitelistMentions.length > 0
						? whitelistMentions.join("\n") + (whitelist.length > 10 ? `\n... and ${whitelist.length - 10} more` : "")
						: "None",
					inline: false,
				});
			} else {
				embed.addFields({
					name: "Whitelist",
					value: "None",
					inline: false,
				});
			}

			// Add blacklist
			const blacklist = (preferences.blacklist as string[]) || [];
			if (blacklist.length > 0) {
				const blacklistMentions = await Promise.all(
					blacklist.slice(0, 10).map(async (userId) => {
						try {
							const user = await interaction.client.users.fetch(userId);
							return user.tag;
						} catch {
							return `Unknown (${userId})`;
						}
					}),
				);
				embed.addFields({
					name: `Blacklist (${blacklist.length})`,
					value: blacklistMentions.length > 0
						? blacklistMentions.join("\n") + (blacklist.length > 10 ? `\n... and ${blacklist.length - 10} more` : "")
						: "None",
					inline: false,
				});
			} else {
				embed.addFields({
					name: "Blacklist",
					value: "None",
					inline: false,
				});
			}



			await interaction.editReply({
				embeds: [embed],
			});
		} catch (error) {
			console.error("🔸 Error in channel-info command:", error);

			// Try to respond with error
			try {
				if (interaction.deferred) {
					await interaction.editReply({
						content: "🔸 An error occurred while trying to get channel information.",
					});
				} else {
					await interaction.reply({
						content: "🔸 An error occurred while trying to get channel information.",
						ephemeral: true,
					});
				}
			} catch {
				// Ignore if we can't send error message
			}
		}
	},
};
