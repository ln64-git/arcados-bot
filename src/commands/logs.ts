import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const logsCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("logs")
		.setDescription("View moderation logs for the current voice channel")
		.addIntegerOption((option) =>
			option
				.setName("limit")
				.setDescription("Number of logs to show (max 50)")
				.setRequired(false)
				.setMinValue(1)
				.setMaxValue(50),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

	async execute(interaction: ChatInputCommandInteraction) {
		const limit = interaction.options.getInteger("limit") || 10;

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

		try {
			const logs = await voiceManager.getModerationLogs(channel.id, limit);

			if (logs.length === 0) {
				await interaction.reply({
					content: "🔹 No moderation logs found for this voice channel.",
					ephemeral: true,
				});
				return;
			}

			const embed = new EmbedBuilder()
				.setTitle(`🔹 Moderation Logs - ${channel.name}`)
				.setDescription(`Showing ${logs.length} most recent actions`)
				.setColor(0x0099ff)
				.setTimestamp();

			const logFields = logs.slice(0, 25).map((log, index) => {
				const timestamp = `<t:${Math.floor(log.timestamp.getTime() / 1000)}:R>`;
				const target = log.targetId ? `<@${log.targetId}>` : "N/A";
				const performer = `<@${log.performerId}>`;

				return {
					name: `${index + 1}. ${log.action.toUpperCase()}`,
					value: `**Performer:** ${performer}\n**Target:** ${target}\n**Time:** ${timestamp}\n**Reason:** ${log.reason || "No reason provided"}`,
					inline: false,
				};
			});

			embed.addFields(logFields);

			await interaction.reply({ embeds: [embed], ephemeral: true });
		} catch (error) {
			await interaction.reply({
				content: "🔸 Failed to fetch moderation logs. Please try again.",
				ephemeral: true,
			});
		}
	},
};
