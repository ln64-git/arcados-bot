import {
	ChannelType,
	type Client,
	type Collection,
	EmbedBuilder,
	type GuildMember,
	PermissionFlagsBits,
	type VoiceChannel,
	type VoiceState,
} from "discord.js";
import { config } from "../../config";
import type {
	CallState,
	CoupSession,
	VoiceManager as IVoiceManager,
	ModerationLog,
	RateLimit,
	UserModerationPreferences,
	VoiceChannelConfig,
	VoiceChannelOwner,
} from "../../types";
import { getCacheManager } from "../cache-management/DiscordDataCache";
import { getDatabase } from "../database-manager/DatabaseConnection";

export class VoiceManager implements IVoiceManager {
	private client: Client;
	private cache = getCacheManager();

	constructor(client: Client) {
		this.client = client;
		this.setupEventHandlers();
	}

	private setupEventHandlers() {
		this.client.on("voiceStateUpdate", async (oldState, newState) => {
			await this.handleVoiceStateUpdate(oldState, newState);
		});
	}

	private async handleVoiceStateUpdate(
		oldState: VoiceState,
		newState: VoiceState,
	) {
		// User joined a voice channel
		if (!oldState.channelId && newState.channelId) {
			await this.handleUserJoined(newState);

			// Apply preferences to new joiner
			if (newState.member) {
				await this.applyPreferencesToNewJoiner(
					newState.channelId,
					newState.member.id,
				);
			}
		}
		// User left a voice channel
		if (oldState.channelId && !newState.channelId) {
			await this.handleUserLeft(oldState);
		}
		// User moved between channels
		if (
			oldState.channelId &&
			newState.channelId &&
			oldState.channelId !== newState.channelId
		) {
			await this.handleUserMoved(oldState, newState);

			// Apply preferences to new joiner if they moved to a different channel
			if (newState.member) {
				await this.applyPreferencesToNewJoiner(
					newState.channelId,
					newState.member.id,
				);
			}
		}
	}

	private async handleUserJoined(newState: VoiceState) {
		const channel = newState.channel;
		if (!channel || !newState.member) {
			return;
		}

		// Check if this is the spawn channel from environment config
		if (!config.spawnChannelId || channel.id !== config.spawnChannelId) {
			return;
		}

		// Check if user is already in a temporary channel
		const existingChannel = newState.guild.channels.cache.find(
			(c) =>
				c.type === ChannelType.GuildVoice &&
				typeof newState.member?.user.username === "string" &&
				c.name.includes(newState.member.user.username),
		) as VoiceChannel;

		if (existingChannel) {
			console.log(
				`🔹 Moving user to existing channel: ${existingChannel.name}`,
			);
			// Move user to their existing channel
			await newState.member.voice.setChannel(existingChannel);
			return;
		}

		// Create default config for channel creation
		const defaultConfig: VoiceChannelConfig = {
			guildId: newState.guild.id,
			spawnChannelId: config.spawnChannelId,
			channelNameTemplate: "{displayname}'s Room",
			maxChannels: 10,
			channelLimit: 10,
		};

		// Create new temporary channel
		await this.createTemporaryChannel(newState.member, defaultConfig);
	}

	private async handleUserLeft(oldState: VoiceState) {
		const channel = oldState.channel;
		if (!channel || !oldState.member) return;

		const owner = await this.getChannelOwner(channel.id);
		if (!owner || owner.userId !== oldState.member.id) return;

		await this.handleOwnerLeft(channel as VoiceChannel);
	}

	private async handleUserMoved(oldState: VoiceState, newState: VoiceState) {
		await this.handleUserLeft(oldState);
		await this.handleUserJoined(newState);
	}

