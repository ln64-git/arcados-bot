import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	type GuildMember,
	SlashCommandBuilder,
	type VoiceBasedChannel,
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
			// Get channel owner
			const owner = await voiceManager.getChannelOwner(voiceChannel.id);

			// Get owner preferences for banned/muted/deafened users
			let bannedUsers: string[] = [];
			let mutedUsers: string[] = [];
			let deafenedUsers: string[] = [];

			if (owner) {
				const preferences = await voiceManager.getUserPreferences(
					owner.userId,
					voiceChannel.guild.id,
				);
				if (preferences) {
					bannedUsers = preferences.bannedUsers;
					mutedUsers = preferences.mutedUsers;
					deafenedUsers = preferences.deafenedUsers;
				}
			}

			// Get call order (longest to shortest standing)
			const callOrder = await getCallOrder(voiceChannel);

			// Create embed
			const embed = new EmbedBuilder()
				.setTitle(`Channel Information`)
				.setDescription(`**${voiceChannel.name}**`)
				.setColor(0x5865f2)
				.setThumbnail(voiceChannel.guild.iconURL() || null)
				.addFields(
					{
						name: "Owner",
						value: owner ? `<@${owner.userId}>` : "No owner",
						inline: true,
					},
					{
						name: "Members",
						value: `${voiceChannel.members.size} users`,
						inline: true,
					},
					{
						name: "Created",
						value: `<t:${Math.floor(voiceChannel.createdTimestamp / 1000)}:R>`,
						inline: true,
					},
				)
				.setTimestamp();

			// Add moderation info if any
			const moderationInfo: string[] = [];
			if (bannedUsers.length > 0) {
				moderationInfo.push(`**Banned:** ${bannedUsers.length} users`);
			}
			if (mutedUsers.length > 0) {
				moderationInfo.push(`**Muted:** ${mutedUsers.length} users`);
			}
			if (deafenedUsers.length > 0) {
				moderationInfo.push(`**Deafened:** ${deafenedUsers.length} users`);
			}

			if (moderationInfo.length > 0) {
				embed.addFields({
					name: "Moderation",
					value: moderationInfo.join(" • "),
					inline: false,
				});
			}

			// Add call order (inheritance order)
			if (callOrder.length > 0) {
				const callOrderText = callOrder
					.slice(0, 5) // Show top 5
					.map((member) => {
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

async function getCallOrder(
	channel: VoiceBasedChannel,
): Promise<Array<{ userId: string; duration: number; member: GuildMember }>> {
	try {
		// Use join time as a proxy for call duration
		// Members who joined earlier are likely to have been in the call longer
		const members = Array.from(channel.members.values())
			.filter((member) => !member.user.bot)
			.map((member) => {
				// Use joinedTimestamp if available, otherwise use current time
				const joinTime = member.joinedTimestamp || Date.now();
				const duration = Date.now() - joinTime;
				return {
					userId: member.id,
					duration,
					member,
				};
			});

		// Sort by duration (longest first)
		return members.sort((a, b) => b.duration - a.duration);
	} catch {
		console.error("🔸 Error getting call order");
		return [];
	}
}

function isChannelLocked(channel: VoiceBasedChannel): boolean {
	try {
		const everyoneOverwrite = channel.permissionOverwrites.cache.get(
			channel.guild.roles.everyone.id,
		);
		if (!everyoneOverwrite) return false;

		// A channel is considered "locked" only if:
		// 1. Connect permission is denied for @everyone
		// 2. AND there are no other role/member overwrites that allow Connect
		const isConnectDenied = everyoneOverwrite.deny.has("Connect");
		if (!isConnectDenied) return false;

		// Check if any other role or member has Connect permission allowed
		for (const [id, overwrite] of channel.permissionOverwrites.cache) {
			if (id === channel.guild.roles.everyone.id) continue; // Skip @everyone, already checked

			// If any role/member has Connect allowed OR no explicit Connect permission (inherits access),
			// the channel is not fully locked
			if (overwrite.allow.has("Connect") || !overwrite.deny.has("Connect")) {
				return false;
			}
		}

		// If Connect is denied for @everyone and no other permissions allow it, channel is locked
		return true;
	} catch {
		return false;
	}
}

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
