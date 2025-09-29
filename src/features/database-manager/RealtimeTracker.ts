import type {
	Client,
	GuildMember,
	Message,
	MessageReaction,
	PartialMessage,
	VoiceState,
} from "discord.js";
import type { VoiceSession } from "../../types/database";
import type { DatabaseCore } from "./DatabaseCore";

export class RealtimeTracker {
	private core: DatabaseCore;
	private activeVoiceSessions: Map<string, VoiceSession> = new Map();

	constructor(core: DatabaseCore) {
		this.core = core;
	}

	setupEventHandlers(client: Client): void {
		// Message events
		client.on("messageCreate", async (message) => {
			await this.trackMessage(message);
		});

		client.on("messageUpdate", async (_, newMessage) => {
			if (newMessage instanceof Message) {
				await this.trackMessageUpdate(newMessage);
			}
		});

		client.on("messageDelete", async (message) => {
			await this.trackMessageDelete(message);
		});

		// Reaction events
		client.on("messageReactionAdd", async (reaction, user) => {
			if (reaction.partial) {
				try {
					await reaction.fetch();
				} catch (error) {
					console.error("🔸 Error fetching reaction:", error);
					return;
				}
			}
			await this.trackReactionAdd(reaction, user);
		});

		client.on("messageReactionRemove", async (reaction, user) => {
			if (reaction.partial) {
				try {
					await reaction.fetch();
				} catch (error) {
					console.error("🔸 Error fetching reaction:", error);
					return;
				}
			}
			await this.trackReactionRemove(reaction, user);
		});

		// Voice state events
		client.on("voiceStateUpdate", async (oldState, newState) => {
			await this.trackVoiceStateUpdate(oldState, newState);
		});

		// Guild member events
		client.on("guildMemberUpdate", async (_, newMember) => {
			if (newMember.partial) {
				try {
					await newMember.fetch();
				} catch (error) {
					console.error("🔸 Error fetching member:", error);
					return;
				}
			}
			await this.trackGuildMemberUpdate(newMember);
		});
	}

	// ==================== MESSAGE TRACKING ====================

	private async trackMessage(message: Message): Promise<void> {
		try {
			if (!message.guild || !message.author || message.author.bot) return;

			// Check if user has "bot" role
			const member = message.member;
			if (
				member?.roles.cache.some((role) => role.name.toLowerCase() === "bot")
			) {
				return;
			}

			// Skip messages that start with "m!"
			if (message.content.startsWith("m!")) {
				return;
			}

			const dbMessage = this.convertMessageToDB(message);
			await this.core.upsertMessage(dbMessage);

			// Track user interactions
			if (message.guild) {
				await this.trackMessageInteractions(message);
			}

			console.log(
				`🔹 Tracked message from ${message.author.username} in ${message.guild.name}`,
			);
		} catch (error) {
			console.error("🔸 Error tracking message:", error);
		}
	}

	private async trackMessageUpdate(newMessage: Message): Promise<void> {
		try {
			if (!newMessage.guild || newMessage.author.bot) return;

			// Check if user has "bot" role
			const member = newMessage.member;
			if (
				member?.roles.cache.some((role) => role.name.toLowerCase() === "bot")
			) {
				return;
			}

			// Skip messages that start with "m!"
			if (newMessage.content.startsWith("m!")) {
				return;
			}

			const dbMessage = this.convertMessageToDB(newMessage);
			await this.core.upsertMessage(dbMessage);

			console.log(`🔹 Updated message from ${newMessage.author.username}`);
		} catch (error) {
			console.error("🔸 Error tracking message update:", error);
		}
	}

	private async trackMessageDelete(
		message: PartialMessage | Message,
	): Promise<void> {
		try {
			if (!message.guild || !message.author) return;

			// Mark message as deleted in database
			// Note: This would need a new method in DatabaseCore for updating messages
			console.log(`🔹 Message deleted from ${message.author.username}`);
		} catch (error) {
			console.error("🔸 Error tracking message delete:", error);
		}
	}

	// ==================== REACTION TRACKING ====================

	private async trackReactionAdd(
		reaction: MessageReaction,
		user: { id: string; username: string; bot: boolean },
	): Promise<void> {
		try {
			if (user.bot || !reaction.message.guild) return;

			const message = reaction.message;
			if (message.partial) {
				await message.fetch();
			}

			// Record interaction
			await this.core.recordInteraction({
				fromUserId: user.id,
				toUserId: message.author.id,
				guildId: message.guild?.id || "",
				interactionType: "reaction",
				messageId: message.id,
				channelId: message.channelId,
				timestamp: new Date(),
			});

			console.log(`🔹 Reaction added by ${user.username}`);
		} catch (error) {
			console.error("🔸 Error tracking reaction add:", error);
		}
	}

	private async trackReactionRemove(
		reaction: MessageReaction,
		user: { id: string; username: string; bot: boolean },
	): Promise<void> {
		try {
			if (user.bot || !reaction.message.guild) return;

			// Note: We don't remove the interaction record, just track the removal
			console.log(`🔹 Reaction removed by ${user.username}`);
		} catch (error) {
			console.error("🔸 Error tracking reaction removal:", error);
		}
	}

