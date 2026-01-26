import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
	voiceStateCoordinator?: VoiceStateCoordinator;
}

const userLimitCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("user-limit")
		.setDescription("Set the user limit for your voice channel")
		.addIntegerOption((option) =>
			option
				.setName("limit")
				.setDescription("Maximum number of users (0 = unlimited)")
				.setRequired(true)
				.setMinValue(0)
				.setMaxValue(99),
		),

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

		const newLimit = interaction.options.getInteger("limit", true);
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
			// Defer reply since channel update can take time
			await interaction.deferReply({ ephemeral: false });

			// Check if this is a user channel and user is the owner
			const ownershipService = coordinator.getOwnershipService();
			const currentOwner = await ownershipService.getOwner(voiceChannel.id);

			if (!currentOwner) {
				await interaction.editReply({
					content: "🔸 This is not a user-owned voice channel.",
				});
				return;
			}

			if (currentOwner !== member.user.id) {
				await interaction.editReply({
					content: "🔸 You are not the owner of this channel.",
				});
				return;
			}

			// Set the user limit on the channel
			const oldLimit = voiceChannel.userLimit;
			await voiceChannel.setUserLimit(newLimit);

			// Save the new limit to user preferences
			const spawnChannelService = coordinator.getSpawnChannelService();
			await spawnChannelService.updatePreferences(
				member.user.id,
				interaction.guild.id,
				{ default_user_limit: newLimit },
			);

			const limitText = newLimit === 0 ? "unlimited" : newLimit.toString();
			const oldLimitText = oldLimit === 0 ? "unlimited" : oldLimit.toString();

			await interaction.editReply({
				content: ` Changed user limit from **${oldLimitText}** to **${limitText}**.`,
			});
		} catch (error) {
			console.error("🔸 Error in user-limit command:", error);

			// Try to respond with error
			try {
				if (interaction.deferred) {
					await interaction.editReply({
						content: "🔸 An error occurred while trying to set the user limit.",
					});
				} else {
					await interaction.reply({
						content: "🔸 An error occurred while trying to set the user limit.",
						ephemeral: true,
					});
				}
			} catch {
				// Ignore if we can't send error message
			}
		}
	},
};

export default userLimitCommand;

