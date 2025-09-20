// handlers/speakVoiceCall.ts
import { Client, VoiceState } from "discord.js";
import { exec } from "child_process";

export function speakVoiceCall(client: Client) {
    client.on("voiceStateUpdate", (oldState: VoiceState, newState: VoiceState) => {
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
                console.log(`${userName} joined ${newChannelName} in ${guild.name}`);
                exec(`/home/ln64/Source/qtts/qtts -port 2001 -input "${userName} joined ${newChannelName} in ${guild.name}"`);
            } else if (oldState.channelId && !newState.channelId) {
                // Left VC
                console.log(`${userName} left ${oldChannelName} in ${guild.name}`);
                exec(`/home/ln64/Source/qtts/qtts -port 2001 -input "${userName} left ${oldChannelName} in ${guild.name}"`);
            } else if (oldState.channelId && newState.channelId) {
                // Switched VC
                console.log(`${userName} switched from ${oldChannelName} to ${newChannelName} in ${guild.name}`);
                exec(`/home/ln64/Source/qtts/qtts -port 2001 -input "${userName} switched from ${oldChannelName} to ${newChannelName} in ${guild.name}"`);
            }
        }
    });
}
