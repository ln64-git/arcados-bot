import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const lockCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("lock")
		.setDescription("Lock or unlock your voice channel")
		.addStringOption((option) =>
			option
				.setName("state")
				.setDescription("Set channel lock state")
				.setRequired(true)
				.addChoices(
					{ name: "Lock channel", value: "lock" },
					{ name: "Unlock channel", value: "unlock" },
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
			"lock",
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
			if (state === "lock") {
				// Lock channel - prevent everyone except owner from connecting
				if (interaction.guild?.roles.everyone) {
					await channel.permissionOverwrites.edit(
						interaction.guild.roles.everyone,
						{
							Connect: false,
						},
					);
				}
			} else {
				// Unlock channel - allow everyone to connect
				if (interaction.guild?.roles.everyone) {
					await channel.permissionOverwrites.edit(
						interaction.guild.roles.everyone,
						{
							Connect: true,
						},
					);
				}
			}

			// Update user preferences to remember this lock setting
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

			preferences.preferredLocked = state === "lock";
			preferences.lastUpdated = new Date();
			await voiceManager.updateUserPreferences(preferences);

			await voiceManager.logModerationAction({
				action: "lock",
				channelId: channel.id,
				guildId: interaction.guild?.id || "",
				performerId: interaction.user.id,
				targetId: interaction.user.id,
				reason: `Channel ${state}ed`,
			});

			const embed = new EmbedBuilder()
				.setTitle("🔹 Channel Lock State Changed")
				.setDescription(
					`Voice channel is now **${state === "lock" ? "locked" : "unlocked"}**`,
				)
				.setColor(state === "lock" ? 0xff6b6b : 0x00ff00)
				.setTimestamp();

			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({ embeds: [embed] });
			}
		} catch (_error) {
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content:
						"🔸 Failed to change channel lock state. Make sure I have the necessary permissions.",
					ephemeral: true,
				});
			}
		}
	},
};
