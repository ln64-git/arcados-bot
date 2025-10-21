import type { Client, VoiceState } from "discord.js";
import { v4 as uuidv4 } from "uuid";
import type { SurrealDBManager } from "../../database/SurrealDBManager";
import type { DatabaseResult, SurrealChannel } from "../../database/schema";
import { discordVoiceStateToSurreal } from "../../database/schema";

export class VoiceSessionTracker {
	private client: Client;
	private db: SurrealDBManager;
	private sessionStartTimes = new Map<string, Date>(); // user_id:guild_id -> Date
	private stateChangeTimers = new Map<string, NodeJS.Timeout>(); // user_id:guild_id -> Timer

	constructor(client: Client, db: SurrealDBManager) {
		this.client = client;
		this.db = db;
	}

	async initialize(): Promise<void> {
		console.log("🔹 Initializing Voice Session Tracker...");

		// Sync all voice channels (including empty ones)
		await this.syncAllVoiceChannels();

		// Sync current voice states from Discord
		await this.syncCurrentVoiceStates();

		// Setup event handlers
		this.setupVoiceStateHandlers();

		// Run initial reconciliation to fix any existing discrepancies
		await this.reconcileVoiceStates();

		// Start periodic reconciliation (every 5 minutes)
		setInterval(() => this.reconcileVoiceStates(), 5 * 60 * 1000);

		console.log("🔹 Voice Session Tracker initialized");
	}

	// Voice session tracking methods

	private async syncAllVoiceChannels(): Promise<void> {
		// Sync all voice channels (including empty ones) to the database
		for (const [_, guild] of this.client.guilds.cache) {
			console.log(`🔹 Syncing all voice channels for guild: ${guild.name}`);

			for (const [channelId, channel] of guild.channels.cache) {
				if (channel.isVoiceBased()) {
					console.log(`🔹 Syncing channel: ${channel.name} (${channelId})`);

					// Create or update channel record
					const channelData = {
						id: channelId,
						guild_id: guild.id,
						name: channel.name,
						type: channel.type.toString(),
						active: true,
						created_at: new Date(),
						updated_at: new Date(),
					};

					const result = await this.db.upsertChannel(channelData);
					if (!result.success) {
						console.error(
							`🔸 Failed to sync channel ${channel.name}:`,
							result.error,
						);
					}
				}
			}
		}
	}

	private async syncCurrentVoiceStates(): Promise<void> {
		// On startup, sync all current voice states from Discord
		for (const [_, guild] of this.client.guilds.cache) {
			console.log(`🔹 Syncing voice states for guild: ${guild.name}`);

			// Use voiceStates.cache instead of members.cache for better accuracy
			for (const [userId, voiceState] of guild.voiceStates.cache) {
				if (voiceState.channelId) {
					console.log(
						`🔹 Syncing existing voice state: ${userId} in ${voiceState.channel?.name}`,
					);
					await this.handleVoiceJoin(voiceState, null);
				}
			}
		}
	}

	private setupVoiceStateHandlers(): void {
		// Voice state handling is now managed by VoiceChannelManager
		// to prevent duplicate action creation
		// this.client.on("voiceStateUpdate", async (oldState, newState) => {
		// 	await this.handleVoiceStateUpdate(oldState, newState);
		// });
	}

	private async handleVoiceStateUpdate(
		oldState: VoiceState,
		newState: VoiceState,
	): Promise<void> {
		const user = oldState.member?.user || newState.member?.user;
		if (!user) return;

		const guildId = newState.guild.id;
		const userId = user.id;
		const key = `${userId}:${guildId}`;

		// Handle channel changes (join, leave, switch)
		if (oldState.channelId !== newState.channelId) {
			if (!oldState.channelId && newState.channelId) {
				// User joined voice channel
				await this.handleVoiceJoin(newState, oldState);
			} else if (oldState.channelId && !newState.channelId) {
				// User left voice channel
				await this.handleVoiceLeave(oldState, newState);
			} else if (oldState.channelId && newState.channelId) {
				// User switched channels
				await this.handleVoiceSwitch(oldState, newState);
			}
		} else {
			// User is in same channel but state changed (mute, deaf, streaming, etc.)
			await this.handleVoiceStateChange(oldState, newState);
		}
	}

