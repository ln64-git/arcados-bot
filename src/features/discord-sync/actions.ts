import type {
	Channel,
	Client,
	Guild,
	GuildMember,
	TextChannel,
} from "discord.js";
import { ChannelType } from "discord.js";
import type { SurrealDBManager } from "../../database/SurrealDBManager";
import type {
	ActionPayload,
	ActionType,
	SurrealAction,
} from "../../database/schema";

export class DatabaseActions {
	private client: Client;
	private db: SurrealDBManager;
	private actionHandlers: Map<
		ActionType,
		(payload: Record<string, unknown>) => Promise<void>
	> = new Map();
	private isProcessing = false;
	private processedActions = new Set<string>(); // Track processed actions to prevent duplicates
	private processingPromise: Promise<void> | null = null; // Track the current processing promise

	constructor(client: Client, db: SurrealDBManager) {
		this.client = client;
		this.db = db;
		this.setupActionHandlers();
	}

	// Method to trigger immediate action processing
	async triggerActionProcessing(): Promise<void> {
		// If already processing, wait for the current processing to complete
		if (this.processingPromise) {
			console.log(
				"🔹 [ACTION_PROCESSOR] Already processing, waiting for completion",
			);
			await this.processingPromise;
			return;
		}

		console.log("🔹 [ACTION_PROCESSOR] Manual action processing triggered");
		// Start processing and store the promise
		this.processingPromise = this.processPendingActions();
		await this.processingPromise;
		this.processingPromise = null;
	}

