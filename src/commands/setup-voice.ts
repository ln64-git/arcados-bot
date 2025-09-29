import {
	ChannelType,
	type ChatInputCommandInteraction,
	EmbedBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../types";
import { getDatabase } from "../utils/database";

export const setupVoiceCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("setup-voice")
		.setDescription("Admin: Setup voice channel spawning for this server")
		.addChannelOption((option) =>
			option
				.setName("spawn-channel")
				.setDescription(
					"The voice channel that will spawn temporary channels when joined",
				)
				.setRequired(true)
				.addChannelTypes(ChannelType.GuildVoice),
		)
		.addChannelOption((option) =>
			option
				.setName("category")
				.setDescription("Category to create temporary channels in (optional)")
				.setRequired(false)
				.addChannelTypes(ChannelType.GuildCategory),
		)
		.addStringOption((option) =>
			option
				.setName("name-template")
				.setDescription(
					"Template for channel names (use {displayname} for display name)",
				)
				.setRequired(false),
		)
		.addIntegerOption((option) =>
			option
				.setName("max-channels")
				.setDescription("Maximum number of temporary channels allowed")
				.setRequired(false)
				.setMinValue(1)
				.setMaxValue(50),
		)
		.addIntegerOption((option) =>
			option
				.setName("channel-limit")
				.setDescription("Default user limit for temporary channels")
				.setRequired(false)
				.setMinValue(0)
				.setMaxValue(99),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

	async execute(interaction: ChatInputCommandInteraction) {
		const spawnChannel = interaction.options.getChannel("spawn-channel", true);
		const category = interaction.options.getChannel("category");
		const nameTemplate =
			interaction.options.getString("name-template") || "{displayname}'s Room";
		const maxChannels = interaction.options.getInteger("max-channels") || 10;
		const channelLimit = interaction.options.getInteger("channel-limit") || 10;

		try {
			const db = await getDatabase();
			const config = {
				guildId: interaction.guild?.id || "",
				spawnChannelId: spawnChannel.id,
				categoryId: category?.id,
				channelNameTemplate: nameTemplate,
				maxChannels,
				channelLimit,
			};

			await db
				.collection("guildConfigs")
				.replaceOne({ guildId: interaction.guild?.id || "" }, config, {
					upsert: true,
				});

			const embed = new EmbedBuilder()
				.setTitle("🔹 Voice Channel Setup Complete")
				.setDescription(
					"Voice channel spawning has been configured for this server!",
				)
				.addFields(
					{
						name: "Spawn Channel",
						value: `<#${spawnChannel.id}>`,
						inline: true,
					},
					{
						name: "Category",
						value: category ? `<#${category.id}>` : "None",
						inline: true,
					},
					{ name: "Name Template", value: nameTemplate, inline: true },
					{ name: "Max Channels", value: maxChannels.toString(), inline: true },
					{
						name: "Channel Limit",
						value: channelLimit === 0 ? "No limit" : channelLimit.toString(),
						inline: true,
					},
				)
				.setColor(0x00ff00)
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });
		} catch (error) {
			await interaction.reply({
				content: "🔸 Failed to setup voice channels. Please try again.",
				ephemeral: true,
			});
		}
	},
};
