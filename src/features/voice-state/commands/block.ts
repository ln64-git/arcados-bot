import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
	voiceStateCoordinator?: VoiceStateCoordinator;
}

export const blockCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("block")
		.setDescription("Block a user from voice channels with you")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to block")
				.setRequired(true),
		)
		.addBooleanOption((option) =>
			option
				.setName("unblock")
				.setDescription("Set to true to unblock instead")
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

		const targetUser = interaction.options.getUser("user", true);

		// Cannot block yourself
		if (targetUser.id === interaction.user.id) {
			await interaction.reply({
				content: "🔸 You cannot block yourself.",
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
			// Get toggle option (true = unblock, false/default = block)
			const shouldUnblock = interaction.options.getBoolean("unblock") ?? false;

			// Load current preferences
			const preferences = await coordinator.getSpawnChannelService().getPreferences(
				interaction.user.id,
				interaction.guild.id,
			);

			const blockedUsers = (preferences.blocked_users as string[]) || [];

			// Defer reply since permission updates can take time
			await interaction.deferReply({ ephemeral: true });

			if (shouldUnblock) {
				// Remove from block list (de-duped)
				const updatedBlockedUsers = blockedUsers.filter(
					(id) => id !== targetUser.id,
				);
				const updatedPreferences = {
					...preferences,
					blocked_users: updatedBlockedUsers,
				};

				await coordinator.getSpawnChannelService().updatePreferences(
					interaction.user.id,
					interaction.guild.id,
					updatedPreferences,
				);

				// Remove Discord permission overrides from all owner's channels
				await coordinator
					.getBlockEnforcementService()
					.removeBlockPermissions(
						interaction.user.id,
						targetUser.id,
						interaction.guild.id,
					);

				await interaction.editReply({
					content: `🔹 **${targetUser.displayName}** is now unblocked.`,
				});
			} else {
				// Add to block list (de-duped using Set)
				const updatedBlockedUsers = Array.from(
					new Set([...blockedUsers, targetUser.id]),
				);
				const updatedPreferences = {
					...preferences,
					blocked_users: updatedBlockedUsers,
				};

				await coordinator.getSpawnChannelService().updatePreferences(
					interaction.user.id,
					interaction.guild.id,
					updatedPreferences,
				);

				// Apply Discord permission overrides to all owner's channels
				await coordinator
					.getBlockEnforcementService()
					.applyBlockPermissions(
						interaction.user.id,
						targetUser.id,
						interaction.guild.id,
					);

				await interaction.editReply({
					content: `🔹 **${targetUser.displayName}** is now blocked. Neither of you can join voice channels with each other.`,
				});
			}
		} catch (error) {
			console.error("🔸 Error in block command:", error);
			await interaction.reply({
				content: "🔸 An error occurred while trying to block the user.",
				ephemeral: true,
			});
		}
	},
};
