import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const renameCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("rename")
		.setDescription("Change the name of your voice channel")
		.addStringOption((option) =>
			option
				.setName("name")
				.setDescription("New name for the voice channel")
				.setRequired(true)
				.setMaxLength(100),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const newName = interaction.options.getString("name", true);

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
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content:
						"🔸 You must be the owner of this voice channel to use this command!",
					ephemeral: true,
				});
			}
			return;
		}

		const canProceed = await voiceManager.checkRateLimit(
			interaction.user.id,
			"rename",
			5,
			60000,
		);

		if (!canProceed) {
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content:
						"🔸 You're changing the name too quickly! Please wait a moment.",
					ephemeral: true,
				});
			}
			return;
		}

		try {
			await channel.setName(newName);

			// Update user preferences to remember this channel name
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

			preferences.preferredChannelName = newName;
			preferences.lastUpdated = new Date();
			await voiceManager.updateUserPreferences(preferences);

			await voiceManager.logModerationAction({
				action: "rename",
				channelId: channel.id,
				guildId: interaction.guild?.id || "",
				performerId: interaction.user.id,
				targetId: interaction.user.id, // Rename affects the channel owner
				reason: `Changed name to: ${newName}`,
			});

			const embed = new EmbedBuilder()
				.setTitle("🔹 Channel Name Changed")
				.setDescription(`Voice channel name changed to: **${newName}**`)
				.setColor(0x00ff00)
				.setTimestamp();

			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({ embeds: [embed] });
			}
		} catch (_error) {
			// Check if interaction was already replied to
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content:
						"🔸 Failed to change the channel name. Make sure the name is valid and I have the necessary permissions.",
					ephemeral: true,
				});
			}
		}
	},
};
