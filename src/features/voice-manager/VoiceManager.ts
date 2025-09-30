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
	RenamedUser,
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

		// Restore user's nickname when they leave any voice channel
		await this.restoreUserNickname(oldState.member.id, oldState.guild.id);

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

		// Get the spawn channel to determine positioning and privacy settings
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

		// Check if spawn channel is private/locked (privacy setting)
		const spawnChannelPermissions = spawnChannel.permissionOverwrites.cache.get(
			member.guild.roles.everyone.id,
		);

		// A channel is considered private if @everyone has Connect denied OR ViewChannel denied
		const isSpawnChannelPrivate =
			spawnChannelPermissions?.deny.has(PermissionFlagsBits.Connect) ||
			spawnChannelPermissions?.deny.has(PermissionFlagsBits.ViewChannel);

		console.log(`🔹 Spawn channel ${spawnChannel.name} privacy check:`, {
			hasEveryoneOverwrite: !!spawnChannelPermissions,
			connectDenied: spawnChannelPermissions?.deny.has(
				PermissionFlagsBits.Connect,
			),
			viewChannelDenied: spawnChannelPermissions?.deny.has(
				PermissionFlagsBits.ViewChannel,
			),
			isPrivate: isSpawnChannelPrivate,
			allowBitfield: spawnChannelPermissions?.allow.bitfield?.toString(),
			denyBitfield: spawnChannelPermissions?.deny.bitfield?.toString(),
		});

		// Build permission overwrites array
		const permissionOverwrites: Array<{
			id: string;
			allow?: bigint[];
			deny?: bigint[];
		}> = [
			{
				id: member.id,
				allow: [
					PermissionFlagsBits.ManageChannels,
					PermissionFlagsBits.MoveMembers,
					PermissionFlagsBits.MuteMembers,
					PermissionFlagsBits.DeafenMembers,
				],
			},
		];

		// Inherit privacy settings from spawn channel
		if (isSpawnChannelPrivate) {
			// Copy ALL permission overwrites from the spawn channel to maintain the same privacy structure
			console.log(
				`🔹 Copying ALL permission overwrites from spawn channel ${spawnChannel.name}:`,
			);

			for (const [id, overwrite] of spawnChannel.permissionOverwrites.cache) {
				// Skip the owner's permissions as we'll add those separately
				if (id === member.id) continue;

				const copiedOverwrite = {
					id: id,
					allow: overwrite.allow.bitfield
						? [overwrite.allow.bitfield]
						: undefined,
					deny: overwrite.deny.bitfield ? [overwrite.deny.bitfield] : undefined,
				};

				console.log(`🔹 Copying overwrite for ${id}:`, {
					originalAllow: overwrite.allow.bitfield?.toString(),
					originalDeny: overwrite.deny.bitfield?.toString(),
					copiedOverwrite,
				});

				permissionOverwrites.push(copiedOverwrite);
			}
		}

		const channel = await member.guild.channels.create({
			name: channelName,
			type: ChannelType.GuildVoice,
			parent: member.voice.channel?.parent,
			position: newChannelPosition,
			permissionOverwrites,
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

			console.log(
				`🔹 Applying preferences for new owner ${newOwner.displayName || newOwner.user.username} (${newOwner.id})`,
			);
			console.log(
				`🔹 Preferences:`,
				preferences
					? {
							preferredChannelName: preferences.preferredChannelName,
							preferredUserLimit: preferences.preferredUserLimit,
							preferredLocked: preferences.preferredLocked,
						}
					: "null",
			);

			if (preferences) {
				if (preferences.preferredChannelName) {
					try {
						console.log(
							`🔹 Setting channel name to preferred: ${preferences.preferredChannelName}`,
						);
						await channel.setName(preferences.preferredChannelName);
					} catch (_error) {
						console.error(`🔸 Failed to set preferred channel name: ${_error}`);
					}
				} else {
					// Default to "{Display Name}'s Channel" if no preferred name is set
					try {
						const displayName = newOwner.displayName || newOwner.user.username;
						const defaultName = `${displayName}'s Channel`;
						console.log(`🔹 Setting channel name to default: ${defaultName}`);
						await channel.setName(defaultName);
					} catch (_error) {
						console.error(`🔸 Failed to set default channel name: ${_error}`);
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
			} else {
				// No preferences found, apply default naming
				try {
					const displayName = newOwner.displayName || newOwner.user.username;
					const defaultName = `${displayName}'s Channel`;
					console.log(
						`🔹 No preferences found, setting channel name to default: ${defaultName}`,
					);
					await channel.setName(defaultName);
				} catch (_error) {
					console.error(
						`🔸 Failed to set default channel name (no preferences): ${_error}`,
					);
				}
			}

			// Apply nicknames to all current members based on new owner's preferences
			for (const [userId, member] of channel.members) {
				if (!member.user.bot) {
					await this.applyNicknamesToNewJoiner(channel.id, userId);
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
		// Get current owner to track as previous owner
		const currentOwner = await this.getChannelOwner(channelId);

		const owner: VoiceChannelOwner = {
			channelId,
			userId,
			guildId,
			createdAt: new Date(),
			lastActivity: new Date(),
			previousOwnerId: currentOwner?.userId, // Track the previous owner
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

	async isPreviousChannelOwner(
		channelId: string,
		userId: string,
	): Promise<boolean> {
		const owner = await this.getChannelOwner(channelId);
		return owner?.previousOwnerId === userId;
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

		// Apply channel settings (name, limit, visibility)
		if (preferences?.preferredChannelName) {
			try {
				await channel.setName(preferences.preferredChannelName);
			} catch (_error) {
				// Insufficient permissions to change channel name
			}
		} else {
			// Default to "{Display Name}'s Channel" if no preferred name is set
			try {
				const member = await channel.guild.members.fetch(ownerId);
				const displayName = member.displayName || member.user.username;
				await channel.setName(`${displayName}'s Channel`);
			} catch (_error) {
				// Insufficient permissions to change channel name or member not found
			}
		}

		if (preferences?.preferredUserLimit) {
			try {
				await channel.setUserLimit(preferences.preferredUserLimit);
			} catch (_error) {
				// Insufficient permissions to change user limit
			}
		}

		if (preferences?.preferredLocked !== undefined) {
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
		if (preferences?.bannedUsers) {
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

		// Apply nickname if user was renamed in this channel
		await this.applyNicknamesToNewJoiner(channelId, userId);

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

			// Apply the new owner's preferences to the channel
			await this.applyUserPreferencesToChannel(channelId, session.targetUserId);

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
				error: "🔸 You must be the owner of this voice channel!",
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

	/**
	 * Check if a user is banned from a specific channel
	 */
	async isUserBannedFromChannel(
		channelId: string,
		userId: string,
	): Promise<boolean> {
		try {
			const channel = this.client.channels.cache.get(channelId);
			if (!channel || !channel.isVoiceBased()) return false;

			const owner = await this.getChannelOwner(channelId);
			if (!owner) return false;

			const preferences = await this.getUserPreferences(
				owner.userId,
				channel.guild.id,
			);
			return preferences?.bannedUsers.includes(userId) || false;
		} catch (error) {
			console.error("🔸 Error checking if user is banned from channel:", error);
			return false;
		}
	}

	/**
	 * Unban a user from a specific channel
	 */
	async unbanUserFromChannel(
		channelId: string,
		userId: string,
		performerId: string,
	): Promise<boolean> {
		try {
			const channel = this.client.channels.cache.get(channelId);
			if (!channel || !channel.isVoiceBased()) return false;

			const owner = await this.getChannelOwner(channelId);
			if (!owner) return false;

			// Use the existing performBanAction method with "unban"
			const result = await this.performBanAction(
				channelId,
				userId,
				performerId,
				channel.guild.id,
				"unban",
				"Rolled a natural 20 - automatic unban",
			);

			return result.success;
		} catch (error) {
			console.error("🔸 Error unbanning user from channel:", error);
			return false;
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
			renamedUsers: [],
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

	// User nickname management methods
	async renameUser(
		channelId: string,
		targetUserId: string,
		performerId: string,
		newNickname: string,
	): Promise<boolean> {
		try {
			// Validate ownership
			const ownershipValidation = await this.validateChannelOwnership(
				channelId,
				performerId,
			);
			if (!ownershipValidation.isValid) {
				console.warn(`🔸 Rename user failed: ${ownershipValidation.error}`);
				return false;
			}

			// Validate target user is in channel
			const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
			if (!channel) return false;

			const targetMember = channel.members.get(targetUserId);
			if (!targetMember) {
				console.warn(
					`🔸 Target user ${targetUserId} not in channel ${channelId}`,
				);
				return false;
			}

			// Store original nickname before changing
			const originalNickname = targetMember.nickname;

			// Change the user's nickname
			await targetMember.setNickname(
				newNickname,
				`Renamed by channel owner ${performerId}`,
			);

			// Update preferences to track this rename
			const preferences = (await this.getUserPreferences(
				performerId,
				channel.guild.id,
			)) || {
				userId: performerId,
				guildId: channel.guild.id,
				bannedUsers: [],
				mutedUsers: [],
				kickedUsers: [],
				deafenedUsers: [],
				renamedUsers: [],
				lastUpdated: new Date(),
			};

			// Remove any existing rename for this user in this channel
			preferences.renamedUsers = preferences.renamedUsers.filter(
				(renamed) =>
					!(renamed.userId === targetUserId && renamed.channelId === channelId),
			);

			// Add new rename record
			preferences.renamedUsers.push({
				userId: targetUserId,
				originalNickname,
				scopedNickname: newNickname,
				channelId,
				renamedAt: new Date(),
			});

			preferences.lastUpdated = new Date();
			await this.updateUserPreferences(preferences);

			// Log the action
			await this.logModerationAction({
				action: "rename",
				channelId,
				guildId: channel.guild.id,
				performerId,
				targetId: targetUserId,
				reason: `Renamed to: ${newNickname}`,
			});

			return true;
		} catch (error) {
			console.error(`🔸 Error renaming user: ${error}`);
			return false;
		}
	}

	async resetUserNickname(
		channelId: string,
		targetUserId: string,
		performerId: string,
	): Promise<boolean> {
		try {
			// Validate ownership
			const ownershipValidation = await this.validateChannelOwnership(
				channelId,
				performerId,
			);
			if (!ownershipValidation.isValid) {
				console.warn(`🔸 Reset nickname failed: ${ownershipValidation.error}`);
				return false;
			}

			// Get preferences to find the original nickname
			const preferences = await this.getUserPreferences(
				performerId,
				this.client.guilds.cache.get(channelId)?.id || "",
			);
			if (!preferences) return false;

			// Find the rename record
			const renameRecord = preferences.renamedUsers.find(
				(renamed) =>
					renamed.userId === targetUserId && renamed.channelId === channelId,
			);

			if (!renameRecord) {
				console.warn(
					`🔸 No rename record found for user ${targetUserId} in channel ${channelId}`,
				);
				return false;
			}

			// Restore original nickname
			const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
			if (!channel) return false;

			const targetMember = channel.members.get(targetUserId);
			if (targetMember) {
				await targetMember.setNickname(
					renameRecord.originalNickname,
					`Nickname reset by channel owner ${performerId}`,
				);
			}

			// Remove the rename record
			preferences.renamedUsers = preferences.renamedUsers.filter(
				(renamed) =>
					!(renamed.userId === targetUserId && renamed.channelId === channelId),
			);

			preferences.lastUpdated = new Date();
			await this.updateUserPreferences(preferences);

			// Log the action
			await this.logModerationAction({
				action: "rename",
				channelId,
				guildId: channel.guild.id,
				performerId,
				targetId: targetUserId,
				reason: `Nickname reset to original`,
			});

			return true;
		} catch (error) {
			console.error(`🔸 Error resetting user nickname: ${error}`);
			return false;
		}
	}

	async resetAllNicknames(
		channelId: string,
		performerId: string,
	): Promise<boolean> {
		try {
			// Validate ownership
			const ownershipValidation = await this.validateChannelOwnership(
				channelId,
				performerId,
			);
			if (!ownershipValidation.isValid) {
				console.warn(
					`🔸 Reset all nicknames failed: ${ownershipValidation.error}`,
				);
				return false;
			}

			// Get preferences to find all renamed users in this channel
			const preferences = await this.getUserPreferences(
				performerId,
				this.client.guilds.cache.get(channelId)?.id || "",
			);
			if (!preferences) return false;

			const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
			if (!channel) return false;

			// Reset all nicknames for this channel
			const channelRenames = preferences.renamedUsers.filter(
				(renamed) => renamed.channelId === channelId,
			);

			for (const renameRecord of channelRenames) {
				const targetMember = channel.members.get(renameRecord.userId);
				if (targetMember) {
					await targetMember.setNickname(
						renameRecord.originalNickname,
						`All nicknames reset by channel owner ${performerId}`,
					);
				}
			}

			// Remove all rename records for this channel
			preferences.renamedUsers = preferences.renamedUsers.filter(
				(renamed) => renamed.channelId !== channelId,
			);

			preferences.lastUpdated = new Date();
			await this.updateUserPreferences(preferences);

			// Log the action
			await this.logModerationAction({
				action: "rename",
				channelId,
				guildId: channel.guild.id,
				performerId,
				targetId: performerId,
				reason: `All nicknames reset`,
			});

			return true;
		} catch (error) {
			console.error(`🔸 Error resetting all nicknames: ${error}`);
			return false;
		}
	}

	async restoreUserNickname(userId: string, guildId: string): Promise<boolean> {
		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild) return false;

			const member = await guild.members.fetch(userId);
			if (!member) return false;

			// Find any active rename records for this user by checking all voice channels
			let originalNickname: string | null = null;
			const channelsToUpdate: string[] = [];

			// Check all voice channels in the guild
			for (const channel of guild.channels.cache.values()) {
				if (channel.isVoiceBased()) {
					const owner = await this.getChannelOwner(channel.id);
					if (owner) {
						const preferences = await this.getUserPreferences(
							owner.userId,
							guildId,
						);
						if (preferences) {
							const renameRecord = preferences.renamedUsers.find(
								(renamed) => renamed.userId === userId,
							);
							if (renameRecord) {
								originalNickname = renameRecord.originalNickname;
								channelsToUpdate.push(owner.userId);
							}
						}
					}
				}
			}

			// Restore original nickname
			await member.setNickname(
				originalNickname,
				"User left voice channel - nickname restored",
			);

			// Remove all rename records for this user
			for (const ownerId of channelsToUpdate) {
				const preferences = await this.getUserPreferences(ownerId, guildId);
				if (preferences) {
					const hasChanges = preferences.renamedUsers.some(
						(renamed) => renamed.userId === userId,
					);

					if (hasChanges) {
						preferences.renamedUsers = preferences.renamedUsers.filter(
							(renamed) => renamed.userId !== userId,
						);
						preferences.lastUpdated = new Date();
						await this.updateUserPreferences(preferences);
					}
				}
			}

			return true;
		} catch (error) {
			console.error(`🔸 Error restoring user nickname: ${error}`);
			return false;
		}
	}

	async applyNicknamesToNewJoiner(
		channelId: string,
		userId: string,
	): Promise<void> {
		try {
			const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
			if (!channel) return;

			// Get current channel owner
			const currentOwner = await this.getChannelOwner(channelId);
			if (!currentOwner) return;

			// Get owner's preferences
			const preferences = await this.getUserPreferences(
				currentOwner.userId,
				channel.guild.id,
			);
			if (!preferences) return;

			// Find rename record for this user in this channel
			const renameRecord = preferences.renamedUsers.find(
				(renamed) =>
					renamed.userId === userId && renamed.channelId === channelId,
			);

			if (renameRecord) {
				const member = channel.members.get(userId);
				if (member) {
					await member.setNickname(
						renameRecord.scopedNickname,
						`Applied scoped nickname by channel owner ${currentOwner.userId}`,
					);
				}
			}
		} catch (error) {
			console.error(`🔸 Error applying nicknames to new joiner: ${error}`);
		}
	}

	async getRenamedUsers(channelId: string): Promise<RenamedUser[]> {
		try {
			const currentOwner = await this.getChannelOwner(channelId);
			if (!currentOwner) return [];

			const preferences = await this.getUserPreferences(
				currentOwner.userId,
				this.client.guilds.cache.get(channelId)?.id || "",
			);
			if (!preferences) return [];

			return preferences.renamedUsers.filter(
				(renamed) => renamed.channelId === channelId,
			);
		} catch (error) {
			console.error(`🔸 Error getting renamed users: ${error}`);
			return [];
		}
	}
}

export function voiceManager(client: Client): VoiceManager {
	return new VoiceManager(client);
}
