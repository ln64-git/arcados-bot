import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const limitCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("limit")
		.setDescription("Set the user limit for your voice channel")
		.addIntegerOption((option) =>
			option
				.setName("limit")
				.setDescription("User limit (0 for no limit, 1-99 for specific limit)")
				.setRequired(true)
				.setMinValue(0)
				.setMaxValue(99),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const userLimit = interaction.options.getInteger("limit", true);

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
				content: "🔸 You must be in a voice channel to use this command!",
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

		const isOwner = await voiceManager.isChannelOwner(
			channel.id,
			interaction.user.id,
		);
		if (!isOwner) {
			await interaction.reply({
				content:
					"🔸 You must be the owner of this voice channel to use this command!",
				ephemeral: true,
			});
			return;
		}

		const canProceed = await voiceManager.checkRateLimit(
			interaction.user.id,
			"limit",
			10,
			60000,
		);

		if (!canProceed) {
			await interaction.reply({
				content:
					"🔸 You're changing the limit too quickly! Please wait a moment.",
				ephemeral: true,
			});
			return;
		}

		try {
			await channel.setUserLimit(userLimit);

			// Update user preferences to remember this user limit
			const preferences = (await voiceManager.getUserPreferences(
				interaction.user.id,
				interaction.guild?.id || "",
			)) || {
				userId: interaction.user.id,
				guildId: interaction.guild?.id || "",
				bannedUsers: [],
				mutedUsers: [],
				kickedUsers: [],
				deafenedUsers: [],
				lastUpdated: new Date(),
			};

			preferences.preferredUserLimit = userLimit;
			preferences.lastUpdated = new Date();
			await voiceManager.updateUserPreferences(preferences);

			await voiceManager.logModerationAction({
				action: "limit",
				channelId: channel.id,
				guildId: interaction.guild?.id || "",
				performerId: interaction.user.id,
				reason: `Set user limit to: ${userLimit === 0 ? "No limit" : userLimit}`,
			});

			const embed = new EmbedBuilder()
				.setTitle("🔹 User Limit Changed")
				.setDescription(
					`Voice channel user limit set to: **${userLimit === 0 ? "No limit" : userLimit}**`,
				)
				.setColor(0x00ff00)
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });
		} catch (_error) {
			await interaction.reply({
				content:
					"🔸 Failed to change the user limit. Make sure I have the necessary permissions.",
				ephemeral: true,
			});
		}
	},
};
