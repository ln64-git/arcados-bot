import {
	type Client,
	EmbedBuilder,
	type Message,
	type MessageReaction,
	type PartialMessageReaction,
	type TextChannel,
} from "discord.js";
import { config } from "../../config";
import { getCacheManager } from "../cache-management/DiscordDataCache";

export interface StarboardEntry {
	originalMessageId: string;
	originalChannelId: string;
	starboardMessageId: string;
	starboardChannelId: string;
	guildId: string;
	starCount: number;
	createdAt: Date;
	lastUpdated: Date;
}

export class StarboardManager {
	private cache = getCacheManager();
	private readonly STAR_THRESHOLD = 3;
	private readonly STAR_EMOJI = "⭐";
	private syncInterval: NodeJS.Timeout | null = null;

	constructor(private client: Client) {}

	/**
	 * Handle message reaction events for starboard
	 */
	async handleReactionAdd(
		reaction: MessageReaction | PartialMessageReaction,
	): Promise<void> {
		try {
			// Ignore if it's not a star emoji
			if (reaction.emoji.name !== this.STAR_EMOJI) return;

			// Ignore if the message is from a bot
			if (reaction.message.author?.bot) return;

			// Ignore if starboard channel is not configured
			if (!config.starboardChannelId) return;

			const message = reaction.message;
			if (!message.guild) return;

			// Fetch the full message if it's partial
			const fullMessage = message.partial ? await message.fetch() : message;
			if (!fullMessage || !fullMessage.guild) return;

			// Get the current star count
			const starCount = await this.getStarCount(fullMessage);

			// Check if this message is already on the starboard
			const existingEntry = await this.getStarboardEntry(
				fullMessage.id,
				fullMessage.guild.id,
			);

			if (existingEntry) {
				// Update existing starboard message
				await this.updateStarboardMessage(existingEntry, starCount);
			} else if (starCount >= this.STAR_THRESHOLD) {
				// Create new starboard entry
				await this.createStarboardEntry(fullMessage, starCount);
			}
		} catch (error) {
			console.error("🔸 Error handling reaction add for starboard:", error);
		}
	}

	/**
	 * Handle message reaction removal events for starboard
	 */
	async handleReactionRemove(
		reaction: MessageReaction | PartialMessageReaction,
	): Promise<void> {
		try {
			// Ignore if it's not a star emoji
			if (reaction.emoji.name !== this.STAR_EMOJI) return;

			// Ignore if the message is from a bot
			if (reaction.message.author?.bot) return;

			// Ignore if starboard channel is not configured
			if (!config.starboardChannelId) return;

			const message = reaction.message;
			if (!message.guild) return;

			// Fetch the full message if it's partial
			const fullMessage = message.partial ? await message.fetch() : message;
			if (!fullMessage || !fullMessage.guild) return;

			// Get the current star count
			const starCount = await this.getStarCount(fullMessage);

			// Check if this message is on the starboard
			const existingEntry = await this.getStarboardEntry(
				fullMessage.id,
				fullMessage.guild.id,
			);

			if (existingEntry) {
				if (starCount < this.STAR_THRESHOLD) {
					// Remove from starboard if below threshold
					await this.removeStarboardEntry(existingEntry);
				} else {
					// Update star count
					await this.updateStarboardMessage(existingEntry, starCount);
				}
			}
		} catch (error) {
			console.error("🔸 Error handling reaction remove for starboard:", error);
		}
	}

	/**
	 * Get the current star count for a message
	 */
	private async getStarCount(message: Message): Promise<number> {
		try {
			const reaction = message.reactions.cache.get(this.STAR_EMOJI);
			return reaction ? reaction.count : 0;
		} catch (error) {
			console.error("🔸 Error getting star count:", error);
			return 0;
		}
	}

