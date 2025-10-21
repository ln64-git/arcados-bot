import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceChannelManager } from "../VoiceChannelManager";

// Extend the Client interface to include voiceChannelManager
interface BotClient {
	voiceChannelManager?: VoiceChannelManager;
}

export const unbanCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("unban")
		.setDescription("Remove a user from your voice channel ban list")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to unban")
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

			// Check if user is banned
			if (!bannedUsers.includes(targetUser.id)) {
				await interaction.reply({
					content: `🔸 **${targetUser.displayName}** is not banned from your channels.`,
					ephemeral: true,
				});
				return;
			}

			// Remove from ban list
			const updatedBannedUsers = bannedUsers.filter(
				(id) => id !== targetUser.id,
			);
			const updatedPreferences = {
				...preferences,
				banned_users: updatedBannedUsers,
			};

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

			await interaction.reply({
				content: `🔹 Unbanned **${targetUser.displayName}** from your voice channels.`,
				ephemeral: false,
			});
		} catch (error) {
			console.error("🔸 Error in unban command:", error);
			await interaction.reply({
				content: "🔸 An error occurred while trying to unban the user.",
				ephemeral: true,
			});
		}
	},
};
