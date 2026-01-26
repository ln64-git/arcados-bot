import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
	voiceStateCoordinator?: VoiceStateCoordinator;
}

export const lockCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("lock")
		.setDescription("Lock your voice channel")
		.addBooleanOption((option) =>
			option
				.setName("unlock")
				.setDescription("Set to true to unlock instead")
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

			// Get toggle option (true = unlock, false/default = lock)
			const shouldUnlock = interaction.options.getBoolean("unlock") ?? false;

			// Get @everyone role
			const everyoneRole = interaction.guild.roles.everyone;

			// Update permissions
			if (shouldUnlock) {
				// Unlock: Allow Connect permission for @everyone
				await voiceChannel.permissionOverwrites.edit(everyoneRole.id, {
					Connect: true,
				});

				await interaction.editReply({
					content: " Unlocked the channel. Everyone can now join.",
				});
			} else {
				// Lock: Deny Connect permission for @everyone
				await voiceChannel.permissionOverwrites.edit(everyoneRole.id, {
					Connect: false,
				});

				await interaction.editReply({
					content: " Locked the channel. Only you can allow others to join.",
				});
			}
		} catch (error) {
			console.error("🔸 Error in lock command:", error);

			// Try to respond with error
			try {
				if (interaction.deferred) {
					await interaction.editReply({
						content: "🔸 An error occurred while trying to lock/unlock the channel.",
					});
				} else {
					await interaction.reply({
						content: "🔸 An error occurred while trying to lock/unlock the channel.",
						ephemeral: true,
					});
				}
			} catch {
				// Ignore if we can't send error message
			}
		}
	},
};

