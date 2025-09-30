import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const claimCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("claim")
		.setDescription(
			"Claim ownership of the current voice channel or reclaim from previous owner",
		)
		.addStringOption((option) =>
			option
				.setName("reason")
				.setDescription("Reason for claiming ownership")
				.setRequired(false),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const reason =
			interaction.options.getString("reason") || "User claimed ownership";

		const member = interaction.member;
		if (!isGuildMember(member)) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server!",
				ephemeral: true,
			});
			return;
		}

		const voiceChannel = member.voice.channel;
		if (!voiceChannel) {
			await interaction.reply({
				content: "🔸 You must be in a voice channel to claim it!",
				ephemeral: true,
			});
			return;
		}

		const client = interaction.client as ClientWithVoiceManager;
		const voiceManager = client.voiceManager;

		if (!voiceManager) {
			await interaction.reply({
				content: "🔸 Voice manager not available!",
				ephemeral: true,
			});
			return;
		}

		try {
			// Check if channel already has an owner
			const currentOwner = await voiceManager.getChannelOwner(voiceChannel.id);
			if (currentOwner) {
				// Check if the user is the previous owner (can reclaim)
				const isPreviousOwner = await voiceManager.isPreviousChannelOwner(
					voiceChannel.id,
					member.id,
				);

				if (!isPreviousOwner) {
					const embed = new EmbedBuilder()
						.setColor(0xff6b6b)
						.setTitle("🔸 Channel Already Owned")
						.setDescription(
							`This channel is already owned by <@${currentOwner.userId}>. Only the previous owner can reclaim it.`,
						)
						.addFields({
							name: "Current Owner",
							value: `<@${currentOwner.userId}>`,
							inline: true,
						})
						.setTimestamp();

					await interaction.reply({ embeds: [embed], ephemeral: true });
					return;
				}

				// Previous owner is reclaiming - transfer ownership back
				await voiceManager.setChannelOwner(
					voiceChannel.id,
					member.id,
					voiceChannel.guild.id,
				);

				// Apply the new owner's preferences to the channel
				await voiceManager.applyUserPreferencesToChannel(
					voiceChannel.id,
					member.id,
				);

				const reclaimReason =
					reason === "User claimed ownership"
						? "Previous owner reclaimed channel"
						: reason;

				const embed = new EmbedBuilder()
					.setColor(0x51cf66)
					.setTitle("🔹 Channel Reclaimed Successfully")
					.setDescription(
						`You have successfully reclaimed ownership of <#${voiceChannel.id}> from <@${currentOwner.userId}>!`,
					)
					.addFields(
						{
							name: "Channel",
							value: `<#${voiceChannel.id}>`,
							inline: true,
						},
						{
							name: "New Owner",
							value: `<@${member.id}>`,
							inline: true,
						},
						{
							name: "Previous Owner",
							value: `<@${currentOwner.userId}>`,
							inline: true,
						},
						{
							name: "Reason",
							value: reclaimReason,
							inline: false,
						},
					)
					.setTimestamp();

				await interaction.reply({ embeds: [embed] });
				return;
			}

			// Claim the channel
			await voiceManager.setChannelOwner(
				voiceChannel.id,
				member.id,
				voiceChannel.guild.id,
			);

			// Apply the new owner's preferences to the channel
			await voiceManager.applyUserPreferencesToChannel(
				voiceChannel.id,
				member.id,
			);

			const embed = new EmbedBuilder()
				.setColor(0x51cf66)
				.setTitle("🔹 Channel Claimed Successfully")
				.setDescription(
					`You have successfully claimed ownership of <#${voiceChannel.id}>!`,
				)
				.addFields(
					{
						name: "Channel",
						value: `<#${voiceChannel.id}>`,
						inline: true,
					},
					{
						name: "New Owner",
						value: `<@${member.id}>`,
						inline: true,
					},
					{
						name: "Reason",
						value: reason,
						inline: false,
					},
				)
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });
		} catch (error) {
			console.error("Error claiming channel:", error);
			await interaction.reply({
				content:
					"🔸 An error occurred while claiming the channel. Please try again later.",
				ephemeral: true,
			});
		}
	},
};
