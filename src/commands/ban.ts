import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const banCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("ban")
		.setDescription("Ban or unban a user from your voice channel")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to ban/unban")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("action")
				.setDescription("Ban or unban the user")
				.setRequired(true)
				.addChoices(
					{ name: "Ban", value: "ban" },
					{ name: "Unban", value: "unban" },
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
			await interaction.reply({
				content: ownershipValidation.error || "Unknown error",
				ephemeral: true,
			});
			return;
		}

		// Validate rate limit
		const rateLimitValidation = await voiceManager.validateRateLimit(
			interaction.user.id,
			"ban",
			3,
			60000,
		);
		if (!rateLimitValidation.isValid) {
			await interaction.reply({
				content: rateLimitValidation.error || "Rate limit exceeded",
				ephemeral: true,
			});
			return;
		}

		// For ban action, validate user is in channel
		if (action === "ban") {
			const userValidation = await voiceManager.validateUserInChannel(
				channel.id,
				user.id,
			);
			if (!userValidation.isValid) {
				await interaction.reply({
					content: userValidation.error || "User validation failed",
					ephemeral: true,
				});
				return;
			}
		}

		// Perform ban action using centralized method
		const result = await voiceManager.performBanAction(
			channel.id,
			user.id,
			interaction.user.id,
			interaction.guild?.id || "",
			action as "ban" | "unban",
			reason,
		);

		if (!result.success) {
			await interaction.reply({
				content: `🔸 ${result.error}`,
				ephemeral: true,
			});
			return;
		}

		// Create success embed
		const embed = new EmbedBuilder()
			.setTitle(`🔹 User ${action === "ban" ? "Banned" : "Unbanned"}`)
			.setDescription(`${user.tag} has been ${action}ned from ${channel.name}`)
			.addFields(
				{ name: "Reason", value: reason, inline: true },
				{ name: "Moderator", value: interaction.user.tag, inline: true },
			)
			.setColor(action === "ban" ? 0xff0000 : 0x00ff00)
			.setTimestamp();

		await interaction.reply({ embeds: [embed] });
	},
};
