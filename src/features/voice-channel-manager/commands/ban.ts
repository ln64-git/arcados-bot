import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceChannelManager } from "../VoiceChannelManager";

// Extend the Client interface to include voiceChannelManager
interface BotClient {
	voiceChannelManager?: VoiceChannelManager;
}

export const banCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("ban")
		.setDescription("Ban a user from your voice channels")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to ban")
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

			// Load current preferences
			const preferencesResult = await voiceChannelManager.loadUserPreferences(
				member.id,
				interaction.guild.id,
			);
			if (!preferencesResult.success) {
				await interaction.reply({
					content: `🔸 Failed to load preferences: ${preferencesResult.error}`,
					ephemeral: true,
				});
				return;
			}

			const preferences = preferencesResult.data || {};
			const bannedUsers = preferences.banned_users || [];

			// Check if already banned
			if (bannedUsers.includes(targetUser.id)) {
				await interaction.reply({
					content: `🔸 **${targetUser.displayName}** is already banned from your channels.`,
					ephemeral: true,
				});
				return;
			}

			// Add to ban list
			bannedUsers.push(targetUser.id);
			const updatedPreferences = { ...preferences, banned_users: bannedUsers };

			const updateResult = await voiceChannelManager.updateUserPreferences(
				member.id,
				interaction.guild.id,
				updatedPreferences,
			);

			if (!updateResult.success) {
				await interaction.reply({
					content: `🔸 Failed to update ban list: ${updateResult.error}`,
					ephemeral: true,
				});
				return;
			}

			// Kick user if currently in channel
			const targetMember = voiceChannel.members.get(targetUser.id);
			if (targetMember) {
				await targetMember.voice.disconnect(
					"You have been banned from this channel",
				);
			}

			await interaction.reply({
				content: `🔹 Banned **${targetUser.displayName}** from your voice channels.`,
				ephemeral: false,
			});
		} catch (error) {
			console.error("🔸 Error in ban command:", error);
			await interaction.reply({
				content: "🔸 An error occurred while trying to ban the user.",
				ephemeral: true,
			});
		}
	},
};
