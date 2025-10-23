import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
	EmbedBuilder,
	PermissionFlagsBits,
} from "discord.js";
import type { Command } from "../../../types";
import { PostgreSQLManager } from "../../../database/PostgreSQLManager";

export const userSummaryCommand: Command = {
		data: new SlashCommandBuilder()
			.setName("user-summary")
			.setDescription("Get a detailed summary of a user including their relationships")
			.addUserOption(option =>
				option
					.setName("user")
					.setDescription("The user to get a summary for")
					.setRequired(true)
			)
			.addBooleanOption(option =>
				option
					.setName("ephemeral")
					.setDescription("Make the response visible only to you (default: false)")
					.setRequired(false)
			)
			.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
			.setDMPermission(false),
	execute: async (interaction: ChatInputCommandInteraction) => {
		const targetUser = interaction.options.getUser("user", true);
		const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
		const guildId = interaction.guildId;

		await interaction.deferReply({ ephemeral });

		if (!guildId) {
			await interaction.editReply("🔸 This command can only be used in a server.");
			return;
		}

		const db = new PostgreSQLManager();
		
		try {
			const connected = await db.connect();
			
			if (!connected) {
				await interaction.editReply("🔸 Failed to connect to database.");
				return;
			}

			// Get user data
			const userResult = await db.query(`
				SELECT 
					user_id,
					username,
					display_name,
					global_name,
					summary,
					keywords,
					emojis,
					notes,
					joined_at,
					roles
				FROM members 
				WHERE user_id = $1 AND guild_id = $2
			`, [targetUser.id, guildId]);

			if (!userResult.success || !userResult.data || userResult.data.length === 0) {
				await interaction.editReply(`🔸 User ${targetUser.displayName} not found in this server.`);
				await db.disconnect();
				return;
			}

			const userData = userResult.data[0];

			// Get user's relationships
			const relationshipsResult = await db.query(`
				SELECT 
					rn.user_id,
					rn.affinity_percentage,
					rn.interaction_count,
					rn.last_interaction,
					rn.summary as relationship_summary,
					rn.keywords as relationship_keywords,
					rn.emojis as relationship_emojis,
					rn.notes as relationship_notes,
					rel_member.username,
					rel_member.display_name,
					rel_member.summary,
					rel_member.keywords,
					rel_member.emojis,
					rel_member.notes
				FROM members m
				CROSS JOIN LATERAL (
					SELECT 
						jsonb_array_elements(relationship_network) as rel
				) rn_expanded
				CROSS JOIN LATERAL (
					SELECT 
						(rel->>'user_id')::text as user_id,
						(rel->>'affinity_percentage')::float as affinity_percentage,
						(rel->>'interaction_count')::int as interaction_count,
						(rel->>'last_interaction')::timestamp as last_interaction,
						rel->>'summary' as summary,
						rel->'keywords' as keywords,
						rel->'emojis' as emojis,
						rel->'notes' as notes
				) rn
				LEFT JOIN members rel_member ON rel_member.user_id = rn.user_id AND rel_member.guild_id = m.guild_id
				WHERE m.user_id = $1 AND m.guild_id = $2
				ORDER BY rn.affinity_percentage DESC
				LIMIT 10
			`, [targetUser.id, guildId]);

			const relationships = relationshipsResult.success ? relationshipsResult.data || [] : [];

			// Create embed with clean styling
			const embed = new EmbedBuilder()
				.setTitle(userData.display_name)
				.setDescription(`@${userData.username}${userData.global_name ? ` • ${userData.global_name}` : ''}`)
				.setColor(0x5865F2)
				.setThumbnail(targetUser.displayAvatarURL({ size: 256, extension: 'png' }))
				.setTimestamp()
				.setFooter({ text: `ID: ${targetUser.id}` });

			// Add user metadata with clean formatting
			if (userData.summary) {
				const summaryText = userData.summary.length > 1000 ? userData.summary.substring(0, 997) + "..." : userData.summary;
				embed.addFields({
					name: "Summary",
					value: summaryText,
					inline: false
				});
			}

			// Format keywords cleanly
			if (userData.keywords && userData.keywords.length > 0) {
				const keywordText = userData.keywords.join(' • ');
				embed.addFields({
					name: "Keywords",
					value: keywordText,
					inline: false
				});
			}

			// Format emojis cleanly
			if (userData.emojis && userData.emojis.length > 0) {
				const emojiText = userData.emojis.join(' ');
				embed.addFields({
					name: "Emojis",
					value: emojiText,
					inline: false
				});
			}


			await interaction.editReply({ embeds: [embed] });
			await db.disconnect();

		} catch (error) {
			console.error("Error in user-summary command:", error);
			await interaction.editReply("🔸 An error occurred while retrieving the user summary.");
			
			try {
				await db.disconnect();
			} catch (disconnectError) {
				console.error("Error disconnecting from database:", disconnectError);
			}
		}
	},
};
