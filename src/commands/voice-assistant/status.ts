import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types/index.js";
import { VoiceAssistantManager } from "../../features/voice-assistant/VoiceAssistantManager.js";

const statusCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("voice-status")
		.setDescription("Check voice assistant status and diagnostics"),

	async execute(interaction) {
		const { guild } = interaction;

		if (!guild) {
			await interaction.reply({
				content: "This command can only be used in a server.",
				ephemeral: true,
			});
			return;
		}

		const voiceManager = VoiceAssistantManager.getInstance();
		const isInVoice = voiceManager.isInVoiceChannel(guild.id);

		if (!isInVoice) {
			await interaction.reply({
				content: "❌ Bot is not in a voice channel",
				ephemeral: true,
			});
			return;
		}

		const session = voiceManager["connectionManager"].getSession(guild.id);
		if (!session) {
			await interaction.reply({
				content: "❌ No active session found",
				ephemeral: true,
			});
			return;
		}

		// Get buffer status
		const bufferStatus = voiceManager["audioProcessor"].getBufferStatus(
			session.sessionId
		);

		// Check processing state
		const isProcessing = voiceManager["processingLocks"].get(guild.id) || false;
		const hasPlaybackController = voiceManager["playbackControllers"].has(guild.id);

		const status = `**Voice Assistant Status**

**Session Info:**
- Session ID: \`${session.sessionId}\`
- Channel: ${session.channel.name}
- Participants: ${session.participants.size}
- Listening: ${session.isListening ? "✅" : "❌"}
- Speaking: ${session.isSpeaking ? "✅" : "❌"}

**Audio Buffer:**
- Buffer Count: ${bufferStatus.bufferCount}
- Total Bytes: ${bufferStatus.totalBytes.toLocaleString()}
- Duration: ${Math.round(bufferStatus.durationMs)}ms

**Processing State:**
- Processing Lock: ${isProcessing ? "🔒 Locked" : "🔓 Unlocked"}
- Playback Controller: ${hasPlaybackController ? "▶️ Active" : "⏸️ Idle"}
- Transcription Buffer: "${session.transcriptionBuffer.substring(0, 100)}${session.transcriptionBuffer.length > 100 ? "..." : ""}"

**Transcription Interval:**
- Active: ${voiceManager["transcriptionTimers"].has(guild.id) ? "✅" : "❌"}`;

		await interaction.reply({
			content: status,
			ephemeral: true,
		});
	},
};

export default statusCommand;
