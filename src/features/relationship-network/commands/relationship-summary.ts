import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import type { Command } from "../../../types";
import { PostgreSQLManager } from "../../database/PostgreSQLManager";

export const relationshipSummaryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("relationship-summary")
    .setDescription("Get relationship summary between two users")
    .addUserOption((option) =>
      option.setName("user1").setDescription("First user").setRequired(true)
    )
    .addUserOption((option) =>
      option.setName("user2").setDescription("Second user").setRequired(true)
    )
    .addBooleanOption((option) =>
      option
        .setName("ephemeral")
        .setDescription(
          "Make the response visible only to you (default: false)"
        )
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  execute: async (interaction: ChatInputCommandInteraction) => {
    const user1 = interaction.options.getUser("user1", true);
    const user2 = interaction.options.getUser("user2", true);
    const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
    const guildId = interaction.guildId;

    await interaction.deferReply({ ephemeral });

    if (!guildId) {
      await interaction.editReply("This command can only be used in a server.");
      return;
    }

    // Check if user1 and user2 are the same
    if (user1.id === user2.id) {
      await interaction.editReply("Please select two different users.");
      return;
    }

    const db = new PostgreSQLManager();

    try {
      const connected = await db.connect();

      if (!connected) {
        await interaction.editReply("Failed to connect to database.");
        return;
      }

      // Get user1's relationship with user2
      const relationshipResult = await db.query(
        `
				SELECT 
					rn.target_user_id,
					rn.affinity_percentage,
					rn.interaction_count,
					rn.last_interaction,
					rn.summary as relationship_summary,
					rn.keywords as relationship_keywords,
					rn.emojis as relationship_emojis,
					rn.notes as relationship_notes,
					u1.display_name as user1_display_name,
					u1.username as user1_username,
					u2.display_name as user2_display_name,
					u2.username as user2_username
				FROM members u1
				CROSS JOIN LATERAL (
					SELECT 
						jsonb_array_elements(relationship_network) as rel
				) rn_expanded
				CROSS JOIN LATERAL (
					SELECT 
						(rel->>'target_user_id')::text as target_user_id,
						(rel->>'affinity_percentage')::float as affinity_percentage,
						(rel->>'interaction_count')::int as interaction_count,
						(rel->>'last_interaction')::timestamp as last_interaction,
						rel->>'summary' as summary,
						rel->'keywords' as keywords,
						rel->'emojis' as emojis,
						rel->'notes' as notes
				) rn
				LEFT JOIN members u2 ON u2.user_id = rn.target_user_id AND u2.guild_id = u1.guild_id
				WHERE u1.user_id = $1 AND u1.guild_id = $2 AND rn.target_user_id = $3
			`,
        [user1.id, guildId, user2.id]
      );

      if (
        !relationshipResult.success ||
        !relationshipResult.data ||
        relationshipResult.data.length === 0
      ) {
        await interaction.editReply(
          `Sorry, no relationship detected between ${user1.displayName} and ${user2.displayName}.`
        );
        await db.disconnect();
        return;
      }

      const relationship = relationshipResult.data[0];

      // Create embed
      const embed = new EmbedBuilder()
        .setTitle(
          `Relationship: ${relationship.user1_display_name} ↔ ${relationship.user2_display_name}`
        )
        .setDescription(
          `@${relationship.user1_username} • @${relationship.user2_username}`
        )
        .setColor(0x5865f2)
        .setTimestamp()
        .setFooter({
          text: `${relationship.affinity_percentage}% affinity • ${relationship.interaction_count} interactions`,
        });

      // Add relationship metadata
      if (relationship.relationship_summary) {
        const summaryText =
          relationship.relationship_summary.length > 1000
            ? relationship.relationship_summary.substring(0, 997) + "..."
            : relationship.relationship_summary;
        embed.addFields({
          name: "Summary",
          value: summaryText,
          inline: false,
        });
      }

      // Add keywords
      if (
        relationship.relationship_keywords &&
        relationship.relationship_keywords.length > 0
      ) {
        const keywordText = relationship.relationship_keywords.join(" • ");
        embed.addFields({
          name: "Keywords",
          value: keywordText,
          inline: false,
        });
      }

      // Add emojis
      if (
        relationship.relationship_emojis &&
        relationship.relationship_emojis.length > 0
      ) {
        const emojiText = relationship.relationship_emojis.join(" ");
        embed.addFields({
          name: "Emojis",
          value: emojiText,
          inline: false,
        });
      }

      // Add interaction info
      const lastInteraction = new Date(relationship.last_interaction);
      const lastInteractionText = `<t:${Math.floor(
        lastInteraction.getTime() / 1000
      )}:R>`;

      embed.addFields({
        name: "Interaction Info",
        value: `Last interaction: ${lastInteractionText}`,
        inline: false,
      });

      await interaction.editReply({ embeds: [embed] });
      await db.disconnect();
    } catch (error) {
      console.error("Error in relationship-summary command:", error);
      await interaction.editReply(
        "An error occurred while retrieving the relationship summary."
      );

      try {
        await db.disconnect();
      } catch (disconnectError) {
        console.error("Error disconnecting from database:", disconnectError);
      }
    }
  },
};
