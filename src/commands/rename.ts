import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import type { ClientWithVoiceManager, Command } from "../types";
import { isGuildMember } from "../types";

export const renameCommand: Command = {
	data: new SlashCommandBuilder()
		.setName("rename")
		.setDescription("Rename channel or users in your voice channel")
		.addStringOption((option) =>
			option
				.setName("type")
				.setDescription("What to rename")
				.setRequired(true)
				.addChoices(
					{ name: "Channel", value: "channel" },
					{ name: "User", value: "user" },
					{ name: "Reset User", value: "reset-user" },
					{ name: "Reset All Users", value: "reset-all" },
				),
		)
		.addStringOption((option) =>
			option
				.setName("name")
				.setDescription("New name (not required for reset options)")
				.setRequired(false)
				.setMaxLength(100),
		)
		.addUserOption((option) =>
			option
				.setName("target")
				.setDescription("User to rename (required for user operations)")
				.setRequired(false),
		),

	async execute(interaction: ChatInputCommandInteraction) {
		const type = interaction.options.getString("type", true);
		const newName = interaction.options.getString("name");
		const targetUser = interaction.options.getUser("target");

		const member = interaction.member;
		if (!isGuildMember(member)) {
			await interaction.reply({
				content: "🔸 This command can only be used in a server!",
				ephemeral: true,
			});
			return;
		}
		const channel = member.voice?.channel;

		if (!channel) {
			await interaction.reply({
				content: "🔸 You must be in a voice channel!",
				ephemeral: true,
			});
			return;
		}

		const voiceManager = (interaction.client as ClientWithVoiceManager)
			.voiceManager;
		if (!voiceManager) {
			await interaction.reply({
				content: "🔸 Voice manager not available!",
				ephemeral: true,
			});
			return;
		}

		const isOwner = await voiceManager.isChannelOwner(
			channel.id,
			interaction.user.id,
		);
		if (!isOwner) {
			await interaction.reply({
				content: "🔸 You must be the owner of this voice channel!",
				ephemeral: true,
			});
			return;
		}

		// Validate required parameters based on type
		if ((type === "user" || type === "reset-user") && !targetUser) {
			await interaction.reply({
				content: "🔸 You must specify a target user for user operations!",
				ephemeral: true,
			});
			return;
		}

		if ((type === "channel" || type === "user") && !newName) {
			await interaction.reply({
				content: "🔸 You must provide a new name for this operation!",
				ephemeral: true,
			});
			return;
		}

		// Check rate limit
		const canProceed = await voiceManager.checkRateLimit(
			interaction.user.id,
			"rename",
			5,
			60000,
		);

		if (!canProceed) {
			await interaction.reply({
				content:
					"🔸 You're using rename commands too quickly! Please wait a moment.",
				ephemeral: true,
			});
			return;
		}

		try {
			let embed: EmbedBuilder;

			switch (type) {
				case "channel": {
					if (!newName) {
						await interaction.reply({
							content: "🔸 New name is required for channel rename!",
							ephemeral: true,
						});
						return;
					}

					await channel.setName(newName);

					// Update user preferences to remember this channel name
					const preferences = (await voiceManager.getUserPreferences(
						interaction.user.id,
						interaction.guild?.id || "",
					)) || {
						userId: interaction.user.id,
						guildId: interaction.guild?.id || "",
						bannedUsers: [],
						mutedUsers: [],
						kickedUsers: [],
						deafenedUsers: [],
						renamedUsers: [],
						lastUpdated: new Date(),
					};

					preferences.preferredChannelName = newName;
					preferences.lastUpdated = new Date();
					await voiceManager.updateUserPreferences(preferences);

					await voiceManager.logModerationAction({
						action: "rename",
						channelId: channel.id,
						guildId: interaction.guild?.id || "",
						performerId: interaction.user.id,
						targetId: interaction.user.id,
						reason: `Changed channel name to: ${newName}`,
					});

					embed = new EmbedBuilder()
						.setTitle("🔹 Channel Name Changed")
						.setDescription(`Voice channel name changed to: **${newName}**`)
						.setColor(0x00ff00)
						.setTimestamp();
					break;
				}

				case "user": {
					if (!targetUser || !newName) {
						await interaction.reply({
							content:
								"🔸 Target user and new name are required for user rename!",
							ephemeral: true,
						});
						return;
					}

					// Check if target user is in the channel
					const targetMember = channel.members.get(targetUser.id);
					if (!targetMember) {
						await interaction.reply({
							content: "🔸 The target user must be in this voice channel!",
							ephemeral: true,
						});
						return;
					}

					const success = await voiceManager.renameUser(
						channel.id,
						targetUser.id,
						interaction.user.id,
						newName,
					);

					if (!success) {
						await interaction.reply({
							content:
								"🔸 Failed to rename the user. Make sure I have the necessary permissions.",
							ephemeral: true,
						});
						return;
					}

					embed = new EmbedBuilder()
						.setTitle("🔹 User Renamed")
						.setDescription(
							`<@${targetUser.id}> has been renamed to: **${newName}**`,
						)
						.setColor(0x00ff00)
						.setTimestamp();
					break;
				}

				case "reset-user": {
					if (!targetUser) {
						await interaction.reply({
							content: "🔸 Target user is required for reset operation!",
							ephemeral: true,
						});
						return;
					}

					const success = await voiceManager.resetUserNickname(
						channel.id,
						targetUser.id,
						interaction.user.id,
					);

					if (!success) {
						await interaction.reply({
							content:
								"🔸 Failed to reset the user's nickname. They may not have been renamed.",
							ephemeral: true,
						});
						return;
					}

					embed = new EmbedBuilder()
						.setTitle("🔹 User Nickname Reset")
						.setDescription(
							`<@${targetUser.id}>'s nickname has been reset to their original name`,
						)
						.setColor(0x00ff00)
						.setTimestamp();
					break;
				}

				case "reset-all": {
					const success = await voiceManager.resetAllNicknames(
						channel.id,
						interaction.user.id,
					);

					if (!success) {
						await interaction.reply({
							content:
								"🔸 Failed to reset nicknames. There may have been an error.",
							ephemeral: true,
						});
						return;
					}

					embed = new EmbedBuilder()
						.setTitle("🔹 All Nicknames Reset")
						.setDescription(
							"All user nicknames in this channel have been reset to their original names",
						)
						.setColor(0x00ff00)
						.setTimestamp();
					break;
				}

				default:
					await interaction.reply({
						content: "🔸 Invalid rename type specified!",
						ephemeral: true,
					});
					return;
			}

			await interaction.reply({ embeds: [embed] });
		} catch (error) {
			console.error("Error in rename command:", error);
			await interaction.reply({
				content:
					"🔸 An error occurred while processing the rename command. Please try again later.",
				ephemeral: true,
			});
		}
	},
};
