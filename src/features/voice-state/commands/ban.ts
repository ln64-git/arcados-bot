import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceStateCoordinator } from "../VoiceStateCoordinator";

// Extend the Client interface to include voiceStateCoordinator
interface BotClient {
  voiceStateCoordinator?: VoiceStateCoordinator;
}

export const banCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user from your voice channels")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to ban").setRequired(true)
    )
    .addBooleanOption((option) =>
      option
        .setName("unban")
        .setDescription("Set to true to unban instead")
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

      // Get toggle option (true = unban, false/default = ban)
      const shouldUnban = interaction.options.getBoolean("unban") ?? false;

      // Load current preferences
      const preferences = await coordinator.getSpawnChannelService().getPreferences(
        member.user.id,
        interaction.guild.id
      );

      const bannedUsers = (preferences.banned_users as string[]) || [];

      // Defer reply since permission updates can take time
      await interaction.deferReply({ ephemeral: false });

      if (shouldUnban) {
        // Remove from ban list (de-duped)
        const updatedBannedUsers = bannedUsers.filter(
          (id) => id !== targetUser.id
        );
        const updatedPreferences = {
          ...preferences,
          banned_users: updatedBannedUsers,
        };

        await coordinator.getSpawnChannelService().updatePreferences(
          member.user.id,
          interaction.guild.id,
          updatedPreferences
        );

        // Remove Discord permission overrides from all owner's channels
        await coordinator.getModerationService().removeBanPermissions(
          targetUser.id,
          member.user.id,
          interaction.guild.id
        );

        await interaction.editReply({
          content: `🔹 **${targetUser.displayName}** is now unbanned from your voice channels.`,
        });
      } else {
        // Add to ban list (de-duped using Set)
        const updatedBannedUsers = Array.from(new Set([...bannedUsers, targetUser.id]));
        const updatedPreferences = { ...preferences, banned_users: updatedBannedUsers };

        await coordinator.getSpawnChannelService().updatePreferences(
          member.user.id,
          interaction.guild.id,
          updatedPreferences
        );

        // Apply Discord permission overrides to all owner's channels
        await coordinator.getModerationService().applyBanPermissions(
          targetUser.id,
          member.user.id,
          interaction.guild.id
        );

        // Kick user if currently in any of the owner's channels
        const targetMember = voiceChannel.members.get(targetUser.id);
        if (targetMember) {
          await targetMember.voice.disconnect(
            "You have been banned from this channel"
          );
        }

        await interaction.editReply({
          content: `🔹 **${targetUser.displayName}** is now banned from your voice channels.`,
        });
      }
    } catch (error) {
      console.error("🔸 Error in ban command:", error);
      await interaction.reply({
        content: "🔸 An error occurred while trying to ban the user.",
        ephemeral: true,
      });
    }
  },
};
