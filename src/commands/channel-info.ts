import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const channelInfoCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("channel-info")
		.setDescription("Get detailed information about the current voice channel"),

	async execute(interaction: ChatInputCommandInteraction) {
		const member = interaction.member;
		if (!isGuildMember(member)) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server!",
				ephemeral: true,
			});
			return;
		}

		const voiceChannel = member.voice.channel;
		if (!voiceChannel || !voiceChannel.isVoiceBased()) {
			await interaction.reply({
				content: "🔸 You must be in a voice channel to get its information!",
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
			// Get comprehensive channel state using centralized method
			const channelState = await voiceManager.getChannelState(voiceChannel.id);

			// Create embed
			const embed = new EmbedBuilder()
				.setTitle(`Channel Information`)
				.setDescription(`**${channelState.channelName}**`)
				.setColor(0x5865f2)
				.setThumbnail(voiceChannel.guild.iconURL() || null)
				.addFields(
					{
						name: "Owner",
						value: channelState.owner
							? `<@${channelState.owner.userId}>`
							: "No owner",
						inline: true,
					},
					{
						name: "Members",
						value: `${channelState.memberIds.length} users`,
						inline: true,
					},
					{
						name: "Created",
						value: `<t:${Math.floor(channelState.createdAt.getTime() / 1000)}:R>`,
						inline: true,
					},
				)
				.setTimestamp();

			// Add moderation info if any
			const moderationInfo: string[] = [];
			if (channelState.moderationInfo.bannedUsers.length > 0) {
				moderationInfo.push(
					`**Banned:** ${channelState.moderationInfo.bannedUsers.length} users`,
				);
			}
			if (channelState.moderationInfo.mutedUsers.length > 0) {
				moderationInfo.push(
					`**Muted:** ${channelState.moderationInfo.mutedUsers.length} users`,
				);
			}
			if (channelState.moderationInfo.deafenedUsers.length > 0) {
				moderationInfo.push(
					`**Deafened:** ${channelState.moderationInfo.deafenedUsers.length} users`,
				);
			}

			if (moderationInfo.length > 0) {
				embed.addFields({
					name: "Moderation",
					value: moderationInfo.join(" • "),
					inline: false,
				});
			}

			// Add call order (inheritance order)
			if (channelState.inheritanceOrder.length > 0) {
				const callOrderText = channelState.inheritanceOrder
					.slice(0, 5) // Show top 5
					.map((member: { userId: string; duration: number }) => {
						const duration = formatDuration(member.duration);
						return `<@${member.userId}> • ${duration}`;
					})
					.join("\n");

				embed.addFields({
					name: "Inheritance Order",
					value: callOrderText,
					inline: false,
				});
			}

			await interaction.reply({ embeds: [embed], ephemeral: true });
		} catch (error) {
			console.error("🔸 Error getting channel info:", error);
			await interaction.reply({
				content:
					"🔸 An error occurred while getting channel information. Please try again later.",
				ephemeral: true,
			});
		}
	},
};

function formatDuration(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		return `${days}d ${hours % 24}h ${minutes % 60}m`;
	} else if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	} else if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	} else {
		return `${seconds}s`;
	}
}
