import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../types/index.js";
import { VoiceAssistantManager } from "../VoiceAssistantManager.js";

/**
 * Leave voice channel command
 * Makes the bot leave its current voice channel
 */
const leaveCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("leave")
		.setDescription("Leave the current voice channel"),

	async execute(interaction: ChatInputCommandInteraction) {
		try {
			// Defer reply for async operations
			await interaction.deferReply();

			const voiceAssistant = VoiceAssistantManager.getInstance();

			// Check if guild exists
			if (!interaction.guildId) {
				await interaction.editReply({
					content: "This command can only be used in a server!",
				});
				return;
			}

			// Check if bot is in a voice channel
			if (!voiceAssistant.isInVoiceChannel(interaction.guildId)) {
				await interaction.editReply({
					content: "I'm not in a voice channel!",
				});
				return;
			}

			// Get session info for logging
			const session = voiceAssistant.getSession(interaction.guildId);
			const channelName = session?.channel.name || "unknown";

			console.log(
				`[LeaveCommand] User ${interaction.user.tag} requesting leave from ${channelName}`
			);

			// Leave the voice channel
			await voiceAssistant.leaveVoiceChannel(interaction.guildId);

			await interaction.editReply({
				content: `Left ${channelName}. Thanks for chatting!`,
			});

			console.log(`[LeaveCommand] Successfully left ${channelName}`);
		} catch (error) {
			console.error("[LeaveCommand] Error:", error);

			const errorMessage =
				error instanceof Error ? error.message : "Unknown error occurred";

			await interaction.editReply({
				content: `Failed to leave voice channel: ${errorMessage}`,
			});
		}
	},
};

export default leaveCommand;