	async createTemporaryChannel(
		member: GuildMember,
		config: VoiceChannelConfig,
	): Promise<void> {
		const channelName = config.channelNameTemplate.replace(
			"{displayname}",
			member.displayName,
		);

		// Get the spawn channel to determine positioning
		const spawnChannel = member.guild.channels.cache.get(config.spawnChannelId);
		if (!spawnChannel || !spawnChannel.isVoiceBased()) {
			console.warn(
				`🔸 Spawn channel ${config.spawnChannelId} not found or not a voice channel`,
			);
			return;
		}

		// Calculate position - place directly below the spawn channel
		const spawnChannelPosition = spawnChannel.position;
		const newChannelPosition = spawnChannelPosition + 1;

		const channel = await member.guild.channels.create({
			name: channelName,
			type: ChannelType.GuildVoice,
			parent: member.voice.channel?.parent,
			position: newChannelPosition,
			permissionOverwrites: [
				{
					id: member.id,
					allow: [
						PermissionFlagsBits.ManageChannels,
						PermissionFlagsBits.MoveMembers,
						PermissionFlagsBits.MuteMembers,
						PermissionFlagsBits.DeafenMembers,
					],
				},
			],
		});

		await member.voice.setChannel(channel as VoiceChannel);
		await this.setChannelOwner(channel.id, member.id, member.guild.id);

		// Wait a moment for Discord to fully process the channel creation
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Apply user preferences to the new channel
		await this.applyUserPreferencesToChannel(channel.id, member.id);

		try {
			const embed = new EmbedBuilder()
				.setTitle(`**${member.user.displayName || member.user.username}**`)
				.setDescription(
					`Welcome to your channel, as the moderator you can use the following commands.`,
				)
				.addFields({
					name: "Available Commands",
					value: [
						"`/disconnect` - Disconnect users",
						"`/kick` - Kick users from channel",
						"`/ban` - Ban/unban users",
						"`/mute` - Mute/unmute users",
						"`/deafen` - Deafen/undeafen users",
						"`/rename` - Change channel name",
						"`/limit` - Set user limit",
						"`/lock` - Lock/unlock channel",
					].join("\n"),
					inline: false,
				})
				.setColor(0x00ff00)
				.setTimestamp();

			await channel.send({ embeds: [embed] });
		} catch (error) {
			console.warn(
				`🔸 Failed to send welcome message to channel ${channel.id}: ${error}`,
			);
			// Continue without sending the message - the channel still works
		}
	}

	private async handleOwnerLeft(channel: VoiceChannel) {
		const members = channel.members.filter((member) => !member.user.bot);

		if (members.size === 0) {
			// No members left, delete the channel
			await this.deleteTemporaryChannel(channel);
		} else {
			// Find the longest standing user using voice activity data
			const newOwner = await this.findLongestStandingUser(channel, members);
			if (!newOwner) return;

			// Clear all permission overwrites except for the new owner
			const permissionOverwrites = channel.permissionOverwrites.cache;
			for (const [id, overwrite] of permissionOverwrites) {
				if (id !== newOwner.id && id !== channel.guild.roles.everyone.id) {
					await overwrite.delete(
						"Ownership transfer - clearing old permissions",
					);
				}
			}

			// Set new owner permissions
			await channel.permissionOverwrites.create(newOwner.id, {
				ManageChannels: true,
				MoveMembers: true,
				MuteMembers: true,
				DeafenMembers: true,
			});

			await this.setChannelOwner(channel.id, newOwner.id, channel.guild.id);

			// Update call state with new owner but preserve current call state
			const currentCallState = await this.getCallState(channel.id);
			if (currentCallState) {
				currentCallState.currentOwner = newOwner.id;
				currentCallState.lastUpdated = new Date();
				await this.updateCallState(currentCallState);
			}

			// Apply only channel settings (name, limit, lock) from new owner's preferences
			const preferences = await this.getUserPreferences(
				newOwner.id,
				channel.guild.id,
			);
			if (preferences) {
				if (preferences.preferredChannelName) {
					try {
						await channel.setName(preferences.preferredChannelName);
					} catch (_error) {
						// Insufficient permissions to change channel name
					}
				}
				if (preferences.preferredUserLimit) {
					try {
						await channel.setUserLimit(preferences.preferredUserLimit);
					} catch (_error) {
						// Insufficient permissions to change user limit
					}
				}
				if (preferences.preferredLocked !== undefined) {
					try {
						await channel.permissionOverwrites.edit(
							channel.guild.roles.everyone,
							{
								Connect: !preferences.preferredLocked,
							},
						);
					} catch (_error) {
						// Insufficient permissions to change lock state
					}
				}
			}

			const embed = new EmbedBuilder()
				.setTitle("🔹 Ownership Transferred")
				.setDescription(
					`**${newOwner.displayName || newOwner.user.username}** is now the owner of this channel. Channel settings have been updated, but existing call state is preserved.`,
				)
				.setColor(0xffa500)
				.setTimestamp();

			try {
				await channel.send({ embeds: [embed] });
			} catch (_error) {
				// Failed to send message, but ownership transfer still succeeded
			}
		}
	}

