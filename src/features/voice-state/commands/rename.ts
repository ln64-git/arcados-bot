import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
	voiceStateCoordinator?: VoiceStateCoordinator;
}

const renameCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("rename")
		.setDescription("Rename your voice channel")
		.addStringOption((option) =>
			option
				.setName("name")
				.setDescription("The new name for your channel")
				.setRequired(true)
				.setMaxLength(100),
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

		const newName = interaction.options.getString("name", true);
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
			// Defer reply since channel rename can take time
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

			// Rename the channel
			const oldName = voiceChannel.name;
			await voiceChannel.setName(newName);

			// Save the new name to user preferences
			const spawnChannelService = coordinator.getSpawnChannelService();
			await spawnChannelService.updatePreferences(
				member.user.id,
				interaction.guild.id,
				{ channel_name: newName },
			);

			await interaction.editReply({
				content: `🔹 Renamed channel from **${oldName}** to **${newName}**.`,
			});
		} catch (error) {
			console.error("🔸 Error in rename command:", error);

			// Try to respond with error
			try {
				if (interaction.deferred) {
					await interaction.editReply({
						content: "🔸 An error occurred while trying to rename the channel.",
					});
				} else {
					await interaction.reply({
						content: "🔸 An error occurred while trying to rename the channel.",
						ephemeral: true,
					});
				}
			} catch {
				// Ignore if we can't send error message
			}
		}
	},
};

export default renameCommand;