	private async handleVoiceJoin(
		newState: VoiceState,
		oldState: VoiceState | null,
	): Promise<void> {
		const user = newState.member?.user;
		if (!user) return;

		const guildId = newState.guild.id;
		const userId = user.id;
		const channelId = newState.channelId;
		if (!channelId) return;

		console.log(
			`🔹 [VOICE_STATE] User ${user.username} joined voice channel ${channelId}`,
		);

		const sessionId = uuidv4();

		// Create new voice session
		await this.createVoiceSession({
			id: sessionId,
			guild_id: guildId,
			user_id: userId,
			channel_id: channelId,
			joined_at: new Date(),
			duration: 0,
			time_muted: 0,
			time_deafened: 0,
			time_streaming: 0,
			owner_at_join: undefined,
			is_grandfathered: false,
			applied_moderation: {},
			active: true,
		});

		// Update voice state
		const voiceStateData = discordVoiceStateToSurreal(newState);
		voiceStateData.id = `${guildId}_${userId}`;
		voiceStateData.session_id = sessionId;
		voiceStateData.joined_at = new Date();
		const result = await this.retryDatabaseOperation(() =>
			this.db.upsertVoiceState(voiceStateData),
		);
		if (!result.success) {
			console.error("🔸 Failed to upsert voice state (join):", result.error);
		}

		// Record history
		await this.recordVoiceHistory({
			guild_id: guildId,
			user_id: userId,
			channel_id: channelId,
			event_type: "join",
			self_mute: newState.selfMute || false,
			self_deaf: newState.selfDeaf || false,
			server_mute: newState.mute || false,
			server_deaf: newState.deaf || false,
			streaming: newState.streaming || false,
			self_video: newState.selfVideo || false,
			timestamp: new Date(),
		});

		// Track session start time
		this.sessionStartTimes.set(`${userId}:${guildId}`, new Date());
	}

	private async handleVoiceLeave(
		oldState: VoiceState,
		newState: VoiceState,
	): Promise<void> {
		const user = oldState.member?.user;
		if (!user) return;

		const guildId = oldState.guild.id;
		const userId = user.id;
		const channelId = oldState.channelId;
		if (!channelId) return;
		const key = `${userId}:${guildId}`;

		console.log(
			`🔹 [VOICE_STATE] User ${user.username} left voice channel ${channelId}`,
		);

		// End current session
		await this.endVoiceSession(userId, guildId);

		// Delete voice state record entirely (no longer tracking users not in voice)
		const voiceStateId = `${guildId}_${userId}`;
		const result = await this.db.deleteVoiceState(voiceStateId);
		if (!result.success) {
			console.error("🔸 Failed to delete voice state (leave):", result.error);
		}

		// Record history
		await this.recordVoiceHistory({
			guild_id: guildId,
			user_id: userId,
			event_type: "leave",
			from_channel_id: channelId,
			self_mute: oldState.selfMute || false,
			self_deaf: oldState.selfDeaf || false,
			server_mute: oldState.mute || false,
			server_deaf: oldState.deaf || false,
			streaming: oldState.streaming || false,
			self_video: oldState.selfVideo || false,
			timestamp: new Date(),
		});

		// Clear session tracking
		this.sessionStartTimes.delete(key);
		this.clearStateChangeTimer(key);
	}

	private async handleVoiceSwitch(
		oldState: VoiceState,
		newState: VoiceState,
	): Promise<void> {
		const user = newState.member?.user;
		if (!user) return;

		const guildId = newState.guild.id;
		const userId = user.id;
		const fromChannelId = oldState.channelId;
		const toChannelId = newState.channelId;
		if (!fromChannelId || !toChannelId) return;

		console.log(
			`🔹 [VOICE_STATE] User ${user.username} switched from ${fromChannelId} to ${toChannelId}`,
		);

		// Update current session
		const activeSessionResult = await this.db.getActiveVoiceSession(
			userId,
			guildId,
		);
		if (activeSessionResult.success && activeSessionResult.data) {
			const session = activeSessionResult.data;

			await this.db.updateVoiceSession(session.id, {
				channel_id: toChannelId,
			});
		}

		// Update voice state
		const voiceStateData = discordVoiceStateToSurreal(newState);
		voiceStateData.id = `${guildId}_${userId}`;
		const result = await this.retryDatabaseOperation(() =>
			this.db.upsertVoiceState(voiceStateData),
		);
		if (!result.success) {
			console.error("🔸 Failed to upsert voice state (switch):", result.error);
		}

		// Record history
		await this.recordVoiceHistory({
			guild_id: guildId,
			user_id: userId,
			channel_id: toChannelId,
			event_type: "switch",
			from_channel_id: fromChannelId,
			to_channel_id: toChannelId,
			self_mute: newState.selfMute || false,
			self_deaf: newState.selfDeaf || false,
			server_mute: newState.mute || false,
			server_deaf: newState.deaf || false,
			streaming: newState.streaming || false,
			self_video: newState.selfVideo || false,
			session_id: newState.sessionId,
			timestamp: new Date(),
		});
	}

