import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
	voiceStateCoordinator?: VoiceStateCoordinator;
}

export const whitelistCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("whitelist")
		.setDescription("Whitelist a user to allow them in your voice channels")
		.addUserOption((option) =>
			option.setName("user").setDescription("The user to whitelist").setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("action")
				.setDescription("Add or remove from whitelist")
				.setRequired(false)
				.addChoices(
					{ name: "Add", value: "add" },
					{ name: "Remove", value: "remove" },
				),
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
			// Check if this is a user channel and user is the owner
			const currentOwner = await coordinator.getOwnershipService().getOwner(
				voiceChannel.id,
			);

			if (!currentOwner) {
				await interaction.reply({
					content: "🔸 This is not a user-owned voice channel.",
					ephemeral: true,
				});
				return;
			}

			if (currentOwner !== member.user.id) {
				await interaction.reply({
					content: "🔸 You are not the owner of this channel.",
					ephemeral: true,
				});
				return;
			}

			// Get action option (default to "add" if not specified)
			const action = interaction.options.getString("action") || "add";
			const shouldRemove = action === "remove";

			// Load current preferences
			const preferences = await coordinator.getSpawnChannelService().getPreferences(
				member.user.id,
				interaction.guild.id,
			);

			const whitelistedUsers = (preferences.whitelist as string[]) || [];

			// Defer reply since permission updates can take time
			await interaction.deferReply({ ephemeral: false });

			if (shouldRemove) {
				// Remove from whitelist
				const updatedWhitelist = whitelistedUsers.filter(
					(id) => id !== targetUser.id,
				);
				const updatedPreferences = {
					...preferences,
					whitelist: updatedWhitelist,
				};

				await coordinator.getSpawnChannelService().updatePreferences(
					member.user.id,
					interaction.guild.id,
					updatedPreferences,
				);

				// Remove Discord permission overrides from all owner's channels
				await coordinator.getModerationService().removeWhitelistPermissions(
					targetUser.id,
					member.user.id,
					interaction.guild.id,
				);

				await interaction.editReply({
					content: `**${targetUser.displayName}** has been removed from your whitelist.`,
				});
			} else {
				// Add to whitelist (de-duped using Set)
				const updatedWhitelist = Array.from(new Set([...whitelistedUsers, targetUser.id]));
				const updatedPreferences = { ...preferences, whitelist: updatedWhitelist };

				await coordinator.getSpawnChannelService().updatePreferences(
					member.user.id,
					interaction.guild.id,
					updatedPreferences,
				);

				// Apply Discord permission overrides to all owner's channels
				await coordinator.getModerationService().applyWhitelistPermissions(
					targetUser.id,
					member.user.id,
					interaction.guild.id,
				);

				await interaction.editReply({
					content: `**${targetUser.displayName}** has been added to your whitelist.`,
				});
			}
		} catch (error) {
			console.error("🔸 Error in whitelist command:", error);

			// Try to respond with error
			try {
				if (interaction.deferred) {
					await interaction.editReply({
						content: "🔸 An error occurred while trying to whitelist the user.",
					});
				} else {
					await interaction.reply({
						content: "🔸 An error occurred while trying to whitelist the user.",
						ephemeral: true,
					});
				}
			} catch {
				// Ignore if we can't send error message
			}
		}
	},
};
