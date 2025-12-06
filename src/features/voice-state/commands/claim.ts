import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
  voiceStateCoordinator?: VoiceStateCoordinator;
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

    // Get the voice state coordinator from the bot
    const bot = interaction.client as BotClient;
    const coordinator = bot.voiceStateCoordinator;

    if (!coordinator) {
      await interaction.reply({
        content: "🔸 Voice state coordinator is not available.",
        ephemeral: true,
      });
      return;
    }

    try {
      // Check if user can claim this channel
      const canClaim = await coordinator.getOwnershipService().canUserClaim(
        voiceChannel.id,
        member.user.id
      );

      if (!canClaim) {
        await interaction.reply({
          content: "🔸 You cannot claim this channel. It must be empty or have no current owner.",
          ephemeral: true,
        });
        return;
      }

      // Claim the channel
      const claimed = await coordinator.getOwnershipService().claimChannel(
        voiceChannel.id,
        member.user.id
      );

      if (!claimed) {
        await interaction.reply({
          content: "🔸 Failed to claim channel.",
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `🔹 Successfully claimed **${voiceChannel.name}**!`,
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