	private async handleVoiceStateChange(
		oldState: VoiceState,
		newState: VoiceState,
	): Promise<void> {
		const user = newState.member?.user;
		if (!user) return;

		const guildId = newState.guild.id;
		const userId = user.id;
		const key = `${userId}:${guildId}`;

		// Check if any state actually changed
		const stateChanged =
			oldState.selfMute !== newState.selfMute ||
			oldState.selfDeaf !== newState.selfDeaf ||
			oldState.mute !== newState.mute ||
			oldState.deaf !== newState.deaf ||
			oldState.streaming !== newState.streaming ||
			oldState.selfVideo !== newState.selfVideo;

		if (!stateChanged) return;

		console.log(
			`🔹 ${user.username} changed voice state in ${newState.channel?.name} (channel: ${newState.channelId})`,
		);

		// Update voice state
		const voiceStateData = discordVoiceStateToSurreal(newState);
		voiceStateData.id = `${guildId}_${userId}`; // Use underscore instead of colon
		const result = await this.retryDatabaseOperation(() =>
			this.db.upsertVoiceState(voiceStateData),
		);
		if (!result.success) {
			console.error(
				"🔸 Failed to upsert voice state (state_change):",
				result.error,
			);
		}

		// Record history
		await this.recordVoiceHistory({
			guild_id: guildId,
			user_id: userId,
			channel_id: newState.channelId,
			event_type: "state_change",
			// Omit from_channel_id, to_channel_id, session_id, session_duration for state changes
			self_mute: newState.selfMute || false,
			self_deaf: newState.selfDeaf || false,
			server_mute: newState.mute || false,
			server_deaf: newState.deaf || false,
			streaming: newState.streaming || false,
			self_video: newState.selfVideo || false,
			timestamp: new Date(),
		});

		// Update session analytics with debounced timer
		this.updateSessionAnalyticsDebounced(key, newState);
	}

	private updateSessionAnalyticsDebounced(
		key: string,
		voiceState: VoiceState,
	): void {
		// Clear existing timer
		this.clearStateChangeTimer(key);

		// Set new timer to update analytics after 5 seconds of no changes
		const timer = setTimeout(async () => {
			await this.updateSessionAnalytics(voiceState);
			this.stateChangeTimers.delete(key);
		}, 5000);

		this.stateChangeTimers.set(key, timer);
	}

	private async updateSessionAnalytics(voiceState: VoiceState): Promise<void> {
		const user = voiceState.member?.user;
		if (!user) return;

		const guildId = voiceState.guild.id;
		const userId = user.id;

		const activeSessionResult = await this.db.getActiveVoiceSession(
			userId,
			guildId,
		);
		if (!activeSessionResult.success || !activeSessionResult.data) return;

		const session = activeSessionResult.data;
		const sessionStart = this.sessionStartTimes.get(`${userId}:${guildId}`);
		if (!sessionStart) return;

		const now = new Date();
		const totalDuration = Math.floor(
			(now.getTime() - sessionStart.getTime()) / 1000,
		);

		// Calculate time spent in each state (simplified - assumes current state for entire duration)
		const timeMuted =
			voiceState.selfMute || voiceState.mute ? totalDuration : 0;
		const timeDeafened =
			voiceState.selfDeaf || voiceState.deaf ? totalDuration : 0;
		const timeStreaming = voiceState.streaming ? totalDuration : 0;

		await this.db.updateVoiceSession(session.id, {
			duration: totalDuration,
			time_muted: timeMuted,
			time_deafened: timeDeafened,
			time_streaming: timeStreaming,
		});
	}

