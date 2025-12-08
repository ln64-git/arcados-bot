import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
	ChannelType,
} from "discord.js";
import type { Command } from "../../../types";
import { StreamPlayerManager } from "../StreamPlayerManager.js";

export const streamCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("stream")
		.setDescription("Stream a movie or TV show to a voice channel")
		.addStringOption((option) =>
			option
				.setName("query")
				.setDescription("Movie or TV show name to stream (or 'stop' to stop current stream)")
				.setRequired(false)
		)
		.addChannelOption((option) =>
			option
				.setName("channel")
				.setDescription("Voice channel to stream to (defaults to your current channel)")
				.setRequired(false)
		),
	execute: async (interaction: ChatInputCommandInteraction) => {
		await interaction.deferReply();

		try {
			const query = interaction.options.getString("query");
			const channelOption = interaction.options.getChannel("channel");

			// Handle stop command
			if (!query || query.toLowerCase() === "stop") {
				const streamManager = StreamPlayerManager.getInstance();
				if (!streamManager.isStreaming(interaction.guildId!)) {
					await interaction.editReply({
						content: "❌ No stream is currently playing.",
					});
					return;
				}

				await streamManager.stopStream(interaction.guildId!);
				await interaction.editReply({
					content: "🔹 Stream stopped.",
				});
				return;
			}

			// Query is required for streaming
			if (!query) {
				await interaction.editReply({
					content: "❌ Please provide a movie or TV show name to stream, or use 'stop' to stop the current stream.",
				});
				return;
			}

			// Get voice channel
			let voiceChannel = channelOption;

			// If no channel specified, try to get user's current voice channel
			if (!voiceChannel) {
				const member = await interaction.guild?.members.fetch(interaction.user.id);
				if (member?.voice.channel) {
					voiceChannel = member.voice.channel;
				}
			}

			// Validate voice channel
			if (!voiceChannel) {
				await interaction.editReply({
					content: "❌ You must be in a voice channel or specify one.",
				});
				return;
			}

			if (voiceChannel.type !== ChannelType.GuildVoice) {
				await interaction.editReply({
					content: "❌ The specified channel is not a voice channel.",
				});
				return;
			}

			// Check if already streaming
			const streamManager = StreamPlayerManager.getInstance();
			if (streamManager.isStreaming(interaction.guildId!)) {
				await interaction.editReply({
					content: "❌ A stream is already playing. Use `/stream stop` to stop it first.",
				});
				return;
			}

			// Start streaming
			const result = await streamManager.streamContent({
				guildId: interaction.guildId!,
				voiceChannelId: voiceChannel.id,
				query,
			});

			if (result.success) {
				await interaction.editReply({
					content: `${result.message}`,
				});
			} else {
				await interaction.editReply({
					content: `❌ ${result.message || result.error || "Failed to start stream"}`,
				});
			}
		} catch (error) {
			console.error("[StreamCommand] Error:", error);
			await interaction.editReply({
				content: `❌ An error occurred: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	},
};

