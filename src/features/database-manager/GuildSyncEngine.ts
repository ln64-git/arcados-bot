import type { Guild } from "discord.js";
import type { DatabaseCore } from "./DatabaseCore";

export class GuildSyncEngine {
	private core: DatabaseCore;

	constructor(core: DatabaseCore) {
		this.core = core;
	}

	async checkGuildSyncStatus(guildId: string): Promise<{
		isSynced: boolean;
		lastSync?: Date;
		needsFullSync: boolean;
		stats: {
			totalUsers: number;
			totalMessages: number;
			totalRoles: number;
			totalVoiceSessions: number;
		};
	}> {
		const guildSync = await this.core.getGuildSync(guildId);
		const stats = await this.core.getGuildStats(guildId);

		return {
			isSynced: guildSync?.isFullySynced || false,
			lastSync: guildSync?.lastSyncAt,
			needsFullSync: !guildSync || !guildSync.isFullySynced,
			stats,
		};
	}

	async syncGuild(
		guild: Guild,
		forceFullSync = false,
		messageLimit = 1000,
	): Promise<{
		success: boolean;
		syncedUsers: number;
		syncedRoles: number;
		syncedMessages: number;
		errors: string[];
	}> {
		const errors: string[] = [];
		let syncedUsers = 0;
		let syncedRoles = 0;
		let syncedMessages = 0;

		try {
			console.log(`🔍 Starting sync for guild: ${guild.name} (${guild.id})`);
			console.log(`🔍 Force full sync: ${forceFullSync}`);

			// Check if we need a full sync
			const syncStatus = await this.checkGuildSyncStatus(guild.id);
			const needsFullSync = forceFullSync || syncStatus.needsFullSync;

			console.log(`🔍 Needs full sync: ${needsFullSync}`);
			console.log(`🔍 Sync status:`, syncStatus);

			if (needsFullSync) {
				console.log(`🔍 Starting full sync process...`);

				// Sync roles first
				console.log(`🔍 Syncing roles...`);
				const rolesResult = await this.syncRoles(guild);
				syncedRoles = rolesResult.synced;
				errors.push(...rolesResult.errors);
				console.log(
					`🔍 Roles sync result: ${syncedRoles} synced, ${rolesResult.errors.length} errors`,
				);

				// Sync users
				console.log(`🔍 Syncing users...`);
				const usersResult = await this.syncUsers(guild);
				syncedUsers = usersResult.synced;
				errors.push(...usersResult.errors);
				console.log(
					`🔍 Users sync result: ${syncedUsers} synced, ${usersResult.errors.length} errors`,
				);

				// Sync messages
				console.log(`🔍 Syncing messages...`);
				const messagesResult = await this.syncMessages(guild, messageLimit);
				syncedMessages = messagesResult.synced;
				errors.push(...messagesResult.errors);
				console.log(
					`🔍 Messages sync result: ${syncedMessages} synced, ${messagesResult.errors.length} errors`,
				);
			} else {
				console.log(`🔍 Starting incremental sync...`);
				const incrementalResult = await this.performIncrementalSync(guild);
				syncedUsers = incrementalResult.syncedUsers;
				syncedRoles = incrementalResult.syncedRoles;
				syncedMessages = incrementalResult.syncedMessages;
				errors.push(...incrementalResult.errors);
			}

			console.log(`🔍 Updating guild sync status...`);
			// Update guild sync status
			await this.core.updateGuildSync({
				guildId: guild.id,
				lastSyncAt: new Date(),
				totalUsers: syncedUsers,
				totalMessages: syncedMessages,
				totalRoles: syncedRoles,
				isFullySynced: true,
			});

			console.log(
				`🔍 Sync completed: ${syncedUsers} users, ${syncedRoles} roles, ${syncedMessages} messages`,
			);
			return {
				success: errors.length === 0,
				syncedUsers,
				syncedRoles,
				syncedMessages,
				errors,
			};
		} catch (error) {
			console.error("🔸 Error during guild sync:", error);
			errors.push(
				`Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);

			return {
				success: false,
				syncedUsers,
				syncedRoles,
				syncedMessages,
				errors,
			};
		}
	}

	// ==================== PRIVATE SYNC METHODS ====================

	private async syncRoles(
		guild: Guild,
	): Promise<{ synced: number; errors: string[] }> {
		const errors: string[] = [];
		let synced = 0;

		try {
			console.log(`🔍 Fetching roles from guild: ${guild.name}`);
			console.log(`🔍 Guild roles cache size: ${guild.roles.cache.size}`);

			// Collect all roles for batch processing
			const roles: Array<
				Omit<
					import("../../types/database").Role,
					"_id" | "createdAt" | "updatedAt"
				>
			> = [];

			for (const [, discordRole] of guild.roles.cache) {
				try {
					const role: Omit<
						import("../../types/database").Role,
						"_id" | "createdAt" | "updatedAt"
					> = {
						discordId: discordRole.id,
						name: discordRole.name,
						color: discordRole.color,
						position: discordRole.position,
						permissions: discordRole.permissions.bitfield.toString(),
						mentionable: discordRole.mentionable,
						hoist: discordRole.hoist,
						managed: discordRole.managed,
						guildId: guild.id,
					};

					roles.push(role);
				} catch (error) {
					errors.push(
						`Failed to prepare role ${discordRole.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}

			console.log(`🔍 Prepared ${roles.length} roles for batch upsert`);

			// Batch upsert all roles at once
			if (roles.length > 0) {
				try {
					console.log(`🔍 Executing batch upsert for ${roles.length} roles`);
					await this.core.batchUpsertRoles(roles);
					synced = roles.length;
					console.log(`🔍 Successfully synced ${synced} roles`);
				} catch (error) {
					console.error("🔸 Failed to batch sync roles:", error);
					errors.push(
						`Failed to batch sync roles: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}
		} catch (error) {
			errors.push(
				`Failed to fetch roles: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}

		console.log(
			`🔍 Roles sync completed: ${synced} synced, ${errors.length} errors`,
		);
		return { synced, errors };
	}

	private async syncUsers(
		guild: Guild,
	): Promise<{ synced: number; errors: string[] }> {
		const errors: string[] = [];
		let synced = 0;

		try {
			console.log(`🔍 Fetching members from guild: ${guild.name}`);
			console.log(`🔍 Guild member count: ${guild.memberCount}`);
			console.log(`🔍 Guild members cache size: ${guild.members.cache.size}`);

			// Fetch all members
			await guild.members.fetch();
			console.log(
				`🔍 After fetch - Guild members cache size: ${guild.members.cache.size}`,
			);

			// Collect all users for batch processing
			const users: Array<
				Omit<
					import("../../types/database").User,
					"id" | "createdAt" | "updatedAt"
				>
			> = [];

			for (const [, member] of guild.members.cache) {
				try {
					const user: Omit<
						import("../../types/database").User,
						"id" | "createdAt" | "updatedAt"
					> = {
						discordId: member.id,
						username: member.user.username,
						displayName: member.displayName,
						discriminator: member.user.discriminator,
						avatar: member.user.avatar || undefined,
						bot: member.user.bot,
						status: "online",
						roles: member.roles.cache.map((role) => role.id),
						joinedAt: member.joinedAt || new Date(),
						lastSeen: new Date(),
						avatarHistory: [],
						usernameHistory: [member.user.username],
						displayNameHistory: [member.displayName],
						statusHistory: [],
						emoji: undefined,
						title: undefined,
						summary: undefined,
						keywords: [],
						notes: [],
						relationships: [],
						modPreferences: {
							bannedUsers: [],
							mutedUsers: [],
							kickedUsers: [],
							deafenedUsers: [],
							renamedUsers: [],
							modHistory: [],
							lastUpdated: new Date(),
						},
						voiceInteractions: [],
						guildId: guild.id,
					};

					users.push(user);
				} catch (error) {
					errors.push(
						`Failed to prepare user ${member.user.username}: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}

			console.log(`🔍 Prepared ${users.length} users for batch upsert`);

			// Batch upsert all users at once
			if (users.length > 0) {
				try {
					console.log(`🔍 Executing batch upsert for ${users.length} users`);
					await this.core.batchUpsertUsers(users);
					synced = users.length;
					console.log(`🔍 Successfully synced ${synced} users`);
				} catch (error) {
					console.error("🔸 Failed to batch sync users:", error);
					errors.push(
						`Failed to batch sync users: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}
		} catch (error) {
			errors.push(
				`Failed to fetch members: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}

		console.log(
			`🔍 Users sync completed: ${synced} synced, ${errors.length} errors`,
		);
		return { synced, errors };
	}

	private async syncMessages(
		guild: Guild,
		limit = 1000,
	): Promise<{ synced: number; errors: string[] }> {
		const errors: string[] = [];
		let synced = 0;

		try {
			// Get guild sync status to check lastMessageId
			const guildSync = await this.core.getGuildSync(guild.id);
			const lastMessageId = guildSync?.lastMessageId;

			// Get text channels
			const channels = guild.channels.cache.filter((channel) =>
				channel.isTextBased(),
			);

			for (const [, channel] of channels) {
				try {
					// Skip non-text channels
					if (!channel.isTextBased()) {
						continue;
					}

					let lastMessage: string | undefined;
					let hasMore = true;
					let batchCount = 0;
					const maxBatches = Math.ceil(limit / 100);
					let channelSynced = 0;
					let foundLastMessage = false;

					while (hasMore && batchCount < maxBatches) {
						const messages = await channel.messages.fetch({
							limit: 100,
							before: lastMessage,
						});

						if (messages.size === 0) {
							hasMore = false;
							break;
						}

						// Process messages in batches
						const messageBatch: Omit<
							import("../../types/database").Message,
							"_id" | "createdAt" | "updatedAt"
						>[] = [];

						for (const [messageId, message] of messages) {
							try {
								// If we've reached the last synced message, stop processing
								if (lastMessageId && messageId === lastMessageId) {
									foundLastMessage = true;
									hasMore = false;
									break;
								}

								// Skip messages from bot users
								if (message.author.bot) {
									lastMessage = messageId;
									continue;
								}

								// Check if user has "bot" role
								const member = message.member;
								if (
									member?.roles.cache.some(
										(role) => role.name.toLowerCase() === "bot",
									)
								) {
									lastMessage = messageId;
									continue;
								}

								// Skip messages that start with "m!"
								if (message.content.startsWith("m!")) {
									lastMessage = messageId;
									continue;
								}

								// Check if message already exists in database
								const existingMessage = await this.core.getMessage(messageId);
								if (existingMessage) {
									lastMessage = messageId;
									continue; // Skip already synced messages
								}

								const dbMessage = this.convertMessageToDB(message);
								messageBatch.push(dbMessage);
								lastMessage = messageId;
							} catch (error) {
								errors.push(
									`Failed to process message ${messageId}: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
						}

						// Batch insert messages
						if (messageBatch.length > 0) {
							try {
								await this.core.batchInsertMessages(messageBatch);
								channelSynced += messageBatch.length;
								synced += messageBatch.length;
							} catch (error) {
								errors.push(
									`Failed to batch insert messages: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
						}

						batchCount++;
						if (messages.size < 100) {
							hasMore = false;
						}

						// If we found the last synced message, stop processing this channel
						if (foundLastMessage) {
							break;
						}

						// Small delay to prevent rate limiting
						await new Promise((resolve) => setTimeout(resolve, 100));
					}

					console.log(
						`🔹 Channel ${channel.name} completed: ${channelSynced} messages`,
					);
				} catch (error) {
					errors.push(
						`Failed to fetch messages from channel ${channel.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}
		} catch (error) {
			errors.push(
				`Failed to sync messages: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}

		return { synced, errors };
	}

	private async performIncrementalSync(guild: Guild): Promise<{
		syncedUsers: number;
		syncedRoles: number;
		syncedMessages: number;
		errors: string[];
	}> {
		const errors: string[] = [];
		let syncedUsers = 0;
		let syncedRoles = 0;
		let syncedMessages = 0;

		try {
			// Sync new/updated roles
			const rolesResult = await this.syncRoles(guild);
			syncedRoles = rolesResult.synced;
			errors.push(...rolesResult.errors);

			// Sync new/updated users
			const usersResult = await this.syncUsers(guild);
			syncedUsers = usersResult.synced;
			errors.push(...usersResult.errors);

			// Sync recent messages (last 100 per channel)
			const messagesResult = await this.syncMessages(guild, 100);
			syncedMessages = messagesResult.synced;
			errors.push(...messagesResult.errors);
		} catch (error) {
			errors.push(
				`Incremental sync failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}

		return { syncedUsers, syncedRoles, syncedMessages, errors };
	}

	private convertMessageToDB(
		message: import("discord.js").Message,
	): Omit<
		import("../../types/database").Message,
		"_id" | "createdAt" | "updatedAt"
	> {
		return {
			discordId: message.id,
			content: message.content,
			authorId: message.author.id,
			channelId: message.channelId,
			guildId: message.guild?.id || "",
			timestamp: message.createdAt,
			editedAt: message.editedAt || undefined,
			mentions: message.mentions.users.map((user) => user.id),
			reactions: message.reactions.cache.map((reaction) => ({
				emoji: reaction.emoji.name || reaction.emoji.toString(),
				count: reaction.count,
				users: [],
			})),
			replyTo: message.reference?.messageId || undefined,
			attachments: message.attachments.map((attachment) => ({
				id: attachment.id,
				filename: attachment.name,
				size: attachment.size,
				url: attachment.url,
				contentType: attachment.contentType || undefined,
			})),
			embeds: message.embeds.map((embed) => ({
				title: embed.title || undefined,
				description: embed.description || undefined,
				url: embed.url || undefined,
				color: embed.color || undefined,
				timestamp: embed.timestamp || undefined,
				footer: embed.footer
					? {
							text: embed.footer.text,
							icon_url: embed.footer.iconURL || undefined,
							proxy_icon_url: embed.footer.proxyIconURL || undefined,
						}
					: undefined,
				image: embed.image
					? {
							url: embed.image.url,
							proxy_url: embed.image.proxyURL || undefined,
							height: embed.image.height || undefined,
							width: embed.image.width || undefined,
						}
					: undefined,
				thumbnail: embed.thumbnail
					? {
							url: embed.thumbnail.url,
							proxy_url: embed.thumbnail.proxyURL || undefined,
							height: embed.thumbnail.height || undefined,
							width: embed.thumbnail.width || undefined,
						}
					: undefined,
				video: embed.video
					? {
							url: embed.video.url,
							proxy_url: embed.video.proxyURL || undefined,
							height: embed.video.height || undefined,
							width: embed.video.width || undefined,
						}
					: undefined,
				provider: embed.provider
					? {
							name: embed.provider.name || undefined,
							url: embed.provider.url || undefined,
						}
					: undefined,
				author: embed.author
					? {
							name: embed.author.name,
							url: embed.author.url || undefined,
							icon_url: embed.author.iconURL || undefined,
							proxy_icon_url: embed.author.proxyIconURL || undefined,
						}
					: undefined,
				fields:
					embed.fields?.map((field) => ({
						name: field.name,
						value: field.value,
						inline: field.inline || false,
					})) || undefined,
			})),
		};
	}
}