	private async createVoiceSession(
		sessionData: Record<string, unknown>,
	): Promise<void> {
		const result = await this.db.createVoiceSession(sessionData);
		if (!result.success) {
			console.error("🔸 Failed to create voice session:", result.error);
		}
	}

	private async endVoiceSession(
		userId: string,
		guildId: string,
	): Promise<void> {
		const activeSessionResult = await this.db.getActiveVoiceSession(
			userId,
			guildId,
		);
		if (!activeSessionResult.success || !activeSessionResult.data) return;

		const session = activeSessionResult.data;
		const sessionStart = this.sessionStartTimes.get(`${userId}:${guildId}`);
		const now = new Date();
		const duration = sessionStart
			? Math.floor((now.getTime() - sessionStart.getTime()) / 1000)
			: 0;

		await this.db.updateVoiceSession(session.id, {
			left_at: now,
			duration: duration,
			active: false,
		});
	}

	private async recordVoiceHistory(
		historyData: Record<string, unknown>,
	): Promise<void> {
		const result = await this.db.createVoiceHistory(historyData);
		if (!result.success) {
			console.error("🔸 Failed to record voice history:", result.error);
		}
	}

	private clearStateChangeTimer(key: string): void {
		const timer = this.stateChangeTimers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.stateChangeTimers.delete(key);
		}
	}

	async endAllActiveSessions(): Promise<void> {
		console.log("🔹 Ending all active voice sessions...");

		for (const [key, _] of this.sessionStartTimes) {
			const [userId, guildId] = key.split(":");
			if (userId && guildId) {
				await this.endVoiceSession(userId, guildId);
			}
		}

		// Clear all timers
		for (const [key, timer] of this.stateChangeTimers) {
			clearTimeout(timer);
		}
		this.stateChangeTimers.clear();
		this.sessionStartTimes.clear();
	}

	private async retryDatabaseOperation<T>(
		operation: () => Promise<DatabaseResult<T>>,
		maxRetries = 3,
	): Promise<DatabaseResult<T>> {
		for (let i = 0; i < maxRetries; i++) {
			const result = await operation();
			if (result.success) return result;

			if (i < maxRetries - 1) {
				await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
			}
		}
		return { success: false, error: "Max retries exceeded" };
	}

	private async reconcileVoiceStates(): Promise<void> {
		console.log("🔹 Starting voice state reconciliation...");

		for (const guild of this.client.guilds.cache.values()) {
			try {
				// Get Discord truth
				const discordStates = new Map<string, string>(); // userId -> channelId
				for (const [userId, voiceState] of guild.voiceStates.cache) {
					if (voiceState.channelId) {
						discordStates.set(userId, voiceState.channelId);
					}
				}

				// Get DB states
				const dbResult = await this.db.getActiveVoiceStates(guild.id);
				if (!dbResult.success) {
					console.error(
						`🔸 Failed to get DB states for ${guild.name}:`,
						dbResult.error,
					);
					continue;
				}

				const dbStates = new Map<string, string>();
				for (const state of dbResult.data || []) {
					if (state.channel_id) {
						dbStates.set(state.user_id, state.channel_id);
					}
				}

				// Find and fix discrepancies
				let fixedCount = 0;

				// 1. Users in Discord but missing/wrong in DB
				for (const [userId, channelId] of discordStates) {
					if (!dbStates.has(userId) || dbStates.get(userId) !== channelId) {
						console.log(
							`🔹 Fixing missing/wrong state: ${userId} should be in ${channelId}`,
						);
						const voiceState = guild.voiceStates.cache.get(userId);
						if (voiceState) {
							await this.handleVoiceJoin(voiceState, null);
							fixedCount++;
						}
					}
				}

				// 2. Users in DB but not in Discord (stale data)
				for (const [userId, _] of dbStates) {
					if (!discordStates.has(userId)) {
						console.log(`🔹 Removing stale state: ${userId} not in Discord`);
						await this.db.deleteVoiceState(`${guild.id}_${userId}`);
						fixedCount++;
					}
				}

				if (fixedCount > 0) {
					console.log(
						`🔹 Reconciliation complete for ${guild.name}: ${fixedCount} fixes applied`,
					);
				}
			} catch (error) {
				console.error(`🔸 Reconciliation error for ${guild.name}:`, error);
			}
		}
	}
}
