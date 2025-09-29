import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type {
	ClientWithVoiceManager,
	Command,
	VoiceManager as IVoiceManager,
} from "../types";

export const disconnectCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("disconnect")
		.setDescription("Disconnect a user from your voice channel")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to disconnect")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("reason")
				.setDescription("Reason for disconnecting")
				.setRequired(false),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const voiceManager = (interaction.client as ClientWithVoiceManager)
			.voiceManager as IVoiceManager;

		if (!voiceManager) {
			await interaction.reply({
				content: "🔸 Voice manager not available!",
				ephemeral: true,
			});
			return;
		}

		const user = interaction.options.getUser("user", true);
		const reason =
			interaction.options.getString("reason") || "No reason provided";

		// Check if user is in a voice channel
		const member = interaction.guild?.members.cache.get(user.id);
		if (!member) {
			await interaction.reply({
				content: "🔸 User not found in this server.",
				ephemeral: true,
			});
			return;
		}

		if (!member.voice.channel) {
			await interaction.reply({
				content: "🔸 User is not in a voice channel.",
				ephemeral: true,
			});
			return;
		}

		const channel = member.voice.channel;

		// Check if the interaction user is the channel owner
		const isOwner = await voiceManager.isChannelOwner(
			channel.id,
			interaction.user.id,
		);
		if (!isOwner) {
			await interaction.reply({
				content: "🔸 You are not the owner of this voice channel.",
				ephemeral: true,
			});
			return;
		}

		// Check rate limit
		const canProceed = await voiceManager.checkRateLimit(
			interaction.user.id,
			"disconnect",
			5,
			60000,
		);

		if (!canProceed) {
			await interaction.reply({
				content:
					"🔸 You're disconnecting users too quickly! Please wait a moment.",
				ephemeral: true,
			});
			return;
		}

		try {
			await member.voice.disconnect(reason);

			await voiceManager.logModerationAction({
				action: "disconnect",
				channelId: channel.id,
				guildId: interaction.guild?.id || "",
				performerId: interaction.user.id,
				targetId: user.id,
				reason,
			});

			const embed = new EmbedBuilder()
				.setTitle("🔹 User Disconnected")
				.setDescription(
					`${user.tag} has been disconnected from ${channel.name}`,
				)
				.addFields(
					{ name: "Reason", value: reason, inline: true },
					{ name: "Moderator", value: interaction.user.tag, inline: true },
				)
				.setColor(0xff6b6b)
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });
		} catch (_error) {
			// Check if interaction was already replied to
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content:
						"🔸 Failed to disconnect the user. Make sure I have the necessary permissions.",
					ephemeral: true,
				});
			}
		}
	},
};
