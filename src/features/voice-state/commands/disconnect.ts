import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
	voiceStateCoordinator?: VoiceStateCoordinator;
}

export const disconnectCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("disconnect")
		.setDescription("Disconnect a user from your voice channel")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to disconnect from the channel")
				.setRequired(true),
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

		const targetUser = interaction.options.getUser("user", true);
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
			// Defer reply since disconnect can take time
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

			// Check if target is in the channel
			const targetMember = voiceChannel.members.get(targetUser.id);
			if (!targetMember) {
				await interaction.editReply({
					content: "🔸 The target user is not in this voice channel.",
				});
				return;
			}

			// Prevent disconnecting yourself
			if (targetUser.id === member.user.id) {
				await interaction.editReply({
					content: "🔸 You cannot disconnect yourself from the channel.",
				});
				return;
			}

			// Disconnect the user
			await targetMember.voice.disconnect("Disconnected by channel owner");

			await interaction.editReply({
				content: ` Disconnected **${targetUser.displayName}** from the channel.`,
			});
		} catch (error) {
			console.error("🔸 Error in disconnect command:", error);

			// Try to respond with error
			try {
				if (interaction.deferred) {
					await interaction.editReply({
						content: "🔸 An error occurred while trying to disconnect the user.",
					});
				} else {
					await interaction.reply({
						content: "🔸 An error occurred while trying to disconnect the user.",
						ephemeral: true,
					});
				}
			} catch {
				// Ignore if we can't send error message
			}
		}
	},
};

