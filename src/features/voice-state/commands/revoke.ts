import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
  voiceStateCoordinator?: VoiceStateCoordinator;
}

export const renounceCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("revoke")
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
        content: "🔸 You must be in a voice channel to revoke ownership.",
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
      // Check if this is a user channel
      const currentOwner = await coordinator.getOwnershipService().getOwner(
        voiceChannel.id
      );

      if (!currentOwner) {
        await interaction.reply({
          content: "🔸 This is not a user-owned voice channel.",
          ephemeral: true,
        });
        return;
      }

      if (currentOwner !== member.user.id) {
        await interaction.reply({
          content: "🔸 You are not the owner of this channel.",
          ephemeral: true,
        });
        return;
      }

      // Renounce ownership (this handles determining next owner and transfer)
      await coordinator.getOwnershipService().renounceOwnership(
        voiceChannel.id,
        member.user.id
      );

      await interaction.reply({
        content: `🔹 Successfully renounced ownership of **${voiceChannel.name}**!`,
        ephemeral: false,
      });
    } catch (error) {
      console.error("🔸 Error in renounce command:", error);
      await interaction.reply({
        content: "🔸 An error occurred while trying to renounce ownership.",
        ephemeral: true,
      });
    }
  },
};
