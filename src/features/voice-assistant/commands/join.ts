import { SlashCommandBuilder, ChannelType, type ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../types/index.js";
import { VoiceAssistantManager } from "../VoiceAssistantManager.js";

/**
 * Join voice channel command
 * Makes the bot join the user's current voice channel
 */
const joinCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("join")
		.setDescription("Join your current voice channel and start listening for 'Aria'"),

	async execute(interaction: ChatInputCommandInteraction) {
		// Defer reply IMMEDIATELY to prevent timeout
		await interaction.deferReply().catch((error) => {
			console.error("[JoinCommand] Failed to defer reply:", error);
			return; // If defer fails, we can't do anything
		});

		try {
			const voiceAssistant = VoiceAssistantManager.getInstance();

			// Check if voice assistant is enabled
			if (!voiceAssistant.isEnabled()) {
				await interaction.editReply({
					content:
						"Voice assistant is not configured. Please contact the bot administrator.",
				});
				return;
			}

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
					content: "I can only join regular voice channels.",
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

			// Join the voice channel
			console.log(
				`[JoinCommand] User ${interaction.user.tag} requesting join to ${voiceChannel.name}`
			);

			const session = await voiceAssistant.joinVoiceChannel(
				voiceChannel,
				interaction.user.id
			);

			await interaction.editReply({
				content: `Joined ${voiceChannel.name}! Say "Aria" followed by your question to talk to me.`,
			});

			console.log(
				`[JoinCommand] Successfully joined ${voiceChannel.name} (session: ${session.sessionId})`
			);
		} catch (error) {
			console.error("[JoinCommand] Error:", error);

			const errorMessage =
				error instanceof Error ? error.message : "Unknown error occurred";

			// Try to send error message, but don't throw if interaction expired
			try {
				await interaction.editReply({
					content: `Failed to join voice channel: ${errorMessage}`,
				});
			} catch (replyError) {
				console.error("[JoinCommand] Failed to send error message:", replyError);
			}
		}
	},
};

export default joinCommand;