	/**
	 * Create a new starboard entry
	 */
	private async createStarboardEntry(
		message: Message,
		starCount: number,
	): Promise<void> {
		try {
			if (!message.guild || !config.starboardChannelId) return;

			const starboardChannel = message.guild.channels.cache.get(
				config.starboardChannelId,
			) as TextChannel;

			if (!starboardChannel) {
				console.warn(
					`🔸 Starboard channel ${config.starboardChannelId} not found`,
				);
				return;
			}

			// Check if this message is a reply to another message
			if (message.reference?.messageId) {
				await this.handleReplyStarboard(message, starCount, starboardChannel);
			} else {
				// Regular starboard entry for non-reply messages
				await this.handleRegularStarboard(message, starCount, starboardChannel);
			}
		} catch (error) {
			console.error("🔸 Error creating starboard entry:", error);
		}
	}

	/**
	 * Handle starboard entry for reply messages
	 */
	private async handleReplyStarboard(
		message: Message,
		starCount: number,
		starboardChannel: TextChannel,
	): Promise<void> {
		try {
			// Fetch the original message that this is replying to
			if (!message.reference?.messageId) {
				// If no reference message ID, treat as regular starboard
				await this.handleRegularStarboard(message, starCount, starboardChannel);
				return;
			}

			const originalMessage = await message.channel.messages.fetch(
				message.reference.messageId,
			);

			if (!originalMessage) {
				// If we can't fetch the original message, treat as regular starboard
				await this.handleRegularStarboard(message, starCount, starboardChannel);
				return;
			}

			// Create embed for the original message (without star count)
			const originalEmbed = this.createContextEmbed(originalMessage, false);

			// Create embed for the reply message (with star count)
			const replyEmbed = this.createStarboardEmbed(message, starCount);

			// Send both messages to starboard
			await starboardChannel.send({ embeds: [originalEmbed] });
			const starboardMessage = await starboardChannel.send({
				embeds: [replyEmbed],
			});

			// Store starboard entry for the reply message
			if (!message.guild) {
				console.warn("🔸 Message has no guild, cannot create starboard entry");
				return;
			}

			const entry: StarboardEntry = {
				originalMessageId: message.id,
				originalChannelId: message.channel.id,
				starboardMessageId: starboardMessage.id,
				starboardChannelId: starboardChannel.id,
				guildId: message.guild.id,
				starCount,
				createdAt: new Date(),
				lastUpdated: new Date(),
			};

			await this.cache.setStarboardEntry(entry);

			console.log(
				`🔹 Created reply starboard entry for message ${message.id} (replying to ${originalMessage.id}) with ${starCount} stars`,
			);
		} catch (error) {
			console.error("🔸 Error handling reply starboard:", error);
			// Fallback to regular starboard if reply handling fails
			await this.handleRegularStarboard(message, starCount, starboardChannel);
		}
	}

	/**
	 * Handle regular starboard entry for non-reply messages
	 */
	private async handleRegularStarboard(
		message: Message,
		starCount: number,
		starboardChannel: TextChannel,
	): Promise<void> {
		// Create embed for starboard message
		const embed = this.createStarboardEmbed(message, starCount);

		// Check if message has video attachments
		const videoAttachments = Array.from(message.attachments.values()).filter(
			(att) => att.contentType?.startsWith("video/"),
		);

		// Send starboard message
		let starboardMessage;
		if (videoAttachments.length > 0) {
			// For videos, send the video attachment along with the embed
			const videoAttachment = videoAttachments[0];
			starboardMessage = await starboardChannel.send({
				embeds: [embed],
				files: [
					{
						attachment: videoAttachment.url,
						name: videoAttachment.name || "video.mp4",
					},
				],
			});
		} else {
			// For non-video messages, just send the embed
			starboardMessage = await starboardChannel.send({ embeds: [embed] });
		}

		// Store starboard entry
		if (!message.guild) {
			console.warn("🔸 Message has no guild, cannot create starboard entry");
			return;
		}

		const entry: StarboardEntry = {
			originalMessageId: message.id,
			originalChannelId: message.channel.id,
			starboardMessageId: starboardMessage.id,
			starboardChannelId: starboardChannel.id,
			guildId: message.guild.id,
			starCount,
			createdAt: new Date(),
			lastUpdated: new Date(),
		};

		await this.cache.setStarboardEntry(entry);

		console.log(
			`🔹 Created starboard entry for message ${message.id} with ${starCount} stars${videoAttachments.length > 0 ? " (with video)" : ""}`,
		);
	}