	async deleteTemporaryChannel(channel: VoiceChannel): Promise<void> {
		try {
			await channel.delete();
		} catch (_error) {
			// Channel may have been manually deleted
		}
	}

	async setChannelOwner(
		channelId: string,
		userId: string,
		guildId: string,
	): Promise<void> {
		const owner: VoiceChannelOwner = {
			channelId,
			userId,
			guildId,
			createdAt: new Date(),
			lastActivity: new Date(),
		};

		await this.cache.setChannelOwner(channelId, owner);

		// Apply only channel-level preferences immediately (name, limit, lock)
		// User-specific preferences (mutes, blocks) will only affect incoming users
		const channel = this.client.channels.cache.get(channelId);
		if (channel?.isVoiceBased()) {
			const preferences = await this.getUserPreferences(userId, guildId);
			if (preferences) {
				// Channel name - changes immediately for everyone to see
				if (preferences.preferredChannelName) {
					try {
						await channel.setName(preferences.preferredChannelName);
					} catch (_error) {
						// Insufficient permissions to change channel name
					}
				}
				// User limit - applies immediately to channel capacity
				if (preferences.preferredUserLimit) {
					try {
						await channel.setUserLimit(preferences.preferredUserLimit);
					} catch (_error) {
						// Insufficient permissions to change user limit
					}
				}
				// Lock status - applies immediately to channel access
				if (preferences.preferredLocked !== undefined) {
					try {
						await channel.permissionOverwrites.edit(
							channel.guild.roles.everyone,
							{
								Connect: !preferences.preferredLocked,
							},
						);
					} catch (_error) {
						// Insufficient permissions to change channel lock
					}
				}
				// Note: User-specific preferences (mutes, blocks, etc.) are handled
				// by the existing user management logic and only affect incoming users
			}
		}
	}

	async getChannelOwner(channelId: string): Promise<VoiceChannelOwner | null> {
		return await this.cache.getChannelOwner(channelId);
	}

	async removeChannelOwner(channelId: string): Promise<void> {
		await this.cache.removeChannelOwner(channelId);
	}

	async isChannelOwner(channelId: string, userId: string): Promise<boolean> {
		const owner = await this.getChannelOwner(channelId);
		return owner?.userId === userId;
	}

	async getGuildConfig(guildId: string): Promise<VoiceChannelConfig> {
		const cached = await this.cache.getGuildConfig(guildId);
		if (cached) {
			return cached;
		}

		// Return default config if not found
		const defaultConfig: VoiceChannelConfig = {
			guildId,
			spawnChannelId: "",
			channelNameTemplate: "{displayname}'s Room",
			maxChannels: 10,
			channelLimit: 10,
		};

		// Cache the default config
		await this.cache.setGuildConfig(guildId, defaultConfig);
		return defaultConfig;
	}

	async logModerationAction(
		log: Omit<ModerationLog, "id" | "timestamp">,
	): Promise<void> {
		try {
			const db = await getDatabase();
			await db.collection("moderationLogs").insertOne({
				...log,
				id: `${log.channelId}-${log.performerId}-${Date.now()}`,
				timestamp: new Date(),
			});
		} catch (error) {
			console.warn(`🔸 Failed to log moderation action to database: ${error}`);
			// Continue without logging
		}
	}

	async getUserPreferences(
		userId: string,
		guildId: string,
	): Promise<UserModerationPreferences | null> {
		return await this.cache.getUserPreferences(userId, guildId);
	}

	async updateUserPreferences(
		preferences: UserModerationPreferences,
	): Promise<void> {
		await this.cache.setUserPreferences(preferences);
	}

