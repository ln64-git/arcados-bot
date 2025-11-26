import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Command } from "../types";
import { VoiceAssistantManager } from "../handlers/voice/VoiceAssistantManager";

/**
 * Join voice channel command
 * Makes the bot join the user's current voice channel
 */
const joinCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription(
      "Join your current voice channel and start listening for 'Aria'"
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Defer reply IMMEDIATELY to prevent timeout
    let deferred = false;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
    } catch (error) {
      console.error("[JoinCommand] Failed to defer reply:", error);
      // If defer fails, try to reply directly (may fail if interaction expired)
      try {
        await interaction.reply({
          content: "Processing your request...",
          flags: MessageFlags.Ephemeral,
        });
        deferred = true;
      } catch (replyError) {
        console.error("[JoinCommand] Failed to reply:", replyError);
        // Interaction may have expired, can't do anything
        return;
      }
    }

    // Helper function to safely send messages
    const sendMessage = async (content: string) => {
      try {
        if (deferred) {
          await interaction.editReply({ content });
        } else {
          await interaction.followUp({
            content,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (error) {
        console.error("[JoinCommand] Failed to send message:", error);
      }
    };

    try {
      const voiceAssistant = VoiceAssistantManager.getInstance();

      // Check if voice assistant is enabled
      if (!voiceAssistant.isEnabled()) {
        await sendMessage(
          "Voice assistant is not configured. Please contact the bot administrator."
        );
        return;
      }

      // Check if user is in a voice channel
      const member = interaction.guild?.members.cache.get(interaction.user.id);

      if (!member?.voice.channel) {
        await sendMessage("You need to be in a voice channel first!");
        return;
      }

      const voiceChannel = member.voice.channel;

      // Check if it's a voice channel (not stage)
      if (voiceChannel.type !== ChannelType.GuildVoice) {
        await sendMessage("I can only join regular voice channels.");
        return;
      }

      // Check if bot has permissions
      const permissions = voiceChannel.permissionsFor(interaction.client.user);

      if (!permissions?.has("Connect") || !permissions?.has("Speak")) {
        await sendMessage(
          "I don't have permission to join or speak in that voice channel!"
        );
        return;
      }

      await voiceAssistant.joinVoiceChannel(
        voiceChannel,
        interaction.user.id
      );

      await sendMessage(
        `Joined ${voiceChannel.name}! Say "Aria" followed by your question to talk to me.`
      );
    } catch (error) {
      console.error("[JoinCommand] Error:", error);

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      // Provide more helpful error messages for common issues
      let userMessage = `Failed to join voice channel: ${errorMessage}`;
      if (error instanceof Error && error.name === "AbortError") {
        userMessage =
          "Failed to join voice channel: The connection timed out or was cancelled. Please try again.";
      }

      await sendMessage(userMessage);
    }
  },
};

export default joinCommand;