	/**
	 * Update an existing starboard message
	 */
	private async updateStarboardMessage(
		entry: StarboardEntry,
		newStarCount: number,
	): Promise<void> {
		try {
			if (entry.starCount === newStarCount) return;

			const guild = this.client.guilds.cache.get(entry.guildId);
			if (!guild) return;

			const starboardChannel = guild.channels.cache.get(
				entry.starboardChannelId,
			) as TextChannel;

			if (!starboardChannel) return;

			// Fetch the original message to get updated content
			const originalChannel = guild.channels.cache.get(
				entry.originalChannelId,
			) as TextChannel;

			if (!originalChannel) return;

			const originalMessage = await originalChannel.messages.fetch(
				entry.originalMessageId,
			);

			if (!originalMessage) return;

			// Check if this is a reply message
			if (originalMessage.reference?.messageId) {
				await this.updateReplyStarboardMessage(
					entry,
					originalMessage,
					newStarCount,
					starboardChannel,
				);
			} else {
				// Regular starboard message update
				await this.updateRegularStarboardMessage(
					entry,
					originalMessage,
					newStarCount,
					starboardChannel,
				);
			}
		} catch (error) {
			console.error("🔸 Error updating starboard message:", error);
		}
	}

	/**
	 * Update reply starboard message (both context and starred message)
	 */
	private async updateReplyStarboardMessage(
		entry: StarboardEntry,
		originalMessage: Message,
		newStarCount: number,
		starboardChannel: TextChannel,
	): Promise<void> {
		try {
			// Fetch the context message (the message being replied to)
			if (!originalMessage.reference?.messageId) {
				// If no reference message ID, treat as regular update
				await this.updateRegularStarboardMessage(
					entry,
					originalMessage,
					newStarCount,
					starboardChannel,
				);
				return;
			}

			const contextMessage = await originalMessage.channel.messages.fetch(
				originalMessage.reference.messageId,
			);

			if (!contextMessage) {
				// If context message is deleted, treat as regular update
				await this.updateRegularStarboardMessage(
					entry,
					originalMessage,
					newStarCount,
					starboardChannel,
				);
				return;
			}

			// Get the starboard message (the reply message with stars)
			const starboardMessage = await starboardChannel.messages.fetch(
				entry.starboardMessageId,
			);

			if (!starboardMessage) return;

			// Get the message before the starboard message (should be the context)
			const messages = await starboardChannel.messages.fetch({
				before: starboardMessage.id,
				limit: 1,
			});

			const contextStarboardMessage = messages.first();

			// Update context message if it exists
			if (contextStarboardMessage) {
				const contextEmbed = this.createContextEmbed(contextMessage, true);
				await contextStarboardMessage.edit({ embeds: [contextEmbed] });
			}

			// Update the starred reply message
			const replyEmbed = this.createStarboardEmbed(
				originalMessage,
				newStarCount,
			);
			await starboardMessage.edit({ embeds: [replyEmbed] });

			// Update entry in cache
			entry.starCount = newStarCount;
			entry.lastUpdated = new Date();
			await this.cache.setStarboardEntry(entry);

			console.log(
				`🔹 Updated reply starboard entry for message ${entry.originalMessageId} to ${newStarCount} stars`,
			);
		} catch (error) {
			console.error("🔸 Error updating reply starboard message:", error);
			// Fallback to regular update
			await this.updateRegularStarboardMessage(
				entry,
				originalMessage,
				newStarCount,
				starboardChannel,
			);
		}
	}

