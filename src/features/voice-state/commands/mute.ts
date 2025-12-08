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
    // Defer reply IMMEDIATELY - Discord requires response within 3 seconds
    // Check if interaction is already expired before trying to defer
    if (interaction.ephemeral || interaction.replied || interaction.deferred) {
      // Interaction already handled or expired
      return;
    }

    let deferred = false;
    try {
      // Try to defer - this must happen within 3 seconds of interaction creation
      await interaction.deferReply({ ephemeral: false });
      deferred = true;
    } catch (error: any) {
      // If defer fails, interaction likely expired
      if (error?.code === 10062) {
        // Unknown interaction - already expired
        console.error("[MuteCommand] Interaction expired before defer");
        return;
      }
      console.error("[MuteCommand] Failed to defer reply:", error);
      
      // Try immediate reply as last resort (will likely also fail if expired)
      try {
        await interaction.reply({
          content: "Processing...",
          ephemeral: false,
        });
        deferred = true;
      } catch (replyError: any) {
        if (replyError?.code === 10062) {
          console.error("[MuteCommand] Interaction expired before reply");
        } else {
          console.error("[MuteCommand] Failed to reply:", replyError);
        }
        return;
      }
    }

    // Helper function to safely send messages
    const sendMessage = async (content: string) => {
      try {
        if (deferred) {
          await interaction.editReply({ content });
        } else {
          await interaction.followUp({ content, ephemeral: false });
        }
      } catch (error) {
        console.error("[MuteCommand] Failed to send message:", error);
      }
    };

    if (!interaction.guild || !interaction.member) {
      await sendMessage("🔸 This command can only be used in a server.");
      return;
    }

    const member = interaction.member;
    if (!("voice" in member)) {
      await sendMessage("🔸 This command requires a guild member.");
      return;
    }

    const targetUser = interaction.options.getUser("user", true);
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await sendMessage("🔸 You must be in a voice channel to use this command.");
      return;
    }

    // Get the voice state coordinator from the bot
    const bot = interaction.client as BotClient;
    const coordinator = bot.voiceStateCoordinator;

    if (!coordinator) {
      await sendMessage("🔸 Voice state coordinator is not available.");
      return;
    }

    try {
      // Check if this is a user channel and user is the owner
      const currentOwner = await coordinator.getOwnershipService().getOwner(
        voiceChannel.id
      );

      if (!currentOwner) {
        await sendMessage("🔸 This is not a user-owned voice channel.");
        return;
      }

      if (currentOwner !== member.user.id) {
        await sendMessage("🔸 You are not the owner of this channel.");
        return;
      }

      // Check if target is in the channel
      const targetMember = voiceChannel.members.get(targetUser.id);
      if (!targetMember) {
        await sendMessage("🔸 The target user is not in this voice channel.");
        return;
      }

      // Get toggle option (true = unmute, false/default = mute)
      const shouldUnmute = interaction.options.getBoolean("unmute") ?? false;

      // Load current preferences
      const preferences = await coordinator.getSpawnChannelService().getPreferences(
        member.user.id,
        interaction.guild.id
      );

      const mutedUsers = (preferences.muted_users as string[]) || [];

      if (shouldUnmute) {
        // Remove from mute list (de-duped)
        const updatedMutedUsers = mutedUsers.filter(id => id !== targetUser.id);
        const updatedPreferences = {
          ...preferences,
          muted_users: updatedMutedUsers,
        };

        await coordinator.getSpawnChannelService().updatePreferences(
          member.user.id,
          interaction.guild.id,
          updatedPreferences
        );

        // Apply unmute
        await coordinator.getModerationService().unmute(
          voiceChannel.id,
          targetUser.id,
          member.user.id
        );

        await sendMessage(`🔹 **${targetUser.displayName}** is now unmuted in your channels.`);
      } else {
        // Add to mute list (de-duped using Set)
        const updatedMutedUsers = Array.from(new Set([...mutedUsers, targetUser.id]));
        const updatedPreferences = { ...preferences, muted_users: updatedMutedUsers };

        await coordinator.getSpawnChannelService().updatePreferences(
          member.user.id,
          interaction.guild.id,
          updatedPreferences
        );

        // Apply mute
        await coordinator.getModerationService().mute(
          voiceChannel.id,
          targetUser.id,
          member.user.id
        );

        await sendMessage(`🔹 **${targetUser.displayName}** is now muted in your channels.`);
      }
    } catch (error) {
      console.error("🔸 Error in mute command:", error);
      await sendMessage("🔸 An error occurred while trying to mute the user.");
    }
  },
};
