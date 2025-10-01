import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import { voiceManager } from "../features/voice-manager/VoiceManager";
import type { Command } from "../types";
import { isGuildMember } from "../types";

export const checkChannelOwnerCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("check-channel-owner")
		.setDescription("Check if the current voice channel has an owner")
		.addChannelOption((option) =>
			option
				.setName("channel")
				.setDescription(
					"The voice channel to check (defaults to current channel)",
				)
				.setRequired(false),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const member = interaction.member;
		if (!isGuildMember(member)) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server!",
				ephemeral: true,
			});
			return;
		}

		const channelOption = interaction.options.getChannel("channel");
		const channel = channelOption || member.voice.channel;

		if (!channel) {
			await interaction.reply({
				content: "🔸 You must be in a voice channel or specify a channel!",
				ephemeral: true,
			});
			return;
		}

		if (!channel.isVoiceBased()) {
			await interaction.reply({
				content: "🔸 The specified channel must be a voice channel!",
				ephemeral: true,
			});
			return;
		}

		try {
			const vm = voiceManager(interaction.client);
			const owner = await vm.getChannelOwner(channel.id);

			const embed = new EmbedBuilder()
				.setColor(owner ? 0x51cf66 : 0xf03e3e)
				.setTitle("🔍 Channel Owner Check")
				.addFields({
					name: "Channel",
					value: `${channel}`,
					inline: true,
				});

			if (owner) {
				embed.addFields(
					{
						name: "Owner",
						value: `<@${owner.userId}>`,
						inline: true,
					},
					{
						name: "Owner ID",
						value: owner.userId,
						inline: true,
					},
					{
						name: "Ownership Date",
						value: `<t:${Math.floor(new Date(owner.createdAt).getTime() / 1000)}:R>`,
						inline: false,
					},
				);
				embed.setDescription(
					"✅ This channel has an owner! Manual renames will sync to preferences.",
				);
			} else {
				embed.setDescription(
					"❌ This channel has no owner. Manual renames will not sync to preferences.",
				);
			}

			await interaction.reply({ embeds: [embed] });
		} catch (error) {
			console.error("Error checking channel owner:", error);
			await interaction.reply({
				content:
					"🔸 An error occurred while checking the channel owner. Please try again later.",
				ephemeral: true,
			});
		}
	},
};