	/**
	 * Update regular starboard message
	 */
	private async updateRegularStarboardMessage(
		entry: StarboardEntry,
		originalMessage: Message,
		newStarCount: number,
		starboardChannel: TextChannel,
	): Promise<void> {
		// Check if message has video attachments
		const videoAttachments = Array.from(
			originalMessage.attachments.values(),
		).filter((att) => att.contentType?.startsWith("video/"));

		// Get the starboard message
		const starboardMessage = await starboardChannel.messages.fetch(
			entry.starboardMessageId,
		);

		if (starboardMessage) {
			// Create updated embed
			const embed = this.createStarboardEmbed(originalMessage, newStarCount);

			if (videoAttachments.length > 0) {
				// For videos, we need to delete and recreate the message since Discord doesn't allow editing attachments
				await starboardMessage.delete();

				const videoAttachment = videoAttachments[0];
				const newStarboardMessage = await starboardChannel.send({
					embeds: [embed],
					files: [
						{
							attachment: videoAttachment.url,
							name: videoAttachment.name || "video.mp4",
						},
					],
				});

				// Update the entry with the new message ID
				entry.starboardMessageId = newStarboardMessage.id;
			} else {
				// For non-video messages, just update the embed
				await starboardMessage.edit({ embeds: [embed] });
			}
		}

		// Update entry in cache
		entry.starCount = newStarCount;
		entry.lastUpdated = new Date();
		await this.cache.setStarboardEntry(entry);

		console.log(
			`🔹 Updated starboard entry for message ${entry.originalMessageId} to ${newStarCount} stars${videoAttachments.length > 0 ? " (with video)" : ""}`,
		);
	}

	/**
	 * Remove a starboard entry
	 */
	private async removeStarboardEntry(entry: StarboardEntry): Promise<void> {
		try {
			const guild = this.client.guilds.cache.get(entry.guildId);
			if (!guild) return;

			const starboardChannel = guild.channels.cache.get(
				entry.starboardChannelId,
			) as TextChannel;

			if (!starboardChannel) return;

			// Get the starboard message
			const starboardMessage = await starboardChannel.messages.fetch(
				entry.starboardMessageId,
			);

			if (starboardMessage) {
				// Check if this is a reply message by looking for a context message before it
				const messages = await starboardChannel.messages.fetch({
					before: starboardMessage.id,
					limit: 1,
				});

				const contextStarboardMessage = messages.first();

				// Delete the starred message
				await starboardMessage.delete();

				// If there's a context message, delete it too
				if (contextStarboardMessage) {
					// Check if the context message is also a starboard entry
					// by looking for the "Original message (replied to)" footer
					const contextEmbed = contextStarboardMessage.embeds[0];
					if (
						contextEmbed?.footer?.text?.includes(
							"Original message (replied to)",
						)
					) {
						await contextStarboardMessage.delete();
					}
				}
			}

			// Remove entry from cache
			await this.cache.deleteStarboardEntry(
				entry.originalMessageId,
				entry.guildId,
			);

			console.log(
				`🔹 Removed starboard entry for message ${entry.originalMessageId}`,
			);
		} catch (error) {
			console.error("🔸 Error removing starboard entry:", error);
		}
	}

