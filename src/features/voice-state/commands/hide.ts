import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
	voiceStateCoordinator?: VoiceStateCoordinator;
}

export const hideCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("hide")
		.setDescription("Hide your voice channel")
		.addBooleanOption((option) =>
			option
				.setName("unhide")
				.setDescription("Set to true to unhide instead")
				.setRequired(false),
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
			// Defer reply since permission updates can take time
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

			// Get toggle option (true = unhide, false/default = hide)
			const shouldUnhide = interaction.options.getBoolean("unhide") ?? false;

			// Get @everyone role
			const everyoneRole = interaction.guild.roles.everyone;

			// Update permissions
			if (shouldUnhide) {
				// Unhide: Allow ViewChannel permission for @everyone
				await voiceChannel.permissionOverwrites.edit(everyoneRole.id, {
					ViewChannel: true,
				});

				await interaction.editReply({
					content: "🔹 Unhid the channel. It is now visible to everyone.",
				});
			} else {
				// Hide: Deny ViewChannel permission for @everyone
				await voiceChannel.permissionOverwrites.edit(everyoneRole.id, {
					ViewChannel: false,
				});

				await interaction.editReply({
					content: "🔹 Hid the channel. It is now invisible to others.",
				});
			}
		} catch (error) {
			console.error("🔸 Error in hide command:", error);

			// Try to respond with error
			try {
				if (interaction.deferred) {
					await interaction.editReply({
						content: "🔸 An error occurred while trying to hide/unhide the channel.",
					});
				} else {
					await interaction.reply({
						content: "🔸 An error occurred while trying to hide/unhide the channel.",
						ephemeral: true,
					});
				}
			} catch {
				// Ignore if we can't send error message
			}
		}
	},
};