	// ==================== VOICE TRACKING ====================

	private async trackVoiceStateUpdate(
		oldState: VoiceState,
		newState: VoiceState,
	): Promise<void> {
		try {
			if (!newState.guild || !newState.member) return;

			const userId = newState.member.id;
			const guildId = newState.guild.id;

			// Skip tracking for bots
			if (newState.member.user.bot) return;

			// Skip tracking for AFK channels
			const channel = newState.channel;
			if (channel && this.isAFKChannel(channel)) return;

			// User joined a voice channel
			if (!oldState.channelId && newState.channelId) {
				const session: Omit<VoiceSession, "_id" | "createdAt" | "updatedAt"> = {
					userId,
					guildId,
					channelId: newState.channelId,
					channelName: channel?.name || "Unknown Channel",
					joinedAt: new Date(),
				};

				await this.core.createVoiceSession(session);
				this.activeVoiceSessions.set(userId, session as VoiceSession);

				// Record interaction for VC time
				await this.core.recordInteraction({
					fromUserId: userId,
					toUserId: userId, // Self-interaction for VC time
					guildId,
					interactionType: "voice",
					channelId: newState.channelId,
					timestamp: new Date(),
					metadata: {
						action: "joined",
						channelName: channel?.name,
					},
				});

				console.log(
					`🔹 ${newState.member.displayName} joined voice channel ${channel?.name}`,
				);
			}

			// User left a voice channel
			if (oldState.channelId && !newState.channelId) {
				const session = this.activeVoiceSessions.get(userId);
				if (session) {
					const leftAt = new Date();
					await this.core.updateVoiceSession(userId, guildId, leftAt);
					this.activeVoiceSessions.delete(userId);

					// Record interaction for VC time
					await this.core.recordInteraction({
						fromUserId: userId,
						toUserId: userId,
						guildId,
						interactionType: "voice",
						channelId: oldState.channelId,
						timestamp: new Date(),
						metadata: {
							action: "left",
							channelName: oldState.channel?.name,
						},
					});

					console.log(`🔹 ${newState.member.displayName} left voice channel`);
				}
			}
		} catch (error) {
			console.error("🔸 Error tracking voice state update:", error);
		}
	}

	// ==================== GUILD MEMBER TRACKING ====================

	private async trackGuildMemberUpdate(newMember: GuildMember): Promise<void> {
		try {
			if (!newMember.guild) return;

			// Update user data
			const user: Omit<any, "_id" | "createdAt" | "updatedAt"> = {
				discordId: newMember.id,
				username: newMember.user.username,
				displayName: newMember.displayName,
				discriminator: newMember.user.discriminator,
				avatar: newMember.user.avatar || undefined,
				bot: newMember.user.bot,
				aliases: [newMember.user.username, newMember.displayName].filter(
					(name, index, arr) => arr.indexOf(name) === index,
				),
				roles: newMember.roles.cache.map((role) => role.id),
				joinedAt: newMember.joinedAt || new Date(),
				lastSeen: new Date(),
				guildId: newMember.guild.id,
			};

			await this.core.upsertUser(user);
			console.log(`🔹 Updated member data for ${newMember.user.username}`);
		} catch (error) {
			console.error("🔸 Error tracking guild member update:", error);
		}
	}

	// ==================== UTILITY METHODS ====================

	getActiveVoiceSessions(): Map<string, VoiceSession> {
		return this.activeVoiceSessions;
	}

	async cleanupActiveSessions(): Promise<void> {
		try {
			// Close all active sessions
			for (const [userId, session] of this.activeVoiceSessions) {
				const leftAt = new Date();
				await this.core.updateVoiceSession(userId, session.guildId, leftAt);
			}
			this.activeVoiceSessions.clear();
		} catch (error) {
			console.error("🔸 Error cleaning up active sessions:", error);
		}
	}

	private isAFKChannel(channel: { name?: string }): boolean {
		return channel?.name?.toLowerCase().includes("afk") || false;
	}

	private convertMessageToDB(
		message: Message,
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

	private async trackMessageInteractions(message: Message): Promise<void> {
		// Track mentions
		if (message.mentions && message.mentions.users.size > 0) {
			for (const [, mentionedUser] of message.mentions.users) {
				if (mentionedUser.id !== message.author.id) {
					await this.core.recordInteraction({
						fromUserId: message.author.id,
						toUserId: mentionedUser.id,
						guildId: message.guild?.id || "",
						interactionType: "mention",
						messageId: message.id,
						channelId: message.channelId,
						timestamp: message.createdAt,
					});
				}
			}
		}

		// Track replies
		if (message.reference?.messageId) {
			await this.core.recordInteraction({
				fromUserId: message.author.id,
				toUserId: message.reference.messageId, // This would need to be resolved to actual user ID
				guildId: message.guild?.id || "",
				interactionType: "reply",
				messageId: message.id,
				channelId: message.channelId,
				timestamp: message.createdAt,
				metadata: {
					repliedToMessageId: message.reference.messageId,
				},
			});
		}
	}
}
