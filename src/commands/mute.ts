import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const muteCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("mute")
		.setDescription("Mute or unmute a user in your voice channel")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to mute/unmute")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("action")
				.setDescription("Mute or unmute the user")
				.setRequired(true)
				.addChoices(
					{ name: "Mute", value: "mute" },
					{ name: "Unmute", value: "unmute" },
				),
		)
		.addStringOption((option) =>
			option
				.setName("reason")
				.setDescription("Reason for the action")
				.setRequired(false),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const user = interaction.options.getUser("user", true);
		const action = interaction.options.getString("action", true);
		const reason =
			interaction.options.getString("reason") || "No reason provided";

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
			"mute",
			10,
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

		// Validate user in channel
		const userValidation = await voiceManager.validateUserInChannel(
			channel.id,
			user.id,
		);
		if (!userValidation.isValid) {
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: userValidation.error || "User validation failed",
					ephemeral: true,
				});
			}
			return;
		}

		// Perform mute action using centralized method
		const result = await voiceManager.performMuteAction(
			channel.id,
			user.id,
			interaction.user.id,
			interaction.guild?.id || "",
			action as "mute" | "unmute",
			reason,
		);

		if (!result.success) {
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: `🔸 ${result.error}`,
					ephemeral: true,
				});
			}
			return;
		}

		// Create success embed
		const embed = new EmbedBuilder()
			.setTitle(`🔹 User ${action === "mute" ? "Muted" : "Unmuted"}`)
			.setDescription(`${user.tag} has been ${action}d in ${channel.name}`)
			.addFields(
				{ name: "Reason", value: reason, inline: true },
				{ name: "Moderator", value: interaction.user.tag, inline: true },
			)
			.setColor(action === "mute" ? 0xff6b6b : 0x00ff00)
			.setTimestamp();

		if (!interaction.replied && !interaction.deferred) {
			await interaction.reply({ embeds: [embed] });
		}
	},
};
