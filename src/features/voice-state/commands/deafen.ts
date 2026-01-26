import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
  voiceStateCoordinator?: VoiceStateCoordinator;
}

export const deafenCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("deafen")
    .setDescription("Deafen a user in your voice channel")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to deafen")
        .setRequired(true)
    )
    .addBooleanOption((option) =>
      option
        .setName("undeafen")
        .setDescription("Set to true to undeafen instead")
        .setRequired(false)
    ),

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

    const targetUser = interaction.options.getUser("user", true);
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: "🔸 You must be in a voice channel to use this command.",
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
      // Check if this is a user channel and user is the owner
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

      // Check if target is in the channel
      const targetMember = voiceChannel.members.get(targetUser.id);
      if (!targetMember) {
        await interaction.reply({
          content: "🔸 The target user is not in this voice channel.",
          ephemeral: true,
        });
        return;
      }

      // Get toggle option (true = undeafen, false/default = deafen)
      const shouldUndeafen = interaction.options.getBoolean("undeafen") ?? false;

      // Load current preferences
      const preferences = await coordinator.getSpawnChannelService().getPreferences(
        member.user.id,
        interaction.guild.id
      );

      const deafenedUsers = (preferences.deafened_users as string[]) || [];

      if (shouldUndeafen) {
        // Remove from deafen list (de-duped)
        const updatedDeafenedUsers = deafenedUsers.filter(id => id !== targetUser.id);
        const updatedPreferences = {
          ...preferences,
          deafened_users: updatedDeafenedUsers,
        };

        await coordinator.getSpawnChannelService().updatePreferences(
          member.user.id,
          interaction.guild.id,
          updatedPreferences
        );

        // Apply undeafen
        await coordinator.getModerationService().undeafen(
          voiceChannel.id,
          targetUser.id,
          member.user.id
        );

        await interaction.reply({
          content: ` **${targetUser.displayName}** is now undeafened in your channels.`,
          ephemeral: false,
        });
      } else {
        // Add to deafen list (de-duped using Set)
        const updatedDeafenedUsers = Array.from(new Set([...deafenedUsers, targetUser.id]));
        const updatedPreferences = { ...preferences, deafened_users: updatedDeafenedUsers };

        await coordinator.getSpawnChannelService().updatePreferences(
          member.user.id,
          interaction.guild.id,
          updatedPreferences
        );

        // Apply deafen
        await coordinator.getModerationService().deafen(
          voiceChannel.id,
          targetUser.id,
          member.user.id
        );

        await interaction.reply({
          content: ` **${targetUser.displayName}** is now deafened in your channels.`,
          ephemeral: false,
        });
      }
    } catch (error) {
      console.error("🔸 Error in deafen command:", error);
      await interaction.reply({
        content: "🔸 An error occurred while trying to deafen the user.",
        ephemeral: true,
      });
    }
  },
};
