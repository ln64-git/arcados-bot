import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const hideCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("hide")
		.setDescription("Show or hide your voice channel")
		.addStringOption((option) =>
			option
				.setName("state")
				.setDescription("Set channel visibility state")
				.setRequired(true)
				.addChoices(
					{ name: "Hide channel", value: "hide" },
					{ name: "Show channel", value: "show" },
				),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const state = interaction.options.getString("state", true);

		const member = interaction.member;
		if (!isGuildMember(member)) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server!",
				ephemeral: true,
			});
			return;
		}
		const channel = member.voice?.channel;

		if (!channel) {
			await interaction.reply({
				content: "🔸 You must be in a voice channel!",
				ephemeral: true,
			});
			return;
		}

		const voiceManager = (interaction.client as ClientWithVoiceManager)
			.voiceManager;
		if (!voiceManager) {
			await interaction.reply({
				content: "🔸 Voice manager not available!",
				ephemeral: true,
			});
			return;
		}

		// Validate ownership
		const ownershipValidation = await voiceManager.validateChannelOwnership(
			channel.id,
			interaction.user.id,
		);
		if (!ownershipValidation.isValid) {
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: ownershipValidation.error || "Unknown error",
					ephemeral: true,
				});
			}
			return;
		}

		// Validate rate limit
		const rateLimitValidation = await voiceManager.validateRateLimit(
			interaction.user.id,
			"hide",
			5,
			60000,
		);
		if (!rateLimitValidation.isValid) {
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: rateLimitValidation.error || "Rate limit exceeded",
					ephemeral: true,
				});
			}
			return;
		}

		try {
			if (state === "hide") {
				// Hide channel - prevent everyone except owner from viewing
				if (interaction.guild?.roles.everyone) {
					await channel.permissionOverwrites.edit(
						interaction.guild.roles.everyone,
						{
							ViewChannel: false,
						},
					);
				}
			} else {
				// Show channel - allow everyone to view
				if (interaction.guild?.roles.everyone) {
					await channel.permissionOverwrites.edit(
						interaction.guild.roles.everyone,
						{
							ViewChannel: true,
						},
					);
				}
			}

			// Update user preferences to remember this visibility setting using the new database system
			const { DatabaseCore } = await import(
				"../features/database-manager/DatabaseCore"
			);
			const dbCore = new DatabaseCore();
			await dbCore.initialize();

			await dbCore.updateModPreferences(interaction.user.id, {
				preferredHidden: state === "hide",
			});

			await voiceManager.logModerationAction({
				action: "lock", // Use "lock" as the closest existing action type
				channelId: channel.id,
				guildId: interaction.guild?.id || "",
				performerId: interaction.user.id,
				targetId: interaction.user.id,
				reason: `Channel ${state === "hide" ? "hidden" : "shown"}`,
			});

			const embed = new EmbedBuilder()
				.setTitle("🔹 Channel Visibility Changed")
				.setDescription(
					`Voice channel is now **${state === "hide" ? "hidden" : "visible"}**`,
				)
				.setColor(state === "hide" ? 0xff6b6b : 0x00ff00)
				.setTimestamp();

			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({ embeds: [embed] });
			}
		} catch (_error) {
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content:
						"🔸 Failed to change channel visibility. Make sure I have the necessary permissions.",
					ephemeral: true,
				});
			}
		}
	},
};
