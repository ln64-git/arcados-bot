import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../../types";
import type { VoiceChannelManager } from "../VoiceChannelManager";

// Extend the Client interface to include voiceChannelManager
interface BotClient {
  voiceChannelManager?: VoiceChannelManager;
}

export const channelPrefsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("channel-prefs")
    .setDescription("Configure your voice channel preferences")
    .addStringOption((option) =>
      option
        .setName("channel_name")
        .setDescription(
          "Custom name for your channels (leave empty for default)"
        )
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("user_limit")
        .setDescription("Default user limit for your channels (0 = unlimited)")
        .setMinValue(0)
        .setMaxValue(99)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("privacy_mode")
        .setDescription("Privacy mode for your channels")
        .addChoices(
          { name: "Public", value: "public" },
          { name: "Friends Only", value: "friends_only" },
          { name: "Private", value: "private" }
        )
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
      // Load current preferences
      const member = interaction.member;
      if (!member || typeof member === "string") {
        await interaction.reply({
          content: "🔸 This command requires a guild member.",
          ephemeral: true,
        });
        return;
      }

      const memberId = "id" in member ? member.id : member.user.id;
      const preferencesResult = await voiceChannelManager.loadUserPreferences(
        memberId,
        interaction.guild.id
      );

      if (!preferencesResult.success) {
        await interaction.reply({
          content: `🔸 Failed to load preferences: ${preferencesResult.error}`,
          ephemeral: true,
        });
        return;
      }

      const currentPreferences = (preferencesResult.data || {}) as {
        channel_name?: string;
        default_user_limit?: number;
        privacy_mode?: string;
        banned_users?: string[];
        muted_users?: string[];
        deafened_users?: string[];
      };
      const newPreferences = { ...currentPreferences };

      // Update preferences based on provided options
      const channelName = interaction.options.getString("channel_name");
      const userLimit = interaction.options.getInteger("user_limit");
      const privacyMode = interaction.options.getString("privacy_mode");

      if (channelName !== null) {
        newPreferences.channel_name = channelName || undefined;
      }

      if (userLimit !== null) {
        newPreferences.default_user_limit = userLimit || undefined;
      }

      if (privacyMode !== null) {
        newPreferences.privacy_mode = privacyMode;
      }

      // If no options provided, show current preferences
      if (channelName === null && userLimit === null && privacyMode === null) {
        const embed = new EmbedBuilder()
          .setTitle("🔹 Your Voice Channel Preferences")
          .setColor(0x00ff00)
          .addFields(
            {
              name: "Channel Name",
              value:
                (currentPreferences.channel_name as string | undefined) ||
                `[Your DisplayName]'s Channel`,
              inline: true,
            },
            {
              name: "User Limit",
              value:
                currentPreferences.default_user_limit?.toString() ||
                "Unlimited",
              inline: true,
            },
            {
              name: "Privacy Mode",
              value:
                (currentPreferences.privacy_mode as string | undefined) ||
                "Public",
              inline: true,
            },
            {
              name: "Banned Users",
              value: (
                (currentPreferences.banned_users as string[] | undefined)
                  ?.length || 0
              ).toString(),
              inline: true,
            },
            {
              name: "Muted Users",
              value: (
                (currentPreferences.muted_users as string[] | undefined)
                  ?.length || 0
              ).toString(),
              inline: true,
            },
            {
              name: "Deafened Users",
              value: (
                (currentPreferences.deafened_users as string[] | undefined)
                  ?.length || 0
              ).toString(),
              inline: true,
            }
          )
          .setFooter({
            text: "Use the command with options to update your preferences",
          });

        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
        return;
      }

      // Update preferences in database
      const updateResult = await voiceChannelManager.updateUserPreferences(
        memberId,
        interaction.guild.id,
        newPreferences
      );

      if (!updateResult.success) {
        await interaction.reply({
          content: `🔸 Failed to update preferences: ${updateResult.error}`,
          ephemeral: true,
        });
        return;
      }

      // Show updated preferences
      const embed = new EmbedBuilder()
        .setTitle("🔹 Updated Voice Channel Preferences")
        .setColor(0x00ff00)
        .addFields(
          {
            name: "Channel Name",
            value:
              (newPreferences.channel_name as string | undefined) ||
              `[Your DisplayName]'s Channel`,
            inline: true,
          },
          {
            name: "User Limit",
            value: newPreferences.default_user_limit?.toString() || "Unlimited",
            inline: true,
          },
          {
            name: "Privacy Mode",
            value:
              (newPreferences.privacy_mode as string | undefined) || "Public",
            inline: true,
          }
        )
        .setFooter({
          text: "Preferences will apply to new channels you create",
        });

      await interaction.reply({
        embeds: [embed],
        ephemeral: false,
      });
    } catch (error) {
      console.error("🔸 Error in channel-prefs command:", error);
      await interaction.reply({
        content: "🔸 An error occurred while updating your preferences.",
        ephemeral: true,
      });
    }
  },
};
