import type { DatabaseTool, ToolContext } from "../registry/DatabaseTools.js";
import {
	VoiceAssistantManager,
	VoiceControlCommand,
} from "../../../utils/discord-handlers/voice/VoiceAssistantManager.js";

/**
 * Voice control tools for AI assistant
 * Allows AI to join/leave voice channels when directed by users
 */

export const voiceTools: DatabaseTool[] = [

	{
		name: "getVoiceStatus",
		description:
			"Check if the bot is currently in a voice channel and get voice session information.",
		parameters: {
			type: "object",
			properties: {},
			required: [],
		},
		async execute(params, context: ToolContext) {
			const { guildId } = context;

			try {
				const voiceAssistant = VoiceAssistantManager.getInstance();

				const isInVoice = voiceAssistant.isInVoiceChannel(guildId);

				if (!isInVoice) {
					return JSON.stringify({
						connected: false,
						message: "Not currently in a voice channel",
					});
				}

				const session = voiceAssistant.getSession(guildId);

				if (!session) {
					return JSON.stringify({
						connected: false,
						message: "Session not found",
					});
				}

				return JSON.stringify({
					connected: true,
					channelName: session.channel.name,
					channelId: session.channelId,
					participants: Array.from(session.participants),
					participantCount: session.participants.size,
					isListening: session.isListening,
					isSpeaking: session.isSpeaking,
					sessionId: session.sessionId,
					lastActivity: session.lastActivity.toISOString(),
				});
			} catch (error) {
				console.error("[VoiceTools] Error getting voice status:", error);

				return JSON.stringify({
					success: false,
					error:
						error instanceof Error
							? error.message
							: "Failed to get voice status",
				});
			}
		},
	},

	{
		name: "controlVoiceSession",
		description:
			"Control the live voice session (pause/resume/stop playback or leave the voice channel). Use this ONLY when actively handling a voice conversation.",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					description:
						"Action to perform. Valid options: leave_channel, pause_playback, resume_playback, stop_playback.",
					enum: [
						"leave_channel",
						"pause_playback",
						"resume_playback",
						"stop_playback",
					],
				},
			},
			required: ["action"],
		},
		async execute(params, context: ToolContext) {
			const { guildId } = context;
			const voiceAssistant = VoiceAssistantManager.getInstance();

			try {
				switch (params.action) {
					case "leave_channel":
						await voiceAssistant.executeVoiceCommand(
							guildId,
							VoiceControlCommand.LEAVE
						);
						break;
					case "pause_playback":
						await voiceAssistant.executeVoiceCommand(
							guildId,
							VoiceControlCommand.PAUSE
						);
						break;
					case "resume_playback":
						await voiceAssistant.executeVoiceCommand(
							guildId,
							VoiceControlCommand.PLAY
						);
						break;
					case "stop_playback":
						await voiceAssistant.executeVoiceCommand(
							guildId,
							VoiceControlCommand.STOP
						);
						break;
					default:
						return JSON.stringify({
							success: false,
							error: `Unknown action: ${params.action}`,
						});
				}

				return JSON.stringify({
					success: true,
					action: params.action,
				});
			} catch (error) {
				console.error("[VoiceTools] Error running voice control command:", error);
				return JSON.stringify({
					success: false,
					error:
						error instanceof Error
							? error.message
							: "Failed to run voice control command",
				});
			}
		},
	},
];
