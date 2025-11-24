import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceChannelManager } from "../VoiceChannelManager";

// Extend the Client interface to include voiceChannelManager
interface BotClient {
  voiceChannelManager?: VoiceChannelManager;
}

export const claimCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Reclaim a voice channel you previously owned"),

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
        content: "🔸 You must be in a voice channel to claim it.",
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
      // Check if user can claim this channel
      const canClaimResult = await voiceChannelManager.canUserClaim(
        member.user.id,
        voiceChannel.id
      );
      if (!canClaimResult.success) {
        await interaction.reply({
          content: `🔸 Failed to check claim eligibility: ${canClaimResult.error}`,
          ephemeral: true,
        });
        return;
      }

      if (!canClaimResult.data) {
        await interaction.reply({
          content: "🔸 You have never owned this channel before.",
          ephemeral: true,
        });
        return;
      }

      // Reclaim the channel
      const reclaimResult = await voiceChannelManager.reclaimChannel(
        member.user.id,
        voiceChannel.id
      );
      if (!reclaimResult.success) {
        await interaction.reply({
          content: `🔸 Failed to reclaim channel: ${reclaimResult.error}`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `🔹 Successfully reclaimed **${voiceChannel.name}**!`,
        ephemeral: false,
      });
    } catch (error) {
      console.error("🔸 Error in claim command:", error);
      await interaction.reply({
        content: "🔸 An error occurred while trying to claim the channel.",
        ephemeral: true,
      });
    }
  },
};
