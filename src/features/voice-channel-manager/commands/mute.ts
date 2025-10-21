import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceChannelManager } from "../VoiceChannelManager";

// Extend the Client interface to include voiceChannelManager
interface BotClient {
	voiceChannelManager?: VoiceChannelManager;
}

export const muteCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("mute")
		.setDescription("Mute a user in your voice channel")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to mute")
				.setRequired(true),
		),

	async execute(interaction) {
		if (!interaction.guild || !interaction.member) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server.",
				ephemeral: true,
			});
			return;
		}

		const member = interaction.member;
		const targetUser = interaction.options.getUser("user", true);
		const voiceChannel = member.voice.channel;

		if (!voiceChannel) {
			await interaction.reply({
				content: "🔸 You must be in a voice channel to use this command.",
				ephemeral: true,
			});
			return;
		}

		// Get the voice channel manager from the bot
		const bot = interaction.client as BotClient;
		const voiceChannelManager = bot.voiceChannelManager;

		if (!voiceChannelManager) {
			await interaction.reply({
				content: "🔸 Voice channel manager is not available.",
				ephemeral: true,
			});
			return;
		}

		try {
			// Check if this is a user channel and user is the owner
			const channelResult = await voiceChannelManager.db.query(
				"SELECT current_owner_id FROM channels WHERE id = $channel_id AND is_user_channel = true",
				{ channel_id: voiceChannel.id },
			);

			const channel =
				((channelResult[0] as Record<string, unknown>)?.[0] as Record<
					string,
					unknown
				>) || {};
			const currentOwnerId = channel.current_owner_id as string;

			if (!currentOwnerId) {
				await interaction.reply({
					content: "🔸 This is not a user-owned voice channel.",
					ephemeral: true,
				});
				return;
			}

			if (currentOwnerId !== member.id) {
				await interaction.reply({
					content: "🔸 You are not the owner of this channel.",
					ephemeral: true,
				});
				return;
			}

			// Check if target is in the channel
			const targetMember = voiceChannel.members.get(targetUser.id);
			if (!targetMember) {
				await interaction.reply({
					content: "🔸 The target user is not in this voice channel.",
					ephemeral: true,
				});
				return;
			}

			// Apply mute
			const muteResult = await voiceChannelManager.applyMute(
				voiceChannel.id,
				targetUser.id,
				member.id,
			);
			if (!muteResult.success) {
				await interaction.reply({
					content: `🔸 Failed to mute user: ${muteResult.error}`,
					ephemeral: true,
				});
				return;
			}

			await interaction.reply({
				content: `🔹 Muted **${targetUser.displayName}** in this channel.`,
				ephemeral: false,
			});
		} catch (error) {
			console.error("🔸 Error in mute command:", error);
			await interaction.reply({
				content: "🔸 An error occurred while trying to mute the user.",
				ephemeral: true,
			});
		}
	},
};