	/**
	 * Create starboard embed
	 */
	private createStarboardEmbed(
		message: Message,
		starCount: number,
	): EmbedBuilder {
		// Determine description based on content and attachments
		let description = message.content;
		if (!description && message.attachments.size > 0) {
			// For messages with only attachments, don't show any description
			// The attachments will be displayed directly
			description = null;
		} else if (!description) {
			description = "*No content*";
		}

		const embed = new EmbedBuilder()
			.setColor(0x3c3d7d) // Deep purple-blue color
			.setAuthor({
				name: message.author.tag,
				iconURL: message.author.displayAvatarURL(),
			});

		// Only set description if it exists
		if (description) {
			embed.setDescription(description);
		}

		embed
			.addFields({
				name: "⭐ Stars",
				value: starCount.toString(),
				inline: true,
			})
			.addFields({
				name: "📍 Channel",
				value: `<#${message.channel.id}>`,
				inline: true,
			})
			.addFields({
				name: "🔗 Jump to Message",
				value: `[Click here](${message.url})`,
				inline: true,
			})
			.setTimestamp(message.createdAt);

		// Handle all attachments (images, videos, files, etc.)
		if (message.attachments.size > 0) {
			const attachments = Array.from(message.attachments.values());

			// Add image attachments
			const imageAttachments = attachments.filter((att) =>
				att.contentType?.startsWith("image/"),
			);
			if (imageAttachments.length > 0) {
				embed.setImage(imageAttachments[0].url);
			}

			// Note: Video attachments are handled by posting the actual video file
			// No need to add them as embed fields since they're displayed directly

			// Add other file attachments
			const otherAttachments = attachments.filter(
				(att) =>
					!att.contentType?.startsWith("image/") &&
					!att.contentType?.startsWith("video/"),
			);
			if (otherAttachments.length > 0) {
				const fileList = otherAttachments
					.map((att) => `[${att.name}](${att.url})`)
					.join("\n");
				embed.addFields({
					name: "📎 Files",
					value: fileList,
					inline: false,
				});
			}
		}

		// Add embeds if message has them
		if (message.embeds.length > 0) {
			const firstEmbed = message.embeds[0];
			if (firstEmbed.image) {
				embed.setImage(firstEmbed.image.url);
			}
			if (firstEmbed.thumbnail) {
				embed.setThumbnail(firstEmbed.thumbnail.url);
			}
		}

		return embed;
	}

	/**
	 * Create context embed for original message (without star count)
	 */
	private createContextEmbed(message: Message, isReply: boolean): EmbedBuilder {
		// Determine description based on content and attachments
		let description = message.content;
		if (!description && message.attachments.size > 0) {
			// For messages with only attachments, don't show any description
			// The attachments will be displayed directly
			description = null;
		} else if (!description) {
			description = "*No content*";
		}

		const embed = new EmbedBuilder()
			.setColor(0x5865f2) // Blurple color for context
			.setAuthor({
				name: message.author.tag,
				iconURL: message.author.displayAvatarURL(),
			});

		// Only set description if it exists
		if (description) {
			embed.setDescription(description);
		}

		embed
			.addFields({
				name: "📍 Channel",
				value: `<#${message.channel.id}>`,
				inline: true,
			})
			.addFields({
				name: "🔗 Jump to Message",
				value: `[Click here](${message.url})`,
				inline: true,
			})
			.setTimestamp(message.createdAt);

		// Handle all attachments (images, videos, files, etc.)
		if (message.attachments.size > 0) {
			const attachments = Array.from(message.attachments.values());

			// Add image attachments
			const imageAttachments = attachments.filter((att) =>
				att.contentType?.startsWith("image/"),
			);
			if (imageAttachments.length > 0) {
				embed.setImage(imageAttachments[0].url);
			}

			// Note: Video attachments are handled by posting the actual video file
			// No need to add them as embed fields since they're displayed directly

			// Add other file attachments
			const otherAttachments = attachments.filter(
				(att) =>
					!att.contentType?.startsWith("image/") &&
					!att.contentType?.startsWith("video/"),
			);
			if (otherAttachments.length > 0) {
				const fileList = otherAttachments
					.map((att) => `[${att.name}](${att.url})`)
					.join("\n");
				embed.addFields({
					name: "📎 Files",
					value: fileList,
					inline: false,
				});
			}
		}

		// Add embeds if message has them
		if (message.embeds.length > 0) {
			const firstEmbed = message.embeds[0];
			if (firstEmbed.image) {
				embed.setImage(firstEmbed.image.url);
			}
			if (firstEmbed.thumbnail) {
				embed.setThumbnail(firstEmbed.thumbnail.url);
			}
		}

		return embed;
	}

	/**
	 * Get starboard entry for a message
	 */
	private async getStarboardEntry(
		messageId: string,
		guildId: string,
	): Promise<StarboardEntry | null> {
		try {
			return await this.cache.getStarboardEntry(messageId, guildId);
		} catch (error) {
			console.error("🔸 Error getting starboard entry:", error);
			return null;
		}
	}

