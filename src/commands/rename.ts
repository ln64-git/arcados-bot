import {
	ChannelType,
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
	type VoiceChannel,
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

		// Check rate limit - Discord allows exactly 2 channel renames before rate limiting
		const rateLimitType = type === "channel" ? "channel-rename" : "rename";
		const maxActions = type === "channel" ? 2 : 5; // Discord allows 2 channel renames before blocking
		const timeWindow = type === "channel" ? 300000 : 60000; // 5 minutes for channel renames (conservative)

		const canProceed = await voiceManager.checkRateLimit(
			interaction.user.id,
			rateLimitType,
			maxActions,
			timeWindow,
		);

		if (!canProceed) {
			await interaction.reply({
				content:
					"🔸 You're using rename commands too quickly! Please wait a moment before trying again.",
				ephemeral: true,
			});
			return;
		}

		// Defer the interaction to prevent timeout
		await interaction.deferReply();

		try {
			let embed: EmbedBuilder;

			switch (type) {
				case "channel": {
					if (!newName) {
						await interaction.editReply({
							content: "🔸 New name is required for channel rename!",
						});
						return;
					}

					// Comprehensive debugging for channel rename
					console.log(
						`🔍 Starting channel rename diagnostic for channel ${channel.id}`,
					);
					console.log(
						`🔍 Channel info: name="${channel.name}", type=${channel.type}, position=${channel.position}`,
					);
					console.log(
						`🔍 Guild info: name="${channel.guild.name}", id=${channel.guild.id}`,
					);
					console.log(`🔍 Bot permissions: ${interaction.client.user.tag}`);

					// Check bot permissions
					const botMember = await channel.guild.members.fetch(
						interaction.client.user.id,
					);
					const permissions = botMember.permissionsIn(channel);
					console.log(
						`🔍 Bot permissions in channel: ManageChannels=${permissions.has("ManageChannels")}, Administrator=${permissions.has("Administrator")}`,
					);

					// Check channel permission overwrites
					console.log(
						`🔍 Channel permission overwrites: ${channel.permissionOverwrites.cache.size} entries`,
					);

					// Check memory usage
					const memUsage = process.memoryUsage();
					console.log(
						`🔍 Memory usage: RSS=${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap=${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
					);

					// Check Discord client status
					console.log(
						`🔍 Discord client status: ready=${interaction.client.isReady()}, ping=${interaction.client.ws.ping}ms`,
					);

					// Additional diagnostics before rename attempt
					console.log(`🔍 Pre-rename diagnostics:`);
					console.log(`🔍 - Channel name: "${channel.name}"`);
					console.log(`🔍 - Target name: "${newName}"`);
					console.log(`🔍 - Channel type: ${channel.type}`);
					console.log(`🔍 - Channel position: ${channel.position}`);
					console.log(`🔍 - Guild member count: ${channel.guild.memberCount}`);
					console.log(`🔍 - Channel member count: ${channel.members.size}`);

					// Implement retry mechanism with exponential backoff
					// Note: Discord allows only 2 renames before rate limiting, so be conservative
					let renameSuccess = false;
					let lastError: Error | null = null;
					const maxRetries = 2; // Reduced from 3 since Discord blocks after 2 attempts
					const baseDelay = 5000; // 5 seconds base delay (increased for safety)

					for (let attempt = 1; attempt <= maxRetries; attempt++) {
						console.log(`🔍 Rename attempt ${attempt}/${maxRetries}`);

						// Add exponential backoff delay (except for first attempt)
						if (attempt > 1) {
							const delay = baseDelay * 2 ** (attempt - 2); // 5s, 10s delays
							console.log(`🔍 Waiting ${delay}ms before retry...`);
							await new Promise((resolve) => setTimeout(resolve, delay));
						}

						try {
							// Try REST API first
							console.log(`🔍 Attempting REST API rename...`);
							const restStart = Date.now();
							const restPromise = interaction.client.rest.patch(
								`/channels/${channel.id}`,
								{
									body: { name: newName },
								},
							);
							const restTimeoutPromise = new Promise((_, reject) =>
								setTimeout(
									() => reject(new Error("REST API rename timeout")),
									10000, // 10 second timeout for REST API
								),
							);
							await Promise.race([restPromise, restTimeoutPromise]);
							const restDuration = Date.now() - restStart;
							console.log(`✅ REST API rename succeeded in ${restDuration}ms`);
							renameSuccess = true;
							break;
						} catch (error) {
							console.log(
								`❌ REST API rename failed: ${error instanceof Error ? error.message : String(error)}`,
							);
							lastError =
								error instanceof Error ? error : new Error(String(error));

							// Try discord.js fallback
							console.log(`🔍 Attempting discord.js fallback...`);
							const discordjsStart = Date.now();
							try {
								const renamePromise = channel.setName(newName);
								const timeoutPromise = new Promise((_, reject) =>
									setTimeout(
										() => reject(new Error("Channel rename timeout")),
										8000, // 8 second timeout for discord.js fallback
									),
								);
								await Promise.race([renamePromise, timeoutPromise]);
								const discordjsDuration = Date.now() - discordjsStart;
								console.log(
									`✅ discord.js rename succeeded in ${discordjsDuration}ms`,
								);
								renameSuccess = true;
								break;
							} catch (fallbackError) {
								const discordjsDuration = Date.now() - discordjsStart;
								console.log(
									`❌ discord.js fallback failed after ${discordjsDuration}ms: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
								);
								lastError =
									fallbackError instanceof Error
										? fallbackError
										: new Error(String(fallbackError));
							}
						}
					}

					// If all attempts failed, check if rename actually succeeded
					if (!renameSuccess) {
						console.log(
							`🔍 All ${maxRetries} attempts failed, checking if rename succeeded...`,
						);
						try {
							const updatedChannel = await interaction.client.channels.fetch(
								channel.id,
							);
							if (
								updatedChannel?.isVoiceBased() &&
								updatedChannel.type === ChannelType.GuildVoice
							) {
								const voiceChannel = updatedChannel as VoiceChannel;
								if (voiceChannel.name === newName) {
									console.log(
										`✅ Rename actually succeeded! Channel name is now: "${voiceChannel.name}"`,
									);
									renameSuccess = true;
								} else {
									console.log(
										`❌ Rename failed - channel name is still: "${voiceChannel.name}"`,
									);
								}
							}
						} catch (fetchError) {
							console.log(
								`❌ Could not verify rename status: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
							);
						}
					}

					if (!renameSuccess) {
						throw new Error(
							`Channel rename failed after ${maxRetries} attempts. Last error: ${lastError?.message || "Unknown error"}`,
						);
					}

					// Update user preferences to remember this channel name
					console.log(`🔍 Starting database operations...`);
					const dbStart = Date.now();

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

					const updateStart = Date.now();
					await voiceManager.updateUserPreferences(preferences);
					const updateDuration = Date.now() - updateStart;
					console.log(`🔍 User preferences update took ${updateDuration}ms`);

					const logStart = Date.now();
					await voiceManager.logModerationAction({
						action: "rename",
						channelId: channel.id,
						guildId: interaction.guild?.id || "",
						performerId: interaction.user.id,
						targetId: interaction.user.id,
						reason: `Changed channel name to: ${newName}`,
					});
					const logDuration = Date.now() - logStart;
					console.log(`🔍 Moderation logging took ${logDuration}ms`);

					const dbDuration = Date.now() - dbStart;
					console.log(`🔍 Total database operations took ${dbDuration}ms`);

					embed = new EmbedBuilder()
						.setTitle("🔹 Channel Name Changed")
						.setDescription(`Voice channel name changed to: **${newName}**`)
						.setColor(0x00ff00)
						.setTimestamp();
					break;
				}

				case "user": {
					if (!targetUser || !newName) {
						await interaction.editReply({
							content:
								"🔸 Target user and new name are required for user rename!",
						});
						return;
					}

					// Check if target user is in the channel
					const targetMember = channel.members.get(targetUser.id);
					if (!targetMember) {
						await interaction.editReply({
							content: "🔸 The target user must be in this voice channel!",
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
						await interaction.editReply({
							content:
								"🔸 Failed to rename the user. Make sure I have the necessary permissions.",
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
						await interaction.editReply({
							content: "🔸 Target user is required for reset operation!",
						});
						return;
					}

					const success = await voiceManager.resetUserNickname(
						channel.id,
						targetUser.id,
						interaction.user.id,
					);

					if (!success) {
						await interaction.editReply({
							content:
								"🔸 Failed to reset the user's nickname. They may not have been renamed.",
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
						await interaction.editReply({
							content:
								"🔸 Failed to reset nicknames. There may have been an error.",
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
					await interaction.editReply({
						content: "🔸 Invalid rename type specified!",
					});
					return;
			}

			await interaction.editReply({ embeds: [embed] });
		} catch (error) {
			console.error("🔸 Error in rename command:", error);
			try {
				await interaction.editReply({
					content:
						"🔸 An error occurred while processing the rename command. Please try again later.",
				});
			} catch (replyError) {
				console.error("🔸 Failed to send error response:", replyError);
			}
		}
	},
};
