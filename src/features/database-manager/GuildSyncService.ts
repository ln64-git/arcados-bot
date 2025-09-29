import type { Guild } from "discord.js";
import type {
	Message as DBMessage,
	GuildSync,
	Role,
	User,
} from "../../types/database";
import type { DatabaseService } from "./DatabaseService";

export class GuildSyncService {
	private dbService: DatabaseService;

	constructor(dbService: DatabaseService) {
		this.dbService = dbService;
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
		const guildSync = await this.dbService.getGuildSync(guildId);
		const stats = await this.dbService.getGuildStats(guildId);

		return {
			isSynced: guildSync?.isFullySynced || false,
			lastSync: guildSync?.lastSyncAt,
			needsFullSync: !guildSync || !guildSync.isFullySynced,
			stats,
		};
	}

	async syncGuild(
		guild: Guild,
		forceFullSync: boolean = false,
		messageLimit: number = 1000,
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
			console.log(`🔹 Starting guild sync for ${guild.name} (${guild.id})`);

			// Check if we need a full sync
			const syncStatus = await this.checkGuildSyncStatus(guild.id);
			const needsFullSync = forceFullSync || syncStatus.needsFullSync;

			if (needsFullSync) {
				console.log("🔹 Performing full guild sync...");
				const syncStartTime = Date.now();

				// Sync roles first
				console.log("🔹 Syncing roles...");
				const rolesResult = await this.syncRoles(guild);
				syncedRoles = rolesResult.synced;
				errors.push(...rolesResult.errors);
				console.log(`🔹 Roles synced: ${syncedRoles}`);

				// Sync users
				console.log("🔹 Syncing users...");
				const usersResult = await this.syncUsers(guild);
				syncedUsers = usersResult.synced;
				errors.push(...usersResult.errors);
				console.log(`🔹 Users synced: ${syncedUsers}`);

				// Sync messages (this might take a while for large guilds)
				console.log(`🔹 Syncing messages (limit: ${messageLimit})...`);
				const messagesResult = await this.syncMessages(guild, messageLimit);
				syncedMessages = messagesResult.synced;
				errors.push(...messagesResult.errors);

				// Sync interactions from historical messages
				console.log("🔹 Syncing interactions from historical messages...");
				const interactionsResult =
					await this.syncInteractionsFromMessages(guild);
				errors.push(...interactionsResult.errors);
				console.log(`🔹 Interactions synced: ${interactionsResult.synced}`);

				const totalTime = (Date.now() - syncStartTime) / 1000;
				console.log(`🔹 Full sync completed in ${totalTime.toFixed(1)}s`);
			} else {
				console.log("🔹 Performing incremental sync...");

				// Only sync new/updated data
				const incrementalResult = await this.performIncrementalSync(guild);
				syncedUsers = incrementalResult.syncedUsers;
				syncedRoles = incrementalResult.syncedRoles;
				syncedMessages = incrementalResult.syncedMessages;
				errors.push(...incrementalResult.errors);
			}

			// Update guild sync status
			await this.updateGuildSyncStatus(guild.id, {
				lastSyncAt: new Date(),
				totalUsers: syncedUsers,
				totalMessages: syncedMessages,
				totalRoles: syncedRoles,
				isFullySynced: true,
			});

			console.log(`🔹 Guild sync completed for ${guild.name}`);
			console.log(
				`🔹 Synced: ${syncedUsers} users, ${syncedRoles} roles, ${syncedMessages} messages`,
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

	private async syncRoles(
		guild: Guild,
	): Promise<{ synced: number; errors: string[] }> {
		const errors: string[] = [];
		let synced = 0;

		try {
			for (const [, discordRole] of guild.roles.cache) {
				try {
					const role: Omit<Role, "_id" | "createdAt" | "updatedAt"> = {
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

					await this.dbService.upsertRole(role);
					synced++;
				} catch (error) {
					errors.push(
						`Failed to sync role ${discordRole.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}
		} catch (error) {
			errors.push(
				`Failed to fetch roles: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}

		return { synced, errors };
	}

	private async syncUsers(
		guild: Guild,
	): Promise<{ synced: number; errors: string[] }> {
		const errors: string[] = [];
		let synced = 0;

		try {
			// Fetch all members
			await guild.members.fetch();

			for (const [, member] of guild.members.cache) {
				try {
					const user: Omit<User, "_id" | "createdAt" | "updatedAt"> = {
						discordId: member.id,
						username: member.user.username,
						displayName: member.displayName,
						discriminator: member.user.discriminator,
						avatar: member.user.avatar || undefined,
						bot: member.user.bot,
						aliases: [member.user.username, member.displayName].filter(
							(name, index, arr) => arr.indexOf(name) === index,
						),
						roles: member.roles.cache.map((role) => role.id),
						joinedAt: member.joinedAt || new Date(),
						lastSeen: new Date(),
						guildId: guild.id,
					};

					await this.dbService.upsertUser(user);
					synced++;
				} catch (error) {
					errors.push(
						`Failed to sync user ${member.user.username}: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}
		} catch (error) {
			errors.push(
				`Failed to fetch members: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}

		return { synced, errors };
	}

	private async syncMessages(
		guild: Guild,
		limit: number = 1000,
	): Promise<{ synced: number; errors: string[] }> {
		const errors: string[] = [];
		let synced = 0;
		const startTime = Date.now();

		try {
			// Get the last synced message ID
			const lastMessageId = await this.dbService.getLastMessageId(guild.id);

			// Fetch messages from all text channels
			const channels = guild.channels.cache.filter((channel) =>
				channel.isTextBased(),
			);
			console.log(`🔹 Processing ${channels.size} text channels...`);

			for (const [, channel] of channels) {
				try {
					// Skip non-text channels
					if (!channel.isTextBased()) {
						continue;
					}

					console.log(`🔹 Syncing channel: ${channel.name}`);
					let lastMessage: string | undefined = lastMessageId ?? undefined;
					let hasMore = true;
					let batchCount = 0;
					const maxBatches = Math.ceil(limit / 100); // Calculate batches based on limit
					let channelSynced = 0;

					while (hasMore && batchCount < maxBatches) {
						const messages = await channel.messages.fetch({
							limit: 100,
							before: lastMessage,
						});

						if (messages.size === 0) {
							hasMore = false;
							break;
						}

						// Process messages in batches for better performance
						const messageBatch: Omit<
							DBMessage,
							"_id" | "createdAt" | "updatedAt"
						>[] = [];

						for (const [messageId, message] of messages) {
							try {
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

								const dbMessage: Omit<
									DBMessage,
									"_id" | "createdAt" | "updatedAt"
								> = {
									discordId: message.id,
									content: message.content,
									authorId: message.author.id,
									channelId: message.channelId,
									guildId: guild.id,
									timestamp: message.createdAt,
									editedAt: message.editedAt || undefined,
									mentions: message.mentions.users.map((user) => user.id),
									reactions: message.reactions.cache.map((reaction) => ({
										emoji: reaction.emoji.name || reaction.emoji.toString(),
										count: reaction.count,
										users: [], // We'll populate this separately if needed
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
													proxy_icon_url:
														embed.footer.proxyIconURL || undefined,
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
													proxy_icon_url:
														embed.author.proxyIconURL || undefined,
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

								messageBatch.push(dbMessage);
								lastMessage = messageId;
							} catch (error) {
								errors.push(
									`Failed to process message ${messageId}: ${error instanceof Error ? error.message : "Unknown error"}`,
								);
							}
						}

						// Batch insert messages for better performance
						if (messageBatch.length > 0) {
							try {
								await this.dbService.batchInsertMessages(messageBatch);
								channelSynced += messageBatch.length;
								synced += messageBatch.length;

								// Progress logging every 100 messages
								if (synced % 100 === 0) {
									const elapsed = (Date.now() - startTime) / 1000;
									const rate = Math.round(synced / elapsed);
									console.log(
										`🔹 Synced ${synced} messages (${rate}/s) - Channel: ${channel.name}`,
									);
								}
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

			const elapsed = (Date.now() - startTime) / 1000;
			const rate = Math.round(synced / elapsed);
			console.log(
				`🔹 Message sync completed: ${synced} messages in ${elapsed.toFixed(1)}s (${rate}/s)`,
			);
		} catch (error) {
			errors.push(
				`Failed to sync messages: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}

		return { synced, errors };
	}

	private async syncInteractionsFromMessages(
		guild: Guild,
	): Promise<{ synced: number; errors: string[] }> {
		const errors: string[] = [];
		let synced = 0;

		try {
			console.log("🔹 Syncing interactions from historical messages...");

			const collections = this.dbService.getCollections();

			// Get all messages that have mentions or replies
			const messagesWithInteractions = await collections.messages
				.find({
					guildId: guild.id,
					$or: [
						{ mentions: { $exists: true, $not: { $size: 0 } } },
						{ replyTo: { $exists: true } },
					],
				})
				.sort({ timestamp: -1 })
				.toArray();

			console.log(
				`🔹 Found ${messagesWithInteractions.length} messages with potential interactions`,
			);

			for (const message of messagesWithInteractions) {
				try {
					// Track mentions
					if (message.mentions && message.mentions.length > 0) {
						for (const mentionedUserId of message.mentions) {
							if (mentionedUserId !== message.authorId) {
								await this.dbService.recordInteraction({
									fromUserId: message.authorId,
									toUserId: mentionedUserId,
									guildId: message.guildId,
									interactionType: "mention",
									messageId: message.discordId,
									channelId: message.channelId,
									timestamp: message.timestamp,
								});
								synced++;
							}
						}
					}

					// Track replies
					if (message.replyTo) {
						try {
							// Find the replied-to message
							const repliedMessage = await collections.messages.findOne({
								discordId: message.replyTo,
								guildId: message.guildId,
							});

							if (
								repliedMessage &&
								repliedMessage.authorId !== message.authorId
							) {
								await this.dbService.recordInteraction({
									fromUserId: message.authorId,
									toUserId: repliedMessage.authorId,
									guildId: message.guildId,
									interactionType: "reply",
									messageId: message.discordId,
									channelId: message.channelId,
									timestamp: message.timestamp,
									metadata: {
										repliedToMessageId: message.replyTo,
									},
								});
								synced++;
							}
						} catch {
							// Ignore errors when finding replied-to message
						}
					}
				} catch (error) {
					errors.push(
						`Failed to process interactions for message ${message.discordId}: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}

			console.log(
				`🔹 Successfully synced ${synced} interactions from historical messages`,
			);
		} catch (error) {
			errors.push(
				`Failed to sync interactions: ${error instanceof Error ? error.message : "Unknown error"}`,
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

	private async updateGuildSyncStatus(
		guildId: string,
		data: Partial<Omit<GuildSync, "_id" | "createdAt" | "updatedAt">>,
	): Promise<void> {
		const guildSync: Omit<GuildSync, "_id" | "createdAt" | "updatedAt"> = {
			guildId,
			lastSyncAt: data.lastSyncAt || new Date(),
			lastMessageId: data.lastMessageId ?? undefined,
			totalUsers: data.totalUsers || 0,
			totalMessages: data.totalMessages || 0,
			totalRoles: data.totalRoles || 0,
			isFullySynced: data.isFullySynced || false,
		};

		await this.dbService.updateGuildSync(guildSync);
	}
}