	async applyUserPreferencesToChannel(
		channelId: string,
		ownerId: string,
	): Promise<void> {
		let channel: VoiceChannel | null = null;
		try {
			const fetchedChannel = await this.client.channels.fetch(channelId);
			if (
				fetchedChannel?.isVoiceBased() &&
				fetchedChannel.type === ChannelType.GuildVoice
			) {
				channel = fetchedChannel as VoiceChannel;
			} else {
				return;
			}
		} catch (error) {
			console.warn(
				`🔸 Failed to fetch channel ${channelId} for preferences: ${error}`,
			);
			return;
		}

		const preferences = await this.getUserPreferences(
			ownerId,
			channel.guild.id,
		);
		if (!preferences) {
			return;
		}

		// Apply channel settings (name, limit, visibility)
		if (preferences.preferredChannelName) {
			try {
				await channel.setName(preferences.preferredChannelName);
			} catch (_error) {
				// Insufficient permissions to change channel name
			}
		}

		if (preferences.preferredUserLimit) {
			try {
				await channel.setUserLimit(preferences.preferredUserLimit);
			} catch (_error) {
				// Insufficient permissions to change user limit
			}
		}

		if (preferences.preferredLocked !== undefined) {
			try {
				await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
					Connect: !preferences.preferredLocked,
				});
			} catch (_error) {
				// Insufficient permissions to change channel lock state
			}
		}

		// Initialize call state for this channel
		const callState: CallState = {
			channelId,
			currentOwner: ownerId,
			mutedUsers: [],
			deafenedUsers: [],
			kickedUsers: [],
			lastUpdated: new Date(),
		};

		// Only apply bans to users currently in the channel (not mutes/deafens)
		for (const bannedUserId of preferences.bannedUsers) {
			const member = channel.members.get(bannedUserId);
			if (member) {
				try {
					await member.voice.disconnect("Owner preferences: pre-banned");
				} catch (_error) {
					// User may have already left the channel
				}
			}
		}

		// Store call state
		await this.cache.setCallState(channelId, callState);
	}

	async getCallState(channelId: string): Promise<CallState | null> {
		return await this.cache.getCallState(channelId);
	}

	async updateCallState(state: CallState): Promise<void> {
		await this.cache.setCallState(state.channelId, state);
	}

	async applyPreferencesToNewJoiner(
		channelId: string,
		userId: string,
	): Promise<void> {
		const callState = await this.getCallState(channelId);
		if (!callState) {
			return;
		}

		const preferences = await this.getUserPreferences(
			callState.currentOwner,
			"",
		);
		if (!preferences) {
			return;
		}

		const channel = await this.client.channels.fetch(channelId);
		if (
			!channel ||
			!channel.isVoiceBased() ||
			channel.type !== ChannelType.GuildVoice
		) {
			return;
		}

		const member = channel.members.get(userId);
		if (!member) {
			return;
		}

		// Check if user should be banned
		if (preferences.bannedUsers.includes(userId)) {
			try {
				await member.voice.disconnect("Owner preferences: pre-banned");
				return;
			} catch (_error) {
				// Failed to disconnect banned user - they may have left or bot lacks permissions
			}
		}

		// Check if user should be muted
		if (preferences.mutedUsers.includes(userId)) {
			try {
				await member.voice.setMute(true, "Owner preferences: pre-muted");
				callState.mutedUsers.push(userId);
			} catch (_error) {
				// Failed to mute user - bot may lack MuteMembers permission or user left
			}
		}

		// Check if user should be deafened
		if (preferences.deafenedUsers.includes(userId)) {
			try {
				await member.voice.setDeaf(true, "Owner preferences: pre-deafened");
				callState.deafenedUsers.push(userId);
			} catch (_error) {
				// Failed to deafen user - bot may lack DeafenMembers permission or user left
			}
		}

		// Update call state
		callState.lastUpdated = new Date();
		await this.updateCallState(callState);
	}

	async checkRateLimit(
		userId: string,
		action: string,
		maxActions: number,
		timeWindow: number,
	): Promise<boolean> {
		const now = Date.now();
		const limit = await this.cache.getRateLimit(userId, action);

		if (!limit) {
			const newLimit: RateLimit = {
				userId,
				action,
				count: 1,
				windowStart: new Date(now),
			};
			await this.cache.setRateLimit(
				userId,
				action,
				newLimit,
				timeWindow / 1000,
			);
			return true;
		}

		if (now - limit.windowStart.getTime() > timeWindow) {
			limit.count = 1;
			limit.windowStart = new Date(now);
			await this.cache.setRateLimit(userId, action, limit, timeWindow / 1000);
			return true;
		}

		if (limit.count >= maxActions) {
			return false;
		}

		limit.count++;
		await this.cache.setRateLimit(userId, action, limit, timeWindow / 1000);
		return true;
	}

	async startCoupSession(
		channelId: string,
		targetUserId: string,
	): Promise<boolean> {
		const existingSession = await this.cache.getCoupSession(channelId);
		if (existingSession) {
			return false; // Coup already in progress
		}

		const session: CoupSession = {
			channelId,
			targetUserId,
			votes: [],
			startedAt: new Date(),
			expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
		};

		await this.cache.setCoupSession(channelId, session);
		return true;
	}

	async voteCoup(
		channelId: string,
		voterId: string,
		targetUserId: string,
	): Promise<boolean> {
		const session = await this.cache.getCoupSession(channelId);
		if (!session) {
			return false; // No coup session found
		}

		// Check if vote has expired
		if (new Date() > session.expiresAt) {
			await this.cache.removeCoupSession(channelId);
			return false; // Vote expired
		}

		// Check if the voter is voting for the correct target
		if (session.targetUserId !== targetUserId) {
			return false; // Wrong target
		}

		// Record the vote (assuming true means "yes" to the coup)
		const existingVoteIndex = session.votes.findIndex(
			(v) => v.voterId === voterId,
		);
		if (existingVoteIndex >= 0) {
			// Vote already exists, update timestamp
			session.votes[existingVoteIndex].timestamp = new Date();
		} else {
			session.votes.push({
				channelId,
				voterId,
				targetUserId,
				timestamp: new Date(),
			});
		}

		// Count votes (all votes are "yes" votes for the coup)
		const yesVotes = session.votes.length;

		// Get channel to count total members
		const channel = await this.client.channels.fetch(channelId);
		if (!channel || !channel.isVoiceBased()) {
			return false;
		}

		const totalMembers = channel.members.filter(
			(member) => !member.user.bot,
		).size;
		const requiredVotes = Math.ceil(totalMembers / 2);

		if (yesVotes >= requiredVotes) {
			// Coup successful
			const currentOwner = await this.getChannelOwner(channelId);
			if (!currentOwner) {
				return false;
			}

			// Transfer ownership
			await this.setChannelOwner(
				channelId,
				session.targetUserId,
				channel.guild.id,
			);

			// Clear the coup session
			await this.cache.removeCoupSession(channelId);

			return true; // Coup successful
		}

		// Update session in cache
		await this.cache.setCoupSession(channelId, session);
		return false; // Coup not yet successful
	}

	async getModerationLogs(
		channelId: string,
		limit: number = 10,
	): Promise<ModerationLog[]> {
		try {
			const db = await getDatabase();
			const logs = await db
				.collection("moderationLogs")
				.find({ channelId })
				.sort({ timestamp: -1 })
				.limit(limit)
				.toArray();
			return logs as unknown as ModerationLog[];
		} catch (error) {
			console.warn(
				`🔸 Failed to fetch moderation logs from database: ${error}`,
			);
			return [];
		}
	}

	async revokeChannelOwnership(channelId: string): Promise<boolean> {
		try {
			await this.removeChannelOwner(channelId);
			return true;
		} catch (_error) {
			return false;
		}
	}

	async startCoupVote(
		channelId: string,
		targetUserId: string,
	): Promise<boolean> {
		return this.startCoupSession(channelId, targetUserId);
	}

	async getCoupSession(channelId: string): Promise<CoupSession | null> {
		return await this.cache.getCoupSession(channelId);
	}

	async executeCoup(channelId: string): Promise<boolean> {
		const session = await this.cache.getCoupSession(channelId);
		if (!session) {
			return false;
		}

		// Check if vote has expired
		if (new Date() > session.expiresAt) {
			await this.cache.removeCoupSession(channelId);
			return false;
		}

		// Get channel to count total members
		const channel = await this.client.channels.fetch(channelId);
		if (!channel || !channel.isVoiceBased()) {
			return false;
		}

		const totalMembers = channel.members.filter(
			(member) => !member.user.bot,
		).size;
		const requiredVotes = Math.ceil(totalMembers / 2);

		if (session.votes.length >= requiredVotes) {
			// Coup successful
			const currentOwner = await this.getChannelOwner(channelId);
			if (!currentOwner) {
				return false;
			}

			// Transfer ownership
			await this.setChannelOwner(
				channelId,
				session.targetUserId,
				channel.guild.id,
			);

			// Send ownership change message
			try {
				const newOwner = await channel.guild.members.fetch(
					session.targetUserId,
				);
				const oldOwner = await channel.guild.members.fetch(currentOwner.userId);

				const embed = new EmbedBuilder()
					.setTitle("🔹 Ownership Transferred")
					.setDescription(
						`**${newOwner.displayName || newOwner.user.username}** has successfully taken ownership of this channel from **${oldOwner.displayName || oldOwner.user.username}**!`,
					)
					.setColor(0xffa500)
					.setTimestamp();

				await channel.send({ embeds: [embed] });
			} catch (error) {
				console.warn(
					`🔸 Failed to send ownership change message to channel ${channelId}: ${error}`,
				);
			}

			// Clear the coup session
			await this.cache.removeCoupSession(channelId);

			return true;
		}

		return false;
	}

	// Centralized validation methods
	async validateChannelOwnership(
		channelId: string,
		userId: string,
	): Promise<{ isValid: boolean; error?: string }> {
		const isOwner = await this.isChannelOwner(channelId, userId);
		if (!isOwner) {
			return {
				isValid: false,
				error:
					"🔸 You must be the owner of this voice channel to use this command!",
			};
		}
		return { isValid: true };
	}

	async validateUserInChannel(
		channelId: string,
		userId: string,
	): Promise<{ isValid: boolean; error?: string }> {
		const channel = await this.client.channels.fetch(channelId);
		if (!channel || !channel.isVoiceBased()) {
			return {
				isValid: false,
				error: "🔸 Channel not found or not a voice channel!",
			};
		}

		const member = channel.members.get(userId);
		if (!member) {
			return {
				isValid: false,
				error: "🔸 The user is not in this voice channel!",
			};
		}

		return { isValid: true };
	}

	async validateRateLimit(
		userId: string,
		action: string,
		maxActions: number,
		timeWindow: number,
	): Promise<{ isValid: boolean; error?: string }> {
		const canProceed = await this.checkRateLimit(
			userId,
			action,
			maxActions,
			timeWindow,
		);
		if (!canProceed) {
			return {
				isValid: false,
				error: `🔸 You're ${action}ing users too quickly! Please wait a moment.`,
			};
		}
		return { isValid: true };
	}

	// Centralized moderation action methods
	async performMuteAction(
		channelId: string,
		targetUserId: string,
		performerId: string,
		guildId: string,
		action: "mute" | "unmute",
		reason: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel || !channel.isVoiceBased()) {
				return { success: false, error: "Channel not found" };
			}

			const targetMember = channel.members.get(targetUserId);
			if (!targetMember) {
				return { success: false, error: "User not in channel" };
			}

			const isMuted = targetMember.voice.mute;
			if (action === "mute" && isMuted) {
				return { success: false, error: "User is already muted" };
			}
			if (action === "unmute" && !isMuted) {
				return { success: false, error: "User is not muted" };
			}

			await targetMember.voice.setMute(action === "mute", reason);

			// Update preferences
			await this.updateUserModerationPreference(
				performerId,
				guildId,
				"mutedUsers",
				targetUserId,
				action === "mute",
			);

			// Update call state
			await this.updateCallStateModeration(
				channelId,
				"mutedUsers",
				targetUserId,
				action === "mute",
			);

			// Log action
			await this.logModerationAction({
				action,
				channelId,
				guildId,
				performerId,
				targetId: targetUserId,
				reason,
			});

			return { success: true };
		} catch (_error) {
			return { success: false, error: "Failed to perform mute action" };
		}
	}

	async performBanAction(
		channelId: string,
		targetUserId: string,
		performerId: string,
		guildId: string,
		action: "ban" | "unban",
		reason: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel || !channel.isVoiceBased()) {
				return { success: false, error: "Channel not found" };
			}

			if (action === "ban") {
				const targetMember = channel.members.get(targetUserId);
				if (!targetMember) {
					return { success: false, error: "User not in channel" };
				}

				// Disconnect user from voice
				await targetMember.voice.disconnect(reason);

				// Create permission overwrite to deny access
				await channel.permissionOverwrites.create(targetUserId, {
					Connect: false,
					Speak: false,
				});
			} else {
				// Remove permission overwrite to allow access
				try {
					await channel.permissionOverwrites.delete(targetUserId);
				} catch (_error) {
					// Permission overwrite might not exist, that's okay
				}
			}

			// Update preferences
			await this.updateUserModerationPreference(
				performerId,
				guildId,
				"bannedUsers",
				targetUserId,
				action === "ban",
			);

			// Log action
			await this.logModerationAction({
				action,
				channelId,
				guildId,
				performerId,
				targetId: targetUserId,
				reason,
			});

			return { success: true };
		} catch (_error) {
			return { success: false, error: "Failed to perform ban action" };
		}
	}

	// Helper methods for user preferences
	async updateUserModerationPreference(
		userId: string,
		guildId: string,
		preferenceType: keyof Pick<
			UserModerationPreferences,
			"bannedUsers" | "mutedUsers" | "kickedUsers" | "deafenedUsers"
		>,
		targetUserId: string,
		add: boolean,
	): Promise<void> {
		const preferences = (await this.getUserPreferences(userId, guildId)) || {
			userId,
			guildId,
			bannedUsers: [],
			mutedUsers: [],
			kickedUsers: [],
			deafenedUsers: [],
			lastUpdated: new Date(),
		};

		const preferenceArray = preferences[preferenceType];
		if (add) {
			if (!preferenceArray.includes(targetUserId)) {
				preferenceArray.push(targetUserId);
			}
		} else {
			const index = preferenceArray.indexOf(targetUserId);
			if (index > -1) {
				preferenceArray.splice(index, 1);
			}
		}

		preferences.lastUpdated = new Date();
		await this.updateUserPreferences(preferences);
	}

	async updateCallStateModeration(
		channelId: string,
		stateType: keyof Pick<
			CallState,
			"mutedUsers" | "deafenedUsers" | "kickedUsers"
		>,
		userId: string,
		add: boolean,
	): Promise<void> {
		const callState = await this.getCallState(channelId);
		if (!callState) return;

		const stateArray = callState[stateType];
		if (add) {
			if (!stateArray.includes(userId)) {
				stateArray.push(userId);
			}
		} else {
			const index = stateArray.indexOf(userId);
			if (index > -1) {
				stateArray.splice(index, 1);
			}
		}

		callState.lastUpdated = new Date();
		await this.updateCallState(callState);
	}

	async performDeafenAction(
		channelId: string,
		targetUserId: string,
		performerId: string,
		guildId: string,
		action: "deafen" | "undeafen",
		reason: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel || !channel.isVoiceBased()) {
				return { success: false, error: "Channel not found" };
			}

			const targetMember = channel.members.get(targetUserId);
			if (!targetMember) {
				return { success: false, error: "User not in channel" };
			}

			const isDeafened = targetMember.voice.deaf;
			if (action === "deafen" && isDeafened) {
				return { success: false, error: "User is already deafened" };
			}
			if (action === "undeafen" && !isDeafened) {
				return { success: false, error: "User is not deafened" };
			}

			await targetMember.voice.setDeaf(action === "deafen", reason);

			// Update preferences
			await this.updateUserModerationPreference(
				performerId,
				guildId,
				"deafenedUsers",
				targetUserId,
				action === "deafen",
			);

			// Update call state
			await this.updateCallStateModeration(
				channelId,
				"deafenedUsers",
				targetUserId,
				action === "deafen",
			);

			// Log action
			await this.logModerationAction({
				action,
				channelId,
				guildId,
				performerId,
				targetId: targetUserId,
				reason,
			});

			return { success: true };
		} catch (_error) {
			return { success: false, error: "Failed to perform deafen action" };
		}
	}

	async performKickAction(
		channelId: string,
		targetUserId: string,
		performerId: string,
		guildId: string,
		reason: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel || !channel.isVoiceBased()) {
				return { success: false, error: "Channel not found" };
			}

			const targetMember = channel.members.get(targetUserId);
			if (!targetMember) {
				return { success: false, error: "User not in channel" };
			}

			await targetMember.voice.disconnect(reason);

			// Update preferences
			await this.updateUserModerationPreference(
				performerId,
				guildId,
				"kickedUsers",
				targetUserId,
				true,
			);

			// Update call state
			await this.updateCallStateModeration(
				channelId,
				"kickedUsers",
				targetUserId,
				true,
			);

			// Log action
			await this.logModerationAction({
				action: "kick",
				channelId,
				guildId,
				performerId,
				targetId: targetUserId,
				reason,
			});

			return { success: true };
		} catch (_error) {
			return { success: false, error: "Failed to perform kick action" };
		}
	}

	async performDisconnectAction(
		channelId: string,
		targetUserId: string,
		performerId: string,
		guildId: string,
		reason: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel || !channel.isVoiceBased()) {
				return { success: false, error: "Channel not found" };
			}

			const targetMember = channel.members.get(targetUserId);
			if (!targetMember) {
				return { success: false, error: "User not in channel" };
			}

			await targetMember.voice.disconnect(reason);

			// Log action
			await this.logModerationAction({
				action: "disconnect",
				channelId,
				guildId,
				performerId,
				targetId: targetUserId,
				reason,
			});

			return { success: true };
		} catch (_error) {
			return { success: false, error: "Failed to perform disconnect action" };
		}
	}

	// Centralized command validation helper
	async validateCommandExecution(
		channelId: string,
		userId: string,
		action: string,
		maxActions: number,
		timeWindow: number,
	): Promise<{ isValid: boolean; error?: string }> {
		// Validate ownership
		const ownershipValidation = await this.validateChannelOwnership(
			channelId,
			userId,
		);
		if (!ownershipValidation.isValid) {
			return ownershipValidation;
		}

		// Validate rate limit
		const rateLimitValidation = await this.validateRateLimit(
			userId,
			action,
			maxActions,
			timeWindow,
		);
		if (!rateLimitValidation.isValid) {
			return rateLimitValidation;
		}

		return { isValid: true };
	}

	// Centralized error response helper
	createErrorEmbed(title: string, description: string): EmbedBuilder {
		return new EmbedBuilder()
			.setTitle(`🔸 ${title}`)
			.setDescription(description)
			.setColor(0xff0000)
			.setTimestamp();
	}

	createSuccessEmbed(
		title: string,
		description: string,
		color: number = 0x00ff00,
	): EmbedBuilder {
		return new EmbedBuilder()
			.setTitle(`🔹 ${title}`)
			.setDescription(description)
			.setColor(color)
			.setTimestamp();
	}

	/**
	 * Find the longest standing user in THIS SPECIFIC voice channel using voice activity data
	 * This looks for join times relative to the current temporary channel, not total voice time
	 */
	private async findLongestStandingUser(
		channel: VoiceChannel,
		members: Collection<string, GuildMember>,
	): Promise<GuildMember | null> {
		try {
			const db = await getDatabase();

			// Try different common collection names for voice activity
			const possibleCollections = [
				"voiceActivity",
				"voiceStates",
				"voiceLogs",
				"users",
				"voiceData",
			];

			let longestStandingUser: GuildMember | null = null;
			let earliestJoinTime: Date | null = null;

			for (const collectionName of possibleCollections) {
				try {
					const collection = db.collection(collectionName);

					// Check if collection exists and has data
					const count = await collection.countDocuments();
					if (count === 0) continue;

					// Get a sample document to understand the schema
					const sample = await collection.findOne();
					if (!sample) continue;

					console.log(
						`🔹 Found collection "${collectionName}" with ${count} documents`,
					);
					console.log(
						`🔹 Looking for voice activity in channel: ${channel.id} (${channel.name})`,
					);

					// Try to find voice activity data for each member
					for (const [userId, member] of members) {
						try {
							// Look for voice activity records for this user in THIS SPECIFIC channel
							const voiceRecord = await collection.findOne({
								$and: [
									{
										$or: [
											{ userId: userId },
											{ userID: userId },
											{ user: userId },
										],
									},
									{
										$or: [
											{ channelId: channel.id },
											{ channelID: channel.id },
											{ channel: channel.id },
											{ voiceChannelId: channel.id },
										],
									},
								],
							});

							if (voiceRecord) {
								// Try to extract join time from various possible fields
								const joinTime =
									voiceRecord.joinTime ||
									voiceRecord.joinedAt ||
									voiceRecord.startTime ||
									voiceRecord.createdAt ||
									voiceRecord.timestamp;

								if (joinTime) {
									const joinDate = new Date(joinTime);
									if (!earliestJoinTime || joinDate < earliestJoinTime) {
										earliestJoinTime = joinDate;
										longestStandingUser = member;
									}
								}
							}
						} catch (_error) {}
					}

					// If we found data in this collection, use it
					if (longestStandingUser) {
						console.log(
							`🔹 Found longest standing user in channel "${channel.name}": ${longestStandingUser.user.tag} (joined: ${earliestJoinTime})`,
						);
						return longestStandingUser;
					}
				} catch (_error) {}
			}

			// If no voice activity data found, fall back to first member
			console.log(
				`🔸 No voice activity data found, using first member as fallback`,
			);
			return members.first() || null;
		} catch (error) {
			console.warn(`🔸 Error finding longest standing user: ${error}`);
			// Fall back to first member
			return members.first() || null;
		}
	}
}

export function voiceManager(client: Client): VoiceManager {
	return new VoiceManager(client);
}
