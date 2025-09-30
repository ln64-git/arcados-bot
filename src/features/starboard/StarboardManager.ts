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

			// Create embed for starboard message
			const embed = this.createStarboardEmbed(message, starCount);

			// Send starboard message
			const starboardMessage = await starboardChannel.send({ embeds: [embed] });

			// Store starboard entry
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
				`🔹 Created starboard entry for message ${message.id} with ${starCount} stars`,
			);
		} catch (error) {
			console.error("🔸 Error creating starboard entry:", error);
		}
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

			// Create updated embed
			const embed = this.createStarboardEmbed(originalMessage, newStarCount);

			// Update starboard message
			const starboardMessage = await starboardChannel.messages.fetch(
				entry.starboardMessageId,
			);

			if (starboardMessage) {
				await starboardMessage.edit({ embeds: [embed] });
			}

			// Update entry in cache
			entry.starCount = newStarCount;
			entry.lastUpdated = new Date();
			await this.cache.setStarboardEntry(entry);

			console.log(
				`🔹 Updated starboard entry for message ${entry.originalMessageId} to ${newStarCount} stars`,
			);
		} catch (error) {
			console.error("🔸 Error updating starboard message:", error);
		}
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

			// Delete starboard message
			const starboardMessage = await starboardChannel.messages.fetch(
				entry.starboardMessageId,
			);

			if (starboardMessage) {
				await starboardMessage.delete();
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
		const embed = new EmbedBuilder()
			.setColor(0xffd700) // Gold color
			.setAuthor({
				name: message.author.tag,
				iconURL: message.author.displayAvatarURL(),
			})
			.setDescription(message.content || "*No text content*")
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
			.setTimestamp(message.createdAt)
			.setFooter({
				text: `Message ID: ${message.id}`,
			});

		// Add image if message has attachments
		if (message.attachments.size > 0) {
			const firstAttachment = message.attachments.first();
			if (firstAttachment?.contentType?.startsWith("image/")) {
				embed.setImage(firstAttachment.url);
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
