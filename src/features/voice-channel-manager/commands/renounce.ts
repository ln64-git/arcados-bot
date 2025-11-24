import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceChannelManager } from "../VoiceChannelManager";

// Extend the Client interface to include voiceChannelManager
interface BotClient {
  voiceChannelManager?: VoiceChannelManager;
}

export const renounceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("renounce")
    .setDescription("Drop ownership of your current voice channel"),

  async execute(interaction) {
    if (!interaction.guild || !interaction.member) {
      await interaction.reply({
        content: "🔸 This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const member = interaction.member;
    if (!("voice" in member)) {
      await interaction.reply({
        content: "🔸 This command requires a guild member.",
        ephemeral: true,
      });
      return;
    }

    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: "🔸 You must be in a voice channel to renounce ownership.",
        ephemeral: true,
      });
      return;
    }

    // Get the voice channel manager from the bot
    const bot = interaction.client as BotClient;
    const voiceChannelManager = bot.voiceChannelManager;

    if (!voiceChannelManager) {
      await interaction.reply({
        content: "🔸 Voice channel manager is not available.",
        ephemeral: true,
      });
      return;
    }

    try {
      // Check if this is a user channel
      const ownerResult = await voiceChannelManager.getChannelOwner(
        voiceChannel.id
      );

      if (!ownerResult.success || !ownerResult.data) {
        await interaction.reply({
          content: "🔸 This is not a user-owned voice channel.",
          ephemeral: true,
        });
        return;
      }

      if (ownerResult.data !== member.user.id) {
        await interaction.reply({
          content: "🔸 You are not the owner of this channel.",
          ephemeral: true,
        });
        return;
      }

      // Determine next owner
      const nextOwnerResult = await voiceChannelManager.determineNextOwner(
        voiceChannel.id
      );
      if (!nextOwnerResult.success) {
        await interaction.reply({
          content: `🔸 Failed to determine next owner: ${nextOwnerResult.error}`,
          ephemeral: true,
        });
        return;
      }

      if (nextOwnerResult.data) {
        // Transfer ownership
        const transferResult = await voiceChannelManager.transferOwnership(
          voiceChannel.id,
          nextOwnerResult.data
        );

        if (!transferResult.success) {
          await interaction.reply({
            content: `🔸 Failed to transfer ownership: ${transferResult.error}`,
            ephemeral: true,
          });
          return;
        }

        await interaction.reply({
          content: `🔹 Successfully renounced ownership of **${voiceChannel.name}**!`,
          ephemeral: false,
        });
      } else {
        // No one left, channel will be deleted
        await interaction.reply({
          content: `🔹 Renounced ownership of **${voiceChannel.name}**. Channel will be deleted since no one else is present.`,
          ephemeral: false,
        });
      }
    } catch (error) {
      console.error("🔸 Error in renounce command:", error);
      await interaction.reply({
        content: "🔸 An error occurred while trying to renounce ownership.",
        ephemeral: true,
      });
    }
  },
};
