import {
	SlashCommandBuilder,
	ChannelType,
	MessageFlags,
	type ChatInputCommandInteraction,
	type TextChannel,
} from "discord.js";
import type { Command } from "../../../types/index.js";
import { MediaPlayerManager } from "../MediaPlayerManager.js";

/**
 * Play music command
 * Searches YouTube and plays audio in voice channel
 */
const playCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("play")
		.setDescription("Play music from YouTube")
		.addStringOption((option) =>
			option
				.setName("input")
				.setDescription("Song name or YouTube URL")
				.setRequired(true)
		),

	async execute(interaction: ChatInputCommandInteraction) {
		// Defer reply to prevent timeout
		await interaction
			.deferReply({ flags: MessageFlags.Ephemeral })
			.catch((error) => {
				console.error("[PlayCommand] Failed to defer reply:", error);
				return;
			});

		try {
			const query = interaction.options.getString("input", true);
			const mediaPlayer = MediaPlayerManager.getInstance();

			// Check if user is in a voice channel
			const member = interaction.guild?.members.cache.get(interaction.user.id);

			if (!member?.voice.channel) {
				await interaction.editReply({
					content: "You need to be in a voice channel first!",
				});
				return;
			}

			const voiceChannel = member.voice.channel;

			// Check if it's a voice channel (not stage)
			if (voiceChannel.type !== ChannelType.GuildVoice) {
				await interaction.editReply({
					content: "I can only play music in regular voice channels.",
				});
				return;
			}

			// Check if bot has permissions
			const permissions = voiceChannel.permissionsFor(interaction.client.user);

			if (!permissions?.has("Connect") || !permissions?.has("Speak")) {
				await interaction.editReply({
					content:
						"I don't have permission to join or speak in that voice channel!",
				});
				return;
			}

			// Discord voice channels have built-in text chat - use the voice channel directly!
			// Discord's API allows sending messages to voice channel IDs - they appear in the voice channel's text chat
			const textChannel: TextChannel = voiceChannel as any as TextChannel;

			if (!textChannel) {
				await interaction.editReply({
					content: "Could not find a text channel to display the media player. Please ensure there's a text channel in the server.",
				});
				return;
			}

			// Search and play
			await interaction.editReply({
				content: `🔍 Searching for "${query}"...`,
			});

			const track = await mediaPlayer.play(
				interaction.guildId!,
				query,
				interaction.user,
				textChannel,
				voiceChannel
			);

			if (!track) {
				await interaction.editReply({
					content: `❌ Could not find any results for "${query}"`,
				});
				return;
			}

			await interaction.editReply({
				content: `✅ Added **${track.title}** to the queue!`,
			});
		} catch (error) {
			console.error("[PlayCommand] Error:", error);

			const errorMessage =
				error instanceof Error ? error.message : "Unknown error occurred";

			try {
				await interaction.editReply({
					content: `Failed to play music: ${errorMessage}`,
				});
			} catch (replyError) {
				console.error(
					"[PlayCommand] Failed to send error message:",
					replyError
				);
			}
		}
	},
};

export default playCommand;

