import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const deafenCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("deafen")
		.setDescription("Deafen or undeafen a user in your voice channel")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to deafen/undeafen")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("action")
				.setDescription("Deafen or undeafen the user")
				.setRequired(true)
				.addChoices(
					{ name: "Deafen", value: "deafen" },
					{ name: "Undeafen", value: "undeafen" },
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
			"deafen",
			10,
			60000,
		);

		if (!canProceed) {
			await interaction.reply({
				content: "🔸 You're deafening users too quickly! Please wait a moment.",
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
			if (action === "deafen") {
				// Check if user is already deafened
				if (targetMember.voice.deaf) {
					await interaction.reply({
						content: `🔸 ${user.tag} is already deafened.`,
						ephemeral: true,
					});
					return;
				}

				await targetMember.voice.setDeaf(true, reason);

				// Update user preferences to remember this deafen
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

				if (!preferences.deafenedUsers.includes(user.id)) {
					preferences.deafenedUsers.push(user.id);
					preferences.lastUpdated = new Date();
					await voiceManager.updateUserPreferences(preferences);
				}

				// Update call state
				const callState = await voiceManager.getCallState(channel.id);
				if (callState) {
					if (!callState.deafenedUsers.includes(user.id)) {
						callState.deafenedUsers.push(user.id);
						callState.lastUpdated = new Date();
						await voiceManager.updateCallState(callState);
					}
				}

				await voiceManager.logModerationAction({
					action: "deafen",
					channelId: channel.id,
					guildId: interaction.guild?.id || "",
					performerId: interaction.user.id,
					targetId: user.id,
					reason,
				});

				const embed = new EmbedBuilder()
					.setTitle("🔹 User Deafened")
					.setDescription(`${user.tag} has been deafened in ${channel.name}`)
					.addFields(
						{ name: "Reason", value: reason, inline: true },
						{ name: "Moderator", value: interaction.user.tag, inline: true },
					)
					.setColor(0xff6b6b)
					.setTimestamp();

				await interaction.reply({ embeds: [embed] });
			} else if (action === "undeafen") {
				// Check if user is already undeafened
				if (!targetMember.voice.deaf) {
					await interaction.reply({
						content: `🔸 ${user.tag} is not deafened.`,
						ephemeral: true,
					});
					return;
				}

				await targetMember.voice.setDeaf(false, reason);

				// Update user preferences to remove from deafen list
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

				// Remove user from deafen list
				const deafenIndex = preferences.deafenedUsers.indexOf(user.id);
				if (deafenIndex > -1) {
					preferences.deafenedUsers.splice(deafenIndex, 1);
					preferences.lastUpdated = new Date();
					await voiceManager.updateUserPreferences(preferences);
				}

				// Update call state
				const callState = await voiceManager.getCallState(channel.id);
				if (callState) {
					const deafenIndex = callState.deafenedUsers.indexOf(user.id);
					if (deafenIndex > -1) {
						callState.deafenedUsers.splice(deafenIndex, 1);
						callState.lastUpdated = new Date();
						await voiceManager.updateCallState(callState);
					}
				}

				await voiceManager.logModerationAction({
					action: "undeafen",
					channelId: channel.id,
					guildId: interaction.guild?.id || "",
					performerId: interaction.user.id,
					targetId: user.id,
					reason,
				});

				const embed = new EmbedBuilder()
					.setTitle("🔹 User Undeafened")
					.setDescription(`${user.tag} has been undeafened in ${channel.name}`)
					.addFields(
						{ name: "Reason", value: reason, inline: true },
						{ name: "Moderator", value: interaction.user.tag, inline: true },
					)
					.setColor(0x00ff00)
					.setTimestamp();

				await interaction.reply({ embeds: [embed] });
			}
		} catch (error) {
			// Check if interaction was already replied to
			if (!interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content:
						"🔸 Failed to deafen the user. Make sure I have the necessary permissions.",
					ephemeral: true,
				});
			}
		}
	},
};
