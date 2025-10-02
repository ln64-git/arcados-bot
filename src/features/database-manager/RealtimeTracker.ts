import {
	type Client,
	Message as DiscordMessage,
	type User as DiscordUser,
	type GuildMember,
	type MessageReaction,
	type PartialMessage,
	type PartialMessageReaction,
	type PartialUser,
	type VoiceState,
} from "discord.js";
import type { VoiceSession } from "../../types/database";
import { getEventQueue } from "../event-system/EventQueue";
import type { DatabaseCore } from "./DatabaseCore";

export class RealtimeTracker {
	private core: DatabaseCore;
	private activeVoiceSessions: Map<string, VoiceSession> = new Map();

	constructor(core: DatabaseCore) {
		this.core = core;
	}

	setupEventHandlers(client: Client): void {
		const eventQueue = getEventQueue();

		// Message events - Non-blocking queue
		client.on("messageCreate", (message) => {
			eventQueue.enqueueMessage(message);
		});

		client.on("messageUpdate", (_, newMessage) => {
			if (newMessage instanceof DiscordMessage) {
				eventQueue.enqueueMessageUpdate(_, newMessage);
			}
		});

		client.on("messageDelete", (message) => {
			eventQueue.enqueueMessageDelete(message);
		});

		// Reaction events - Non-blocking queue
		client.on("messageReactionAdd", (reaction, user) => {
			eventQueue.enqueueReactionAdd(reaction, user);
		});

		client.on("messageReactionRemove", (reaction, user) => {
			eventQueue.enqueueReactionRemove(reaction, user);
		});

		// Voice state events - Non-blocking queue
		client.on("voiceStateUpdate", (oldState, newState) => {
			eventQueue.enqueueVoiceStateUpdate(oldState, newState);
		});

		// Guild member events - Non-blocking queue
		client.on("guildMemberUpdate", (oldMember, newMember) => {
			eventQueue.enqueueGuildMemberUpdate(oldMember as GuildMember, newMember);
		});

		// Process queued events
		eventQueue.on("messageCreate", async (message) => {
			await this.trackMessage(message);
		});

		eventQueue.on("messageUpdate", async ({ newMessage }) => {
			if (newMessage instanceof DiscordMessage) {
				await this.trackMessageUpdate(newMessage);
			}
		});

		eventQueue.on("messageDelete", async (message) => {
			await this.trackMessageDelete(message);
		});

		eventQueue.on("messageReactionAdd", async ({ reaction, user }) => {
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

		eventQueue.on("messageReactionRemove", async ({ reaction, user }) => {
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

		eventQueue.on("voiceStateUpdate", async ({ oldState, newState }) => {
			await this.trackVoiceStateUpdate(oldState, newState);
		});

		eventQueue.on("guildMemberUpdate", async ({ newMember }) => {
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

	private async trackMessage(message: DiscordMessage): Promise<void> {
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
		} catch (error) {
			console.error("🔸 Error tracking message:", error);
		}
	}

	private async trackMessageUpdate(newMessage: DiscordMessage): Promise<void> {
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
		} catch (error) {
			console.error("🔸 Error tracking message update:", error);
		}
	}

	private async trackMessageDelete(
		message: PartialMessage | DiscordMessage,
	): Promise<void> {
		try {
			if (!message.guild || !message.author) return;

			// Mark message as deleted in database
			// Note: This would need a new method in DatabaseCore for updating messages
		} catch (error) {
			console.error("🔸 Error tracking message delete:", error);
		}
	}

	// ==================== REACTION TRACKING ====================

	private async trackReactionAdd(
		reaction: MessageReaction | PartialMessageReaction,
		user: DiscordUser | PartialUser,
	): Promise<void> {
		try {
			if (user.bot || !reaction.message.guild) return;

			const message = reaction.message;
			if (message.partial) {
				await message.fetch();
			}

			// Note: Interaction tracking removed - using simplified relationship system
		} catch (error) {
			console.error("🔸 Error tracking reaction add:", error);
		}
	}

	private async trackReactionRemove(
		reaction: MessageReaction | PartialMessageReaction,
		user: DiscordUser | PartialUser,
	): Promise<void> {
		try {
			if (user.bot || !reaction.message.guild) return;

			// Note: We don't remove the interaction record, just track the removal
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

			// User joined a voice channel (from no channel)
			if (!oldState.channelId && newState.channelId) {
				// Close any existing active sessions for this user (fixes multiple active sessions bug)
				await this.closeAllActiveSessionsForUser(userId, guildId);

				const session: Omit<VoiceSession, "_id" | "createdAt" | "updatedAt"> = {
					userId,
					guildId,
					channelId: newState.channelId,
					channelName: channel?.name || "Unknown Channel",
					displayName:
						newState.member?.displayName ||
						newState.member?.user.username ||
						"Unknown User",
					joinedAt: new Date(),
				};

				await this.core.createVoiceSession(session);
				this.activeVoiceSessions.set(userId, session as VoiceSession);

				// Note: Interaction tracking removed - using simplified relationship system
			}

			// User moved between voice channels
			if (
				oldState.channelId &&
				newState.channelId &&
				oldState.channelId !== newState.channelId
			) {
				// Close previous session
				const leftAt = new Date();
				await this.core.updateVoiceSession(
					userId,
					guildId,
					leftAt,
					oldState.channelId,
				);
				this.activeVoiceSessions.delete(userId);

				// Note: Interaction tracking removed - using simplified relationship system

				// Open new session
				const joinedAt = new Date();
				const newSession: Omit<
					VoiceSession,
					"_id" | "createdAt" | "updatedAt"
				> = {
					userId,
					guildId,
					channelId: newState.channelId,
					channelName: newState.channel?.name || "Unknown Channel",
					displayName:
						newState.member?.displayName ||
						newState.member?.user.username ||
						"Unknown User",
					joinedAt,
				};
				await this.core.createVoiceSession(newSession);
				this.activeVoiceSessions.set(userId, newSession as VoiceSession);

				// Note: Interaction tracking removed - using simplified relationship system
			}

			// User left a voice channel (to no channel)
			if (oldState.channelId && !newState.channelId) {
				const session = this.activeVoiceSessions.get(userId);
				if (session) {
					const leftAt = new Date();
					await this.core.updateVoiceSession(
						userId,
						guildId,
						leftAt,
						oldState.channelId,
					);
					this.activeVoiceSessions.delete(userId);

					// Note: Interaction tracking removed - using simplified relationship system
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

			const now = new Date();
			const newAvatarUrl = newMember.user.displayAvatarURL();
			const newStatus =
				newMember.presence?.activities?.find((a) => a.type === 4)?.state || "";

			// Update user data
			const user: Omit<
				import("../../types/database").User,
				"_id" | "createdAt" | "updatedAt"
			> = {
				discordId: newMember.id,
				username: newMember.user.username,
				displayName: newMember.displayName,
				discriminator: newMember.user.discriminator,
				avatar: newAvatarUrl,
				avatarHistory: [],
				bot: newMember.user.bot,
				usernameHistory: [],
				displayNameHistory: [],
				roles: newMember.roles.cache.map((role) => role.id),
				joinedAt: newMember.joinedAt || now,
				lastSeen: now,
				statusHistory: [],
				status: newStatus,
				relationships: [],
				modPreferences: {
					bannedUsers: [],
					mutedUsers: [],
					kickedUsers: [],
					deafenedUsers: [],
					renamedUsers: [],
					lastUpdated: now,
				},
			};

			await this.core.upsertUser(user);

			// Track avatar change if different
			if (newAvatarUrl) {
				await this.core.trackAvatarChange(
					newMember.id,
					newAvatarUrl,
					newMember.user.avatar ?? undefined,
				);
			}

			// Track status change if different
			if (newStatus) {
				await this.core.trackStatusChange(newMember.id, newStatus);
			}
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

	/**
	 * Close all active voice sessions for a user
	 * This fixes the bug where users can have multiple active sessions
	 */
	private async closeAllActiveSessionsForUser(
		userId: string,
		guildId: string,
	): Promise<void> {
		try {
			// Get all active sessions for this user in this guild
			const activeSessions = await this.core.getActiveVoiceSessionsByUser(
				userId,
				guildId,
			);

			if (activeSessions.length > 0) {
				console.log(
					`🔹 Closing ${activeSessions.length} active sessions for user ${userId}`,
				);

				// Close each active session
				for (const session of activeSessions) {
					const leftAt = new Date();
					await this.core.updateVoiceSession(
						userId,
						guildId,
						leftAt,
						session.channelId,
					);
				}
			}
		} catch (error) {
			console.error(
				`🔸 Error closing active sessions for user ${userId}:`,
				error,
			);
		}
	}

	private convertMessageToDB(
		message: DiscordMessage,
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

	private async trackMessageInteractions(
		message: DiscordMessage,
	): Promise<void> {
		// Track mentions
		if (message.mentions && message.mentions.users.size > 0) {
			for (const [, mentionedUser] of message.mentions.users) {
				if (mentionedUser.id !== message.author.id) {
					// Note: Interaction tracking removed - using simplified relationship system
				}
			}
		}

		// Track replies
		if (message.reference?.messageId) {
			// Note: Interaction tracking removed - using simplified relationship system
		}
	}
}
