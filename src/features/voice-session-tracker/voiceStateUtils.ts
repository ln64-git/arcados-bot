import type { VoiceState } from "discord.js";

/**
 * Convert Discord VoiceState to PostgreSQL voice state format
 */
export function discordVoiceStateToPostgres(voiceState: VoiceState): Record<string, unknown> {
	const user = voiceState.member?.user;
	if (!user) {
		throw new Error("VoiceState must have a member with a user");
	}

	return {
		guild_id: voiceState.guild.id,
		user_id: user.id,
		channel_id: voiceState.channelId || null,
		self_mute: voiceState.selfMute || false,
		self_deaf: voiceState.selfDeaf || false,
		server_mute: voiceState.mute || false,
		server_deaf: voiceState.deaf || false,
		streaming: voiceState.streaming || false,
		self_video: voiceState.selfVideo || false,
	};
}

