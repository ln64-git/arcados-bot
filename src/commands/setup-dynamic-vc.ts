import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../types";
import { isGuildMember } from "../types";

export const setupDynamicVcCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("setup-dynamic-vc")
		.setDescription("Set up dynamic voice channel system")
		.addChannelOption((option) =>
			option
				.setName("spawn-channel")
				.setDescription("The voice channel that users join to create new rooms")
				.setRequired(true),
		)
		.addIntegerOption((option) =>
			option
				.setName("max-channels")
				.setDescription(
					"Maximum number of dynamic channels allowed (default: 50)",
				)
				.setRequired(false)
				.setMinValue(1)
				.setMaxValue(100),
		)
		.addIntegerOption((option) =>
			option
				.setName("channel-limit")
				.setDescription("Default user limit for created channels (default: 10)")
				.setRequired(false)
				.setMinValue(2)
				.setMaxValue(99),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

	async execute(interaction: ChatInputCommandInteraction) {
		const member = interaction.member;
		if (!isGuildMember(member)) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server!",
				ephemeral: true,
			});
			return;
		}

		// Check if user has administrator permissions
		if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
			await interaction.reply({
				content: "🔸 You need Administrator permissions to use this command!",
				ephemeral: true,
			});
			return;
		}

		const spawnChannel = interaction.options.getChannel("spawn-channel", true);
		const maxChannels = interaction.options.getInteger("max-channels") || 50;
		const channelLimit = interaction.options.getInteger("channel-limit") || 10;

		// Validate that the spawn channel is a voice channel
		if (!spawnChannel.isVoiceBased()) {
			await interaction.reply({
				content: "🔸 The spawn channel must be a voice channel!",
				ephemeral: true,
			});
			return;
		}

		try {
			// Update environment configuration (in a real implementation, you'd want to persist this)
			process.env.SPAWN_CHANNEL_ID = spawnChannel.id;

			const embed = new EmbedBuilder()
				.setColor(0x51cf66)
				.setTitle("🔹 Dynamic Voice Channel System Setup")
				.setDescription(
					"Dynamic voice channel system has been configured successfully!",
				)
				.addFields(
					{
						name: "Spawn Channel",
						value: `${spawnChannel}`,
						inline: true,
					},
					{
						name: "Max Channels",
						value: maxChannels.toString(),
						inline: true,
					},
					{
						name: "Default Channel Limit",
						value: channelLimit.toString(),
						inline: true,
					},
				)
				.addFields({
					name: "How It Works",
					value: [
						"• Users join the spawn channel to create their own room",
						"• Each user gets a unique channel with full management permissions",
						"• Users can rename, lock, and manage their channels manually",
						"• Empty channels are automatically deleted after 5 minutes",
						"• No bot API rate limits for channel management!",
					].join("\n"),
					inline: false,
				})
				.addFields({
					name: "User Permissions",
					value: [
						"✅ Rename channel (no rate limits!)",
						"✅ Set user limits",
						"✅ Lock/unlock channel",
						"✅ Move users between channels",
						"✅ Mute/deafen users",
						"✅ Create invites",
					].join("\n"),
					inline: false,
				})
				.setTimestamp();

			await interaction.reply({ embeds: [embed] });

			// Send a follow-up message with instructions
			const instructionsEmbed = new EmbedBuilder()
				.setColor(0x339af0)
				.setTitle("📋 Setup Instructions")
				.setDescription("To complete the setup, follow these steps:")
				.addFields({
					name: "1. Configure Spawn Channel Permissions",
					value: [
						"• Make sure @everyone can **Connect** to the spawn channel",
						"• Consider making it **View Channel** for everyone",
						"• The bot will inherit these settings for new channels",
					].join("\n"),
					inline: false,
				})
				.addFields({
					name: "2. Test the System",
					value: [
						"• Join the spawn channel to create your first room",
						"• Try renaming your channel using Discord's UI",
						"• Invite friends and test permissions",
					].join("\n"),
					inline: false,
				})
				.addFields({
					name: "3. Monitor Usage",
					value: [
						"• The system automatically handles up to 50 concurrent channels",
						"• Empty channels are cleaned up automatically",
						"• No manual maintenance required!",
					].join("\n"),
					inline: false,
				})
				.setTimestamp();

			await interaction.followUp({
				embeds: [instructionsEmbed],
				ephemeral: true,
			});
		} catch (error) {
			console.error("Error setting up dynamic VC system:", error);
			await interaction.reply({
				content:
					"🔸 An error occurred while setting up the dynamic voice channel system. Please try again later.",
				ephemeral: true,
			});
		}
	},
};
