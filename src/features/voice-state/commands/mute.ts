import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
  voiceStateCoordinator?: VoiceStateCoordinator;
}

export const muteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute a user in your voice channel")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to mute")
        .setRequired(true)
    )
    .addBooleanOption((option) =>
      option
        .setName("unmute")
        .setDescription("Set to true to unmute instead")
        .setRequired(false)
    ),

  async execute(interaction) {
    // Defer reply immediately to acknowledge the interaction
    await interaction.deferReply({ ephemeral: false });

    if (!interaction.guild || !interaction.member) {
      await interaction.editReply({
        content: "🔸 This command can only be used in a server.",
      });
      return;
    }

    const member = interaction.member;
    if (!("voice" in member)) {
      await interaction.editReply({
        content: "🔸 This command requires a guild member.",
      });
      return;
    }

    const targetUser = interaction.options.getUser("user", true);
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.editReply({
        content: "🔸 You must be in a voice channel to use this command.",
      });
      return;
    }

    // Get the voice state coordinator from the bot
    const bot = interaction.client as BotClient;
    const coordinator = bot.voiceStateCoordinator;

    if (!coordinator) {
      await interaction.editReply({
        content: "🔸 Voice state coordinator is not available.",
      });
      return;
    }

    try {
      // Check if this is a user channel and user is the owner
      const currentOwner = await coordinator.getOwnershipService().getOwner(
        voiceChannel.id
      );

      if (!currentOwner) {
        await interaction.editReply({
          content: "🔸 This is not a user-owned voice channel.",
        });
        return;
      }

      if (currentOwner !== member.user.id) {
        await interaction.editReply({
          content: "🔸 You are not the owner of this channel.",
        });
        return;
      }

      // Check if target is in the channel
      const targetMember = voiceChannel.members.get(targetUser.id);
      if (!targetMember) {
        await interaction.editReply({
          content: "🔸 The target user is not in this voice channel.",
        });
        return;
      }

      // Get toggle option (true = unmute, false/default = mute)
      const shouldUnmute = interaction.options.getBoolean("unmute") ?? false;

      // Apply mute or unmute
      if (shouldUnmute) {
        await coordinator.getModerationService().unmute(
          voiceChannel.id,
          targetUser.id,
          member.user.id
        );
        await interaction.editReply({
          content: `🔹 Unmuted **${targetUser.displayName}** in this channel.`,
        });
      } else {
        await coordinator.getModerationService().mute(
          voiceChannel.id,
          targetUser.id,
          member.user.id
        );
        await interaction.editReply({
          content: `🔹 Muted **${targetUser.displayName}** in this channel.`,
        });
      }
    } catch (error) {
      console.error("🔸 Error in mute command:", error);
      await interaction.editReply({
        content: "🔸 An error occurred while trying to mute the user.",
      });
    }
  },
};