	private setupActionHandlers(): void {
		// Member role update action
		this.actionHandlers.set(
			"member_role_update",
			async (payload: Record<string, unknown>) => {
				const rolePayload = payload as ActionPayload["member_role_update"];
				if (!rolePayload) return;

				try {
					const guild = await this.client.guilds.fetch(rolePayload.guild_id);
					const member = await guild.members.fetch(rolePayload.user_id);

					// Get current roles and new roles
					const currentRoles = member.roles.cache.map((role) => role.id);
					const newRoles = rolePayload.role_ids;

					// Find roles to add and remove
					const rolesToAdd = newRoles.filter(
						(roleId) => !currentRoles.includes(roleId),
					);
					const rolesToRemove = currentRoles.filter(
						(roleId) => !newRoles.includes(roleId) && roleId !== guild.id,
					); // Don't remove @everyone role

					// Apply role changes
					if (rolesToAdd.length > 0) {
						await member.roles.add(rolesToAdd);
						console.log(
							`🔹 Added roles to ${member.displayName}: ${rolesToAdd.join(", ")}`,
						);
					}

					if (rolesToRemove.length > 0) {
						await member.roles.remove(rolesToRemove);
						console.log(
							`🔹 Removed roles from ${member.displayName}: ${rolesToRemove.join(", ")}`,
						);
					}
				} catch (error) {
					console.error("🔸 Failed to update member roles:", error);
				}
			},
		);

		// Member ban action
		this.actionHandlers.set(
			"member_ban",
			async (payload: Record<string, unknown>) => {
				const banPayload = payload as ActionPayload["member_ban"];
				if (!banPayload) return;

				try {
					const guild = await this.client.guilds.fetch(banPayload.guild_id);
					const member = await guild.members.fetch(banPayload.user_id);

					await member.ban({
						reason: banPayload.reason || "Database-triggered ban",
					});
					console.log(
						`🔹 Banned member ${member.displayName} from guild ${guild.name}`,
					);
				} catch (error) {
					console.error("🔸 Failed to ban member:", error);
				}
			},
		);

		// Scheduled message action
		this.actionHandlers.set(
			"scheduled_message",
			async (payload: Record<string, unknown>) => {
				const messagePayload = payload as ActionPayload["scheduled_message"];
				if (!messagePayload) return;

				try {
					const channel = (await this.client.channels.fetch(
						messagePayload.channel_id,
					)) as TextChannel;

					const messageOptions: {
						content: string;
						embeds?: Record<string, unknown>[];
					} = {
						content: messagePayload.content,
					};

					if (messagePayload.embeds && messagePayload.embeds.length > 0) {
						messageOptions.embeds = messagePayload.embeds as Record<
							string,
							unknown
						>[];
					}

					await channel.send(messageOptions);
					console.log(`🔹 Sent scheduled message to channel ${channel.name}`);
				} catch (error) {
					console.error("🔸 Failed to send scheduled message:", error);
				}
			},
		);

		// Member count milestone action
		this.actionHandlers.set(
			"member_count_milestone",
			async (payload: Record<string, unknown>) => {
				const milestonePayload =
					payload as ActionPayload["member_count_milestone"];
				if (!milestonePayload) return;

				try {
					const guild = await this.client.guilds.fetch(
						milestonePayload.guild_id,
					);
					const channelId =
						milestonePayload.channel_id || guild.systemChannelId;

					if (!channelId) {
						console.log(
							`🔸 No channel specified for milestone announcement in guild ${guild.name}`,
						);
						return;
					}

					const channel = (await this.client.channels.fetch(
						channelId,
					)) as TextChannel;

					const milestoneMessage = `🎉 **Milestone Reached!** 🎉

We've reached **${milestonePayload.milestone}** members! Thank you to everyone who's part of our amazing community! 🚀`;

					await channel.send(milestoneMessage);
					console.log(
						`🔹 Sent milestone message for ${milestonePayload.milestone} members in guild ${guild.name}`,
					);
				} catch (error) {
					console.error("🔸 Failed to send milestone message:", error);
				}
			},
		);

		// User XP threshold action
		this.actionHandlers.set(
			"user_xp_threshold",
			async (payload: Record<string, unknown>) => {
				const xpPayload = payload as ActionPayload["user_xp_threshold"];
				if (!xpPayload) return;

				try {
					const guild = await this.client.guilds.fetch(xpPayload.guild_id);
					const member = await guild.members.fetch(xpPayload.user_id);
					const role = await guild.roles.fetch(xpPayload.role_id);

					if (!role) {
						console.error(
							`🔸 Role ${xpPayload.role_id} not found in guild ${guild.name}`,
						);
						return;
					}

					await member.roles.add(role);
					console.log(
						`🔹 Added achievement role ${role.name} to ${member.displayName} for reaching ${xpPayload.threshold} XP`,
					);
				} catch (error) {
					console.error("🔸 Failed to add achievement role:", error);
				}
			},
		);

		// Global ban update action
		this.actionHandlers.set(
			"global_ban_update",
			async (payload: Record<string, unknown>) => {
				const globalBanPayload = payload as ActionPayload["global_ban_update"];
				if (!globalBanPayload) return;

				try {
					for (const guildId of globalBanPayload.guild_ids) {
						const guild = await this.client.guilds.fetch(guildId);
						const member = await guild.members.fetch(globalBanPayload.user_id);

						await member.ban({
							reason:
								globalBanPayload.reason || "Global ban - Database triggered",
						});
						console.log(
							`🔹 Applied global ban to ${member.displayName} in guild ${guild.name}`,
						);
					}
				} catch (error) {
					console.error("🔸 Failed to apply global ban:", error);
				}
			},
		);

		// Voice channel create action
		this.actionHandlers.set(
			"voice_channel_create",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					const {
						guild_id,
						user_id,
						spawn_channel_id,
						channel_name,
						user_limit,
						parent_id,
						position,
					} = payload as {
						guild_id: string;
						user_id: string;
						spawn_channel_id: string;
						channel_name: string;
						user_limit?: number;
						parent_id?: string;
						position?: number;
					};

					if (!guild_id || !user_id || !spawn_channel_id || !channel_name) {
						console.error("🔸 Invalid voice_channel_create payload:", payload);
						return;
					}

					console.log(
						`🔹 Creating voice channel '${channel_name}' for user ${user_id} (will be positioned above spawn channel)`,
					);

					// Get the guild and spawn channel (try cache first for speed)
					const guild =
						this.client.guilds.cache.get(guild_id) ||
						(await this.client.guilds.fetch(guild_id));
					if (!guild) {
						console.error(`🔸 Guild ${guild_id} not found`);
						return;
					}

					const spawnChannel =
						guild.channels.cache.get(spawn_channel_id) ||
						(await guild.channels.fetch(spawn_channel_id));
					if (!spawnChannel?.isVoiceBased()) {
						console.error(
							`🔸 Spawn channel ${spawn_channel_id} not found or not voice`,
						);
						return;
					}

					// Create the voice channel
					const newChannel = await guild.channels.create({
						name: channel_name,
						type: ChannelType.GuildVoice,
						parent: parent_id || spawnChannel.parent,
						position: position || spawnChannel.position,
						userLimit: user_limit || 0,
					});

					// Position the new channel directly above the spawn channel
					await newChannel.setPosition(spawnChannel.position - 1);

					// Move user into their new channel (only if they're still in the spawn channel)
					const member = guild.members.cache.get(user_id);
					if (member?.voice.channelId === spawn_channel_id) {
						await member.voice.setChannel(newChannel);
					}

					// Mark the channel as a user channel directly in the database (no follow-up action needed)
					await this.db.query(
						"UPSERT channels SET id = $channel_id, discordId = $channel_id, guild_id = $guild_id, guildId = $guild_id, name = $name, type = 2, position = 0, is_user_channel = true, spawn_channel_id = $spawn_id, current_owner_id = $owner_id, ownership_changed_at = $timestamp, createdAt = $timestamp, updatedAt = $timestamp, active = true, activeUserIds = [], nsfw = false",
						{
							channel_id: `channels:${newChannel.id}`,
							guild_id: guild_id,
							name: channel_name,
							spawn_id: spawn_channel_id,
							owner_id: user_id,
							timestamp: new Date(),
						},
					);

					console.log(
						`🔹 Created channel '${channel_name}' for user ${user_id} (Discord channel ID: ${newChannel.id})`,
					);
				} catch (error) {
					console.error("🔸 Failed to execute voice_channel_create:", error);
				}
			},
		);

		// Voice channel rename action
		this.actionHandlers.set(
			"voice_channel_rename",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					const { channel_id, guild_id, new_name } = payload as {
						channel_id: string;
						guild_id: string;
						new_name: string;
					};

					if (!channel_id || !guild_id || !new_name) {
						console.error("🔸 Invalid voice_channel_rename payload:", payload);
						return;
					}

					console.log(`🔹 Renaming channel ${channel_id} to '${new_name}'`);

					// Get the guild and channel
					const guild = await this.client.guilds.fetch(guild_id);
					if (!guild) {
						console.error(`🔸 Guild ${guild_id} not found`);
						return;
					}

					const channel = await guild.channels.fetch(channel_id);
					if (!channel?.isVoiceBased()) {
						console.error(`🔸 Channel ${channel_id} not found or not voice`);
						return;
					}

					// Rename the channel
					await channel.setName(new_name);

					console.log(
						`🔹 Successfully renamed channel ${channel_id} to '${new_name}'`,
					);
				} catch (error) {
					console.error("🔸 Failed to execute voice_channel_rename:", error);
				}
			},
		);

		// Voice channel delete action
		this.actionHandlers.set(
			"voice_channel_delete",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					const { channel_id, guild_id, reason } = payload as {
						channel_id: string;
						guild_id: string;
						reason?: string;
					};

					if (!channel_id || !guild_id) {
						console.error("🔸 Invalid voice_channel_delete payload:", payload);
						return;
					}

					console.log(
						`🔹 Deleting channel ${channel_id}${reason ? ` (${reason})` : ""}`,
					);

					// Get the guild and channel
					const guild = await this.client.guilds.fetch(guild_id);
					if (!guild) {
						console.error(`🔸 Guild ${guild_id} not found`);
						return;
					}

					let channel: Channel | null;
					try {
						channel = await guild.channels.fetch(channel_id);
					} catch (error) {
						console.log(
							`🔹 Channel ${channel_id} not found or already deleted, marking as inactive in database`,
						);
						// Channel doesn't exist in Discord, just mark it as inactive in database
						await this.db.query(
							"UPDATE channels SET active = false WHERE id = $channel_id",
							{ channel_id: `channels:${channel_id}` },
						);
						return;
					}

					if (!channel?.isVoiceBased()) {
						console.error(`🔸 Channel ${channel_id} not found or not voice`);
						return;
					}

					// Delete the channel
					await channel.delete(reason || "Deleted via action");

					// Create a follow-up action to mark the channel as inactive in the database
					await this.db.createAction({
						guild_id: guild_id,
						type: "voice_channel_update",
						payload: {
							channel_id: channel_id,
							guild_id: guild_id,
							update_type: "delete_channel",
						},
					});

					console.log(`🔹 Successfully deleted channel ${channel_id}`);
				} catch (error) {
					console.error("🔸 Failed to execute voice_channel_delete:", error);
				}
			},
		);

		// Voice channel update action
		this.actionHandlers.set(
			"voice_channel_update",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					const {
						channel_id,
						guild_id,
						update_type,
						owner_id,
						spawn_channel_id,
						ownership_changed_at,
					} = payload;

					if (!channel_id || !guild_id || !update_type) {
						console.error("🔸 Invalid voice_channel_update payload:", payload);
						return;
					}

					console.log(
						`🔹 Processing voice channel update: ${update_type} for channel ${channel_id}`,
					);

					switch (update_type) {
						case "mark_user_channel": {
							// First try to update, if channel doesn't exist, create it
							const updateResult = await this.db.query(
								"UPDATE channels SET is_user_channel = true, spawn_channel_id = $spawn_id, current_owner_id = $owner_id, ownership_changed_at = $timestamp WHERE id = $channel_id",
								{
									spawn_id: spawn_channel_id,
									owner_id: owner_id,
									timestamp: ownership_changed_at || new Date(),
									channel_id: `channels:${channel_id}`,
								},
							);

							// If no rows were updated, create the channel record
							// SurrealDB UPDATE returns empty array when no rows match
							if (
								!updateResult ||
								updateResult.length === 0 ||
								(updateResult[0] as unknown[]).length === 0
							) {
								console.log(
									`🔹 Channel ${channel_id} not found in database, creating record...`,
								);
								await this.db.query(
									"UPSERT channels SET id = $channel_id, discordId = $channel_id, guild_id = $guild_id, guildId = $guild_id, name = $name, type = 2, position = 0, is_user_channel = true, spawn_channel_id = $spawn_id, current_owner_id = $owner_id, ownership_changed_at = $timestamp, createdAt = $timestamp, updatedAt = $timestamp, active = true, activeUserIds = [], nsfw = false",
									{
										channel_id: `channels:${channel_id}`,
										guild_id: guild_id,
										name: `Channel ${channel_id}`,
										spawn_id: spawn_channel_id,
										owner_id: owner_id,
										timestamp: ownership_changed_at
											? new Date(ownership_changed_at as string | number | Date)
											: new Date(),
									},
								);
								console.log(`🔹 Created channel record for ${channel_id}`);
							} else {
								console.log(
									`🔹 Updated existing channel record for ${channel_id}`,
								);
							}
							console.log(`🔹 Marked channel ${channel_id} as user channel`);
							break;
						}

						case "transfer_ownership": {
							await this.db.query(
								"UPDATE channels SET current_owner_id = $owner_id, ownership_changed_at = $timestamp WHERE id = $channel_id",
								{
									owner_id: owner_id,
									timestamp: ownership_changed_at || new Date(),
									channel_id: `channels:${channel_id}`,
								},
							);
							console.log(
								`🔹 Transferred ownership of channel ${channel_id} to ${owner_id}`,
							);
							break;
						}

						case "delete_channel": {
							await this.db.query(
								"UPDATE channels SET active = false WHERE id = $channel_id",
								{ channel_id: `channels:${channel_id}` },
							);
							console.log(`🔹 Marked channel ${channel_id} as inactive`);
							break;
						}

						default:
							console.error(
								`🔸 Unknown voice channel update type: ${update_type}`,
							);
					}
				} catch (error) {
					console.error("🔸 Failed to execute voice_channel_update:", error);
				}
			},
		);

		// Voice user join action
		this.actionHandlers.set(
			"voice_user_join",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					const { user_id, guild_id, channel_id, channel_owner_id } =
						payload as {
							user_id: string;
							guild_id: string;
							channel_id: string;
							channel_owner_id?: string;
						};

					if (!user_id || !guild_id || !channel_id) {
						console.error("🔸 Invalid voice_user_join payload:", payload);
						return;
					}

					console.log(
						`🔹 Processing voice user join: user ${user_id} to channel ${channel_id}`,
					);

					// Get the guild and member
					const guild = this.client.guilds.cache.get(guild_id as string);
					if (!guild) {
						console.error(`🔸 Guild ${guild_id} not found`);
						return;
					}

					const member = guild.members.cache.get(user_id as string);
					if (!member) {
						console.error(`🔸 Member ${user_id} not found`);
						return;
					}

					// Check if user is banned (if channel has owner)
					if (channel_owner_id) {
						const banResult = await this.db.query(
							"SELECT channel_preferences FROM members WHERE user_id = $owner_id AND guild_id = $guild_id",
							{ owner_id: channel_owner_id, guild_id: guild_id },
						);

						const ownerData =
							((banResult[0] as Record<string, unknown>)?.[0] as Record<
								string,
								unknown
							>) || {};
						const preferences =
							(ownerData.channel_preferences as Record<string, unknown>) || {};
						const bannedUsers = (preferences.banned_users as string[]) || [];

						if (bannedUsers.includes(user_id as string)) {
							console.log(
								`🔹 User ${user_id} is banned from channel ${channel_id}, disconnecting`,
							);
							await member.voice.disconnect("You are banned from this channel");
							return;
						}
					}

					// Apply moderation if channel has owner
					if (channel_owner_id) {
						const preferencesResult = await this.db.query(
							"SELECT channel_preferences FROM members WHERE user_id = $owner_id AND guild_id = $guild_id",
							{ owner_id: channel_owner_id, guild_id: guild_id },
						);

						const ownerData =
							((preferencesResult[0] as Record<string, unknown>)?.[0] as Record<
								string,
								unknown
							>) || {};
						const preferences =
							(ownerData.channel_preferences as Record<string, unknown>) || {};
						const mutedUsers = (preferences.muted_users as string[]) || [];
						const deafenedUsers =
							(preferences.deafened_users as string[]) || [];

						// Apply mute if user is in muted list
						if (mutedUsers.includes(user_id as string)) {
							await member.voice.setMute(true);
							console.log(
								`🔹 Applied mute to user ${user_id} in channel ${channel_id}`,
							);
						}

						// Apply deafen if user is in deafened list
						if (deafenedUsers.includes(user_id as string)) {
							await member.voice.setDeaf(true);
							console.log(
								`🔹 Applied deafen to user ${user_id} in channel ${channel_id}`,
							);
						}
					}

					console.log(`🔹 Processed voice user join for user ${user_id}`);
				} catch (error) {
					console.error("🔸 Failed to execute voice_user_join:", error);
				}
			},
		);

		// Voice user leave action
		this.actionHandlers.set(
			"voice_user_leave",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					const { user_id, guild_id, channel_id, was_owner } = payload as {
						user_id: string;
						guild_id: string;
						channel_id: string;
						was_owner: boolean;
					};

					if (!user_id || !guild_id || !channel_id) {
						console.error("🔸 Invalid voice_user_leave payload:", payload);
						return;
					}

					console.log(
						`🔹 [VOICE_USER_LEAVE] Processing user leave: user ${user_id} from channel ${channel_id} (was_owner: ${was_owner})`,
					);

					// Always check if channel is empty after any user leaves
					// First check Discord directly for the most accurate count
					const guild = await this.client.guilds.fetch(guild_id);
					if (!guild) {
						console.log(`🔸 [VOICE_USER_LEAVE] Guild ${guild_id} not found`);
						return;
					}

					let channel: Channel | null;
					try {
						channel = await guild.channels.fetch(channel_id);
					} catch (error) {
						console.log(
							`🔸 [VOICE_USER_LEAVE] Channel ${channel_id} not found or already deleted:`,
							error instanceof Error ? error.message : error,
						);
						return;
					}

					if (!channel?.isVoiceBased()) {
						console.log(
							`🔸 [VOICE_USER_LEAVE] Channel ${channel_id} is not a voice channel`,
						);
						return;
					}

					// Check if channel is empty by looking at Discord member count
					const memberCount = channel.members.size;
					console.log(
						`🔹 [VOICE_USER_LEAVE] Channel ${channel_id} has ${memberCount} members`,
					);

					if (memberCount === 0) {
						console.log(
							`🔹 [VOICE_USER_LEAVE] Channel ${channel_id} is empty, checking if it's a user channel...`,
						);

						// Get spawn channel ID from config to avoid deleting it
						const spawnChannelId = process.env.SPAWN_CHANNEL_ID;

						// Never delete the spawn channel
						if (channel_id === spawnChannelId) {
							console.log(
								`🔹 [VOICE_USER_LEAVE] Channel ${channel_id} is the spawn channel, skipping deletion`,
							);
							return;
						}

						// Check if this is a user channel by name pattern
						const channelName = channel.name;
						const isUserChannel = channelName.includes("'s Channel");

						if (isUserChannel) {
							console.log(
								`🔹 [VOICE_USER_LEAVE] Channel ${channel_id} (${channelName}) is empty user channel, deleting immediately`,
							);

							try {
								// Delete the channel immediately
								await channel.delete("User channel empty after user left");
								console.log(
									`🔹 [VOICE_USER_LEAVE] Successfully deleted channel ${channel_id}`,
								);

								// Mark channel as inactive in database
								await this.db.query(
									"UPDATE channels SET active = false WHERE discordId = $channel_id OR id = $channel_id",
									{ channel_id: `channels:${channel_id}` },
								);
								console.log(
									`🔹 [VOICE_USER_LEAVE] Marked channel ${channel_id} as inactive`,
								);
							} catch (error) {
								console.error(
									`🔸 [VOICE_USER_LEAVE] Failed to delete channel ${channel_id}:`,
									error,
								);

								// Fallback: mark as inactive in database
								await this.db.query(
									"UPDATE channels SET active = false WHERE discordId = $channel_id OR id = $channel_id",
									{ channel_id: `channels:${channel_id}` },
								);
								console.log(
									`🔹 [VOICE_USER_LEAVE] Marked channel ${channel_id} as inactive (fallback)`,
								);
							}
						} else {
							console.log(
								`🔹 [VOICE_USER_LEAVE] Channel ${channel_id} (${channelName}) is not a user channel, skipping deletion`,
							);
						}
					} else if (was_owner) {
						// Only transfer ownership if the user was the owner and channel is not empty
						// Transfer ownership to longest resident
						const sessionsResult =
							await this.db.getActiveVoiceSessionsByChannel(
								channel_id as string,
							);
						if (sessionsResult.success) {
							const sessions = sessionsResult.data || [];
							const sortedSessions = sessions.sort(
								(a, b) =>
									new Date(a.joined_at).getTime() -
									new Date(b.joined_at).getTime(),
							);
							const newOwner = sortedSessions[0];
							if (newOwner) {
								console.log(`🔹 Transferring ownership to ${newOwner.user_id}`);
								await this.db.createAction({
									guild_id: guild_id as string,
									type: "voice_channel_update",
									payload: {
										channel_id: channel_id as string,
										guild_id: guild_id as string,
										update_type: "transfer_ownership",
										owner_id: newOwner.user_id,
										ownership_changed_at: new Date(),
									},
								});
							}
						}
					}

					console.log(`🔹 Processed voice user leave for user ${user_id}`);
				} catch (error) {
					console.error("🔸 Failed to execute voice_user_leave:", error);
				}
			},
		);

		// Voice moderation mute action
		this.actionHandlers.set(
			"voice_moderation_mute",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					const { user_id, guild_id, channel_id, owner_id } = payload as {
						user_id: string;
						guild_id: string;
						channel_id: string;
						owner_id: string;
					};

					if (!user_id || !guild_id || !channel_id || !owner_id) {
						console.error("🔸 Invalid voice_moderation_mute payload:", payload);
						return;
					}

					console.log(
						`🔹 Processing voice moderation mute: user ${user_id} in channel ${channel_id}`,
					);

					// Get the guild and member
					const guild = this.client.guilds.cache.get(guild_id);
					if (!guild) {
						console.error(`🔸 Guild ${guild_id} not found`);
						return;
					}

					const member = guild.members.cache.get(user_id);
					if (!member) {
						console.error(`🔸 Member ${user_id} not found`);
						return;
					}

					// Apply mute
					await member.voice.setMute(true);
					console.log(
						`🔹 Applied mute to user ${user_id} in channel ${channel_id}`,
					);
				} catch (error) {
					console.error("🔸 Failed to execute voice_moderation_mute:", error);
				}
			},
		);

		// Voice moderation deafen action
		this.actionHandlers.set(
			"voice_moderation_deafen",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					const { user_id, guild_id, channel_id, owner_id } = payload as {
						user_id: string;
						guild_id: string;
						channel_id: string;
						owner_id: string;
					};

					if (!user_id || !guild_id || !channel_id || !owner_id) {
						console.error(
							"🔸 Invalid voice_moderation_deafen payload:",
							payload,
						);
						return;
					}

					console.log(
						`🔹 Processing voice moderation deafen: user ${user_id} in channel ${channel_id}`,
					);

					// Get the guild and member
					const guild = this.client.guilds.cache.get(guild_id);
					if (!guild) {
						console.error(`🔸 Guild ${guild_id} not found`);
						return;
					}

					const member = guild.members.cache.get(user_id);
					if (!member) {
						console.error(`🔸 Member ${user_id} not found`);
						return;
					}

					// Apply deafen
					await member.voice.setDeaf(true);
					console.log(
						`🔹 Applied deafen to user ${user_id} in channel ${channel_id}`,
					);
				} catch (error) {
					console.error("🔸 Failed to execute voice_moderation_deafen:", error);
				}
			},
		);

		// Voice moderation unmute action
		this.actionHandlers.set(
			"voice_moderation_unmute",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					const { user_id, guild_id, channel_id } = payload as {
						user_id: string;
						guild_id: string;
						channel_id: string;
					};

					if (!user_id || !guild_id || !channel_id) {
						console.error(
							"🔸 Invalid voice_moderation_unmute payload:",
							payload,
						);
						return;
					}

					console.log(
						`🔹 Processing voice moderation unmute: user ${user_id} in channel ${channel_id}`,
					);

					// Get the guild and member
					const guild = this.client.guilds.cache.get(guild_id);
					if (!guild) {
						console.error(`🔸 Guild ${guild_id} not found`);
						return;
					}

					const member = guild.members.cache.get(user_id);
					if (!member) {
						console.error(`🔸 Member ${user_id} not found`);
						return;
					}

					// Remove mute
					await member.voice.setMute(false);
					console.log(
						`🔹 Removed mute from user ${user_id} in channel ${channel_id}`,
					);
				} catch (error) {
					console.error("🔸 Failed to execute voice_moderation_unmute:", error);
				}
			},
		);

		// Voice moderation undeafen action
		this.actionHandlers.set(
			"voice_moderation_undeafen",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					const { user_id, guild_id, channel_id } = payload as {
						user_id: string;
						guild_id: string;
						channel_id: string;
					};

					if (!user_id || !guild_id || !channel_id) {
						console.error(
							"🔸 Invalid voice_moderation_undeafen payload:",
							payload,
						);
						return;
					}

					console.log(
						`🔹 Processing voice moderation undeafen: user ${user_id} in channel ${channel_id}`,
					);

					// Get the guild and member
					const guild = this.client.guilds.cache.get(guild_id);
					if (!guild) {
						console.error(`🔸 Guild ${guild_id} not found`);
						return;
					}

					const member = guild.members.cache.get(user_id);
					if (!member) {
						console.error(`🔸 Member ${user_id} not found`);
						return;
					}

					// Remove deafen
					await member.voice.setDeaf(false);
					console.log(
						`🔹 Removed deafen from user ${user_id} in channel ${channel_id}`,
					);
				} catch (error) {
					console.error(
						"🔸 Failed to execute voice_moderation_undeafen:",
						error,
					);
				}
			},
		);

		// Custom action handler
		this.actionHandlers.set(
			"custom_action",
			async (payload: Record<string, unknown>) => {
				if (!payload) return;

				try {
					// Log custom action for debugging
					console.log("🔹 Custom action triggered:", payload);

					// You can extend this to handle specific custom action types
					// For now, just log the payload
				} catch (error) {
					console.error("🔸 Failed to execute custom action:", error);
				}
			},
		);

		console.log("🔹 Database action handlers registered");
	}

	async executeAction(action: SurrealAction): Promise<void> {
		try {
			// Check if action was already processed
			const actionId =
				typeof action.id === "string"
					? action.id
					: (action.id as { id: string }).id;
			if (this.processedActions.has(actionId)) {
				console.log(
					`🔹 [EXECUTE_ACTION] Action ${actionId} already processed, skipping`,
				);
				return;
			}

			// Add to processed set IMMEDIATELY to prevent race conditions
			this.processedActions.add(actionId);

			console.log(
				`🔹 [EXECUTE_ACTION] Starting execution of action ${action.id}`,
			);
			console.log(`   Type: ${action.type}`);
			console.log(`   Guild: ${action.guild_id}`);
			console.log(`   Created: ${action.created_at}`);

			const handler = this.actionHandlers.get(action.type as ActionType);

			if (!handler) {
				console.error(
					`🔸 [EXECUTE_ACTION] No handler found for action type: ${action.type}`,
				);
				console.error(
					"🔸 [EXECUTE_ACTION] Available handlers:",
					Array.from(this.actionHandlers.keys()),
				);
				// Remove from processed set since we're not actually processing
				this.processedActions.delete(actionId);
				return;
			}

			// Check if action should be executed now or scheduled
			if (action.execute_at && action.execute_at > new Date()) {
				console.log(
					`🔹 [EXECUTE_ACTION] Action ${action.id} scheduled for ${action.execute_at.toISOString()}`,
				);
				// Remove from processed set since we're not actually processing
				this.processedActions.delete(actionId);
				return;
			}

			// Parse payload if it's a JSON string
			let payload: Record<string, unknown> = action.payload;
			if (typeof payload === "string") {
				try {
					payload = JSON.parse(payload);
					console.log("   Payload parsed successfully");
				} catch (error) {
					console.error(
						"🔸 [EXECUTE_ACTION] Failed to parse payload JSON:",
						error,
					);
					// Remove from processed set since we're not actually processing
					this.processedActions.delete(actionId);
					return;
				}
			}

			console.log(
				`   Payload keys: ${Object.keys(payload as Record<string, unknown>).join(", ")}`,
			);

			// Execute the handler FIRST
			console.log(`   Executing handler for ${action.type}...`);
			await handler(payload);
			console.log("   ✅ Handler executed successfully");

			// Mark action as executed AFTER successful processing
			console.log("   Marking action as executed...");
			const markResult = await this.db.markActionExecuted(action.id);
			if (!markResult.success) {
				console.error(
					`🔸 [EXECUTE_ACTION] Failed to mark action ${action.id} as executed:`,
					markResult.error,
				);
				return;
			}
			console.log("   ✅ Action marked as executed");

			console.log(
				`🔹 [EXECUTE_ACTION] Completed execution of action ${action.id}`,
			);
		} catch (error) {
			console.error(
				`🔸 [EXECUTE_ACTION] Failed to execute action ${action.id}:`,
				error,
			);
		}
	}

	async processPendingActions(): Promise<void> {
		try {
			// Set processing flag
			this.isProcessing = true;

			console.log(
				"🔹 [ACTION_PROCESSOR] Starting to process pending actions...",
			);

			// Check if database is connected
			if (!this.db.isConnected()) {
				console.error(
					"🔸 [ACTION_PROCESSOR] Database not connected, skipping action processing",
				);
				this.isProcessing = false;
				return;
			}

			const result = await this.db.getPendingActions();

			if (!result.success || !result.data) {
				console.error(
					"🔸 [ACTION_PROCESSOR] Failed to get pending actions:",
					result.error,
				);
				return;
			}

			// Sort actions by priority to ensure proper order
			// voice_channel_update should be processed before voice_user_leave
			const actionPriority = {
				voice_channel_update: 1,
				voice_channel_create: 2,
				voice_user_leave: 3,
				member_role_update: 4,
			};

			result.data.sort((a, b) => {
				const aPriority =
					actionPriority[a.type as keyof typeof actionPriority] || 999;
				const bPriority =
					actionPriority[b.type as keyof typeof actionPriority] || 999;
				return aPriority - bPriority;
			});

			console.log(
				`🔹 [ACTION_PROCESSOR] Found ${result.data.length} pending actions`,
			);

			// Log action types breakdown
			const actionTypes = result.data.reduce(
				(acc: Record<string, number>, action: SurrealAction) => {
					acc[action.type] = (acc[action.type] || 0) + 1;
					return acc;
				},
				{},
			);
			console.log("🔹 [ACTION_PROCESSOR] Action types breakdown:", actionTypes);

			const now = new Date();
			const actionsToExecute = result.data.filter(
				(action: SurrealAction) =>
					!action.executed && (!action.execute_at || action.execute_at <= now),
			);

			console.log(
				`🔹 [ACTION_PROCESSOR] ${actionsToExecute.length} actions ready for execution`,
			);

			if (actionsToExecute.length === 0) {
				console.log("🔹 [ACTION_PROCESSOR] No actions to execute at this time");
				return;
			}

			// Process actions one by one with detailed logging
			for (let i = 0; i < actionsToExecute.length; i++) {
				const action = actionsToExecute[i];
				if (!action) {
					console.log(
						`🔸 [ACTION_PROCESSOR] Action at index ${i} is undefined, skipping`,
					);
					continue;
				}

				console.log(
					`\n🔹 [ACTION_PROCESSOR] Executing action ${i + 1}/${actionsToExecute.length}:`,
				);
				console.log(`   Type: ${action.type}`);
				console.log(`   ID: ${action.id}`);
				console.log(`   Created: ${action.created_at}`);
				console.log(`   Guild: ${action.guild_id}`);

				try {
					await this.executeAction(action);
					console.log(`   ✅ Successfully executed action ${action.id}`);
				} catch (error) {
					console.error(`   🔸 Failed to execute action ${action.id}:`, error);
				}
			}

			console.log(
				`\n🔹 [ACTION_PROCESSOR] Finished processing ${actionsToExecute.length} actions`,
			);
		} catch (error) {
			console.error(
				"🔸 [ACTION_PROCESSOR] Error processing pending actions:",
				error,
			);
		} finally {
			// Clear processing flag
			this.isProcessing = false;
		}
	}

	// Utility methods for creating actions
	async createMemberRoleUpdateAction(
		guildId: string,
		userId: string,
		roleIds: string[],
	): Promise<void> {
		const action = {
			guild_id: guildId,
			type: "member_role_update" as ActionType,
			payload: {
				guild_id: guildId,
				user_id: userId,
				role_ids: roleIds,
			} as ActionPayload["member_role_update"],
		};

		await this.db.createAction(action);
	}

	async createMemberBanAction(
		guildId: string,
		userId: string,
		reason?: string,
	): Promise<void> {
		const action = {
			guild_id: guildId,
			type: "member_ban" as ActionType,
			payload: {
				guild_id: guildId,
				user_id: userId,
				reason,
			} as ActionPayload["member_ban"],
		};

		await this.db.createAction(action);
	}

	async createScheduledMessageAction(
		guildId: string,
		channelId: string,
		content: string,
		executeAt?: Date,
	): Promise<void> {
		const action = {
			guild_id: guildId,
			type: "scheduled_message" as ActionType,
			payload: {
				channel_id: channelId,
				content,
			} as ActionPayload["scheduled_message"],
			execute_at: executeAt,
		};

		await this.db.createAction(action);
	}

	async createMilestoneAction(
		guildId: string,
		milestone: number,
		channelId?: string,
	): Promise<void> {
		const action = {
			guild_id: guildId,
			type: "member_count_milestone" as ActionType,
			payload: {
				guild_id: guildId,
				milestone,
				channel_id: channelId,
			} as ActionPayload["member_count_milestone"],
		};

		await this.db.createAction(action);
	}

	async createGlobalBanAction(
		userId: string,
		guildIds: string[],
		reason?: string,
	): Promise<void> {
		const action = {
			guild_id: guildIds[0], // Use first guild as primary
			type: "global_ban_update" as ActionType,
			payload: {
				user_id: userId,
				guild_ids: guildIds,
				reason,
			} as ActionPayload["global_ban_update"],
		};

		await this.db.createAction(action);
	}

	// Clear all actions from the database
	async clearAllActions(): Promise<void> {
		try {
			console.log(
				"🔹 [ACTION_PROCESSOR] Clearing all actions from database...",
			);

			const result = await this.db.clearAllActions();

			if (result.success) {
				console.log(
					`🔹 [ACTION_PROCESSOR] Successfully cleared ${result.data} actions`,
				);
			} else {
				console.error(
					"🔸 [ACTION_PROCESSOR] Failed to clear actions:",
					result.error,
				);
			}
		} catch (error) {
			console.error("🔸 [ACTION_PROCESSOR] Error clearing actions:", error);
		}
	}

	// Start periodic action processing
	startActionProcessor(intervalMs = 30000): void {
		console.log(
			`🔹 [ACTION_PROCESSOR] Starting action processor with ${intervalMs}ms interval`,
		);

		setInterval(async () => {
			try {
				console.log(
					"🔹 [ACTION_PROCESSOR] Timer triggered - processing actions...",
				);
				await this.processPendingActions();
			} catch (error) {
				console.error(
					"🔸 [ACTION_PROCESSOR] Error in action processor interval:",
					error,
				);
			}
		}, intervalMs);

		console.log("🔹 [ACTION_PROCESSOR] Action processor started successfully");
	}
}