	/**
	 * Get all starboard entries for a guild
	 */
	async getStarboardEntries(guildId: string): Promise<StarboardEntry[]> {
		try {
			return await this.cache.getAllStarboardEntries(guildId);
		} catch (error) {
			console.error("🔸 Error getting starboard entries:", error);
			return [];
		}
	}

	/**
	 * Sync starboard with Discord reactions - reconcile missed messages
	 * Scans channels for messages with star threshold and ensures they're on starboard
	 */
	async syncStarboard(guildId: string): Promise<{
		scanned: number;
		added: number;
		updated: number;
		errors: string[];
	}> {
		const stats = { scanned: 0, added: 0, updated: 0, errors: [] as string[] };

		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild || !config.starboardChannelId) {
				stats.errors.push("Guild or starboard channel not configured");
				return stats;
			}

			console.log("🔄 Starting starboard sync (last 24 hours)...");

			// Get all text channels in the guild
			const textChannels = guild.channels.cache.filter(
				(channel) =>
					channel.isTextBased() && channel.id !== config.starboardChannelId,
			);

			for (const [, channel] of textChannels) {
				try {
					if (!channel.isTextBased()) continue;

					// Fetch messages from the last 24 hours only
					const messages = new Map();
					let lastMessageId: string | undefined;
					let totalFetched = 0;
					const maxMessages = 1000; // Fetch up to 1000 messages per channel
					const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

					while (totalFetched < maxMessages) {
						const fetchLimit = Math.min(100, maxMessages - totalFetched);
						const batch = await (channel as TextChannel).messages.fetch({
							limit: fetchLimit,
							before: lastMessageId,
						});

						if (batch.size === 0) break;

						let foundOldMessage = false;
						for (const [id, message] of batch) {
							// Stop if we've reached messages older than 24 hours
							if (message.createdTimestamp < twentyFourHoursAgo) {
								foundOldMessage = true;
								break;
							}
							messages.set(id, message);
						}

						totalFetched += batch.size;
						lastMessageId = batch.last()?.id;

						// Stop if we found messages older than 24 hours
						if (foundOldMessage) break;

						// If we got less than requested, we've reached the end
						if (batch.size < fetchLimit) break;
					}

					for (const [, message] of messages) {
						stats.scanned++;

						if (message.author?.bot) continue;

						// Check for star reactions
						const starReaction = message.reactions.cache.get(this.STAR_EMOJI);
						if (!starReaction || starReaction.count < this.STAR_THRESHOLD) {
							continue;
						}

						const starCount = starReaction.count;
						const existingEntry = await this.getStarboardEntry(
							message.id,
							guildId,
						);

						if (!existingEntry) {
							// Message should be on starboard but isn't - add it
							console.log(
								`🔹 Found missed starboard message ${message.id} with ${starCount} stars`,
							);
							await this.createStarboardEntry(message, starCount);
							stats.added++;
						} else {
							// Entry exists - check if starboard message still exists
							try {
								const starboardChannel = guild.channels.cache.get(
									config.starboardChannelId!,
								) as TextChannel;

								if (starboardChannel) {
									const starboardMessage =
										await starboardChannel.messages.fetch(
											existingEntry.starboardMessageId,
										);

									if (!starboardMessage) {
										// Starboard message was deleted but cache entry exists - repost it
										console.log(
											`🔹 Reposting deleted starboard message ${message.id} with ${starCount} stars`,
										);
										await this.createStarboardEntry(message, starCount);
										stats.added++;
									} else if (existingEntry.starCount !== starCount) {
										// Entry exists and starboard message exists but star count is out of sync - update it
										await this.updateStarboardMessage(existingEntry, starCount);
										stats.updated++;
									}
								}
							} catch (error) {
								// Starboard message doesn't exist - repost it
								console.log(
									`🔹 Reposting missing starboard message ${message.id} with ${starCount} stars`,
								);
								await this.createStarboardEntry(message, starCount);
								stats.added++;
							}
						}
					}
				} catch (error) {
					const errorMsg = `Failed to scan channel ${channel.id}: ${error}`;
					console.error(`🔸 ${errorMsg}`);
					stats.errors.push(errorMsg);
				}
			}

