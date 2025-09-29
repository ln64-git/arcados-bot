// handlers/speakVoiceCall.ts
import { exec } from "node:child_process";
import type { Client, VoiceState } from "discord.js";

export function speakVoiceCall(client: Client) {
	client.on(
		"voiceStateUpdate",
		(oldState: VoiceState, newState: VoiceState) => {
			const guild = newState.guild;
			const user = newState.member?.user;
			if (!user) return;

			// Utility to remove emojis
			const removeEmojis = (str: string | undefined) =>
				str?.replace(/[\p{Emoji}\p{Extended_Pictographic}]/gu, "") || "";

			const userName = removeEmojis(user.displayName || user.username);
			const oldChannelName = removeEmojis(oldState.channel?.name);
			const newChannelName = removeEmojis(newState.channel?.name);

			if (oldState.channelId !== newState.channelId) {
				if (!oldState.channelId && newState.channelId) {
					// Joined VC
					exec(
						`cd /home/ln64/Source/nayru && bun start speak "${userName} joined ${newChannelName} in ${guild.name}"`,
					);
				} else if (oldState.channelId && !newState.channelId) {
					// Left VC
					exec(
						`cd /home/ln64/Source/nayru && bun start speak "${userName} left ${oldChannelName} in ${guild.name}"`,
					);
				} else if (oldState.channelId && newState.channelId) {
					// Switched VC
					exec(
						`cd /home/ln64/Source/nayru && bun start speak "${userName} switched from ${oldChannelName} to ${newChannelName} in ${guild.name}"`,
					);
				}
			}
		},
	);
}
