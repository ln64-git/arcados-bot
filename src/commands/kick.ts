import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const kickCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("kick")
		.setDescription("Kick a user from your voice channel")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to kick")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("reason")
				.setDescription("Reason for kicking")
				.setRequired(false),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const user = interaction.options.getUser("user", true);
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

		const isOwner = await voiceManager.isChannelOwner(
			channel.id,
			interaction.user.id,
		);
		if (!isOwner) {
			await interaction.reply({
				content: "🔸 You must be the owner of this voice channel!",
				ephemeral: true,
			});
			return;
		}

		const canProceed = await voiceManager.checkRateLimit(
			interaction.user.id,
			"kick",
			5,
			60000,
		);

		if (!canProceed) {
			await interaction.reply({
				content: "🔸 You're kicking users too quickly! Please wait a moment.",
				ephemeral: true,
			});
			return;
		}

		const targetMember = channel.members.get(user.id);
		if (!targetMember) {
			await interaction.reply({
				content: "🔸 The user is not in this voice channel!",
				ephemeral: true,
			});
			return;
		}

		try {
			await targetMember.voice.disconnect(reason);

			// Update user preferences to remember this kick
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

			if (!preferences.kickedUsers.includes(user.id)) {
				preferences.kickedUsers.push(user.id);
				preferences.lastUpdated = new Date();
				await voiceManager.updateUserPreferences(preferences);
			}

			await voiceManager.logModerationAction({
				action: "kick",
				channelId: channel.id,
				guildId: interaction.guild?.id || "",
				performerId: interaction.user.id,
				targetId: user.id,
				reason,
			});

			const embed = new EmbedBuilder()
				.setTitle("🔹 User Kicked")
				.setDescription(`${user.tag} has been kicked from ${channel.name}`)
				.addFields(
					{ name: "Reason", value: reason, inline: true },
					{ name: "Moderator", value: interaction.user.tag, inline: true },
				)
				.setColor(0xff6b6b)
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });
		} catch (_error) {
			await interaction.reply({
				content:
					"🔸 Failed to kick the user. Make sure I have the necessary permissions.",
				ephemeral: true,
			});
		}
	},
};