			console.log(
				`✅ Starboard sync complete (last 24h): ${stats.added} added, ${stats.updated} updated, ${stats.scanned} scanned`,
			);
			return stats;
		} catch (error) {
			stats.errors.push(`Sync failed: ${error}`);
			console.error("🔸 Error syncing starboard:", error);
			return stats;
		}
	}

	/**
	 * Start periodic starboard sync (every 30 minutes)
	 */
	startPeriodicSync(guildId: string, intervalMs = 1800000): void {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
		}

		this.syncInterval = setInterval(async () => {
			console.log("🔄 Running periodic starboard sync...");
			await this.syncStarboard(guildId);
		}, intervalMs);

		console.log(
			`🔹 Started periodic starboard sync (every ${intervalMs / 60000} minutes)`,
		);
	}

	/**
	 * Stop periodic sync
	 */
	stopPeriodicSync(): void {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
			this.syncInterval = null;
			console.log("🔹 Stopped periodic starboard sync");
		}
	}

	/**
	 * Re-sync a specific message to update its starboard entry with new attachment handling
	 */
	async resyncMessage(messageId: string, guildId: string): Promise<boolean> {
		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild) {
				console.error(`🔸 Guild ${guildId} not found`);
				return false;
			}

			// Find the message across all channels
			let message = null;
			for (const [, channel] of guild.channels.cache) {
				if (channel.isTextBased()) {
					try {
						const foundMessage = await channel.messages.fetch(messageId);
						if (foundMessage) {
							message = foundMessage;
							break;
						}
					} catch (error) {
						// Message not in this channel, continue
					}
				}
			}

			if (!message) {
				console.error(`🔸 Message ${messageId} not found in guild`);
				return false;
			}

			// Get current star count
			const starReaction = message.reactions.cache.get(this.STAR_EMOJI);
			if (!starReaction || starReaction.count < this.STAR_THRESHOLD) {
				console.log(`🔸 Message ${messageId} doesn't meet star threshold`);
				return false;
			}

			const starCount = starReaction.count;
			const existingEntry = await this.getStarboardEntry(messageId, guildId);

			if (existingEntry) {
				// Update existing entry with new attachment handling
				console.log(
					`🔄 Re-syncing message ${messageId} with ${starCount} stars`,
				);
				await this.updateStarboardMessage(existingEntry, starCount);
				return true;
			} else {
				// Create new entry
				console.log(`🔄 Creating new starboard entry for message ${messageId}`);
				await this.createStarboardEntry(message, starCount);
				return true;
			}
		} catch (error) {
			console.error(`🔸 Error re-syncing message ${messageId}:`, error);
			return false;
		}
	}

	/**
	 * Get starboard statistics
	 */
	async getStarboardStats(guildId: string): Promise<{
		totalEntries: number;
		totalStars: number;
		mostStarredMessage: StarboardEntry | null;
	}> {
		try {
			const entries = await this.getStarboardEntries(guildId);
			const totalEntries = entries.length;
			const totalStars = entries.reduce(
				(sum, entry) => sum + entry.starCount,
				0,
			);
			const mostStarredMessage = entries.reduce(
				(max, entry) => (entry.starCount > max.starCount ? entry : max),
				entries[0] || null,
			);

			return {
				totalEntries,
				totalStars,
				mostStarredMessage,
			};
		} catch (error) {
			console.error("🔸 Error getting starboard stats:", error);
			return {
				totalEntries: 0,
				totalStars: 0,
				mostStarredMessage: null,
			};
		}
	}
}

export function starboardManager(client: Client): StarboardManager {
	return new StarboardManager(client);
}
