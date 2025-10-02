import type { Client, VoiceState } from "discord.js";
import type { VoiceSession } from "../../types/database.js";
import type { DatabaseCore } from "../database-manager/DatabaseCore.js";

export class VCLogsWatcher {
	private client: Client;
	private dbCore: DatabaseCore;
	private vcLogsChannelId: string;
	private isWatching = false;

	constructor(client: Client, dbCore: DatabaseCore, vcLogsChannelId: string) {
		this.client = client;
		this.dbCore = dbCore;
		this.vcLogsChannelId = vcLogsChannelId;
	}

	async startWatching(): Promise<void> {
		if (this.isWatching) {
			console.log("🔸 VC Logs Watcher is already running");
			return;
		}

		console.log(
			"🔍 Starting VC Logs Watcher for channel",
			this.vcLogsChannelId,
		);

		// Listen for voice state updates
		this.client.on("voiceStateUpdate", async (oldState, newState) => {
			await this.handleVoiceStateUpdate(oldState, newState);
		});

		this.isWatching = true;
		console.log("✅ VC Logs Watcher started successfully");
	}

	async stopWatching(): Promise<void> {
		if (!this.isWatching) {
			console.log("🔸 VC Logs Watcher is not running");
			return;
		}

		// Remove the event listener
		this.client.removeAllListeners("voiceStateUpdate");
		this.isWatching = false;
		console.log("✅ VC Logs Watcher stopped");
	}

	private async handleVoiceStateUpdate(
		oldState: VoiceState,
		newState: VoiceState,
	): Promise<void> {
		try {
			// Only process updates for the VC logs channel
			if (
				newState.channelId !== this.vcLogsChannelId &&
				oldState.channelId !== this.vcLogsChannelId
			) {
				return;
			}

			// Skip bots
			if (newState.member?.user.bot) {
				return;
			}

			const userId = newState.member?.id;
			const guildId = newState.guild.id;

			if (!userId) {
				return;
			}

			// User joined the VC logs channel
			if (!oldState.channelId && newState.channelId === this.vcLogsChannelId) {
				await this.handleUserJoined(userId, guildId, newState);
			}
			// User left the VC logs channel
			else if (
				oldState.channelId === this.vcLogsChannelId &&
				!newState.channelId
			) {
				await this.handleUserLeft(userId, guildId, oldState);
			}
			// User moved from VC logs channel to another channel
			else if (
				oldState.channelId === this.vcLogsChannelId &&
				newState.channelId !== this.vcLogsChannelId
			) {
				await this.handleUserLeft(userId, guildId, oldState);
			}
			// User moved from another channel to VC logs channel
			else if (
				oldState.channelId !== this.vcLogsChannelId &&
				newState.channelId === this.vcLogsChannelId
			) {
				await this.handleUserJoined(userId, guildId, newState);
			}
		} catch (error) {
			console.log("🔸 Error in VC Logs Watcher:", error);
		}
	}

	private async handleUserJoined(
		userId: string,
		guildId: string,
		newState: VoiceState,
	): Promise<void> {
		try {
			console.log(`🔹 VC Logs: User ${userId} joined`);

			// Close any existing active sessions for this user in this channel
			await this.closeExistingSessions(userId, guildId);

			// Create new voice session
			const session: Omit<VoiceSession, "_id" | "createdAt" | "updatedAt"> = {
				userId,
				guildId,
				channelId: this.vcLogsChannelId,
				channelName: newState.channel?.name || "VC Logs",
				displayName:
					newState.member?.displayName ||
					newState.member?.user.username ||
					"Unknown User",
				joinedAt: new Date(),
			};

			await this.dbCore.createVoiceSession(session);
			console.log(`✅ VC Logs: Created voice session for ${userId}`);
		} catch (error) {
			console.log("🔸 Error handling user join in VC Logs:", error);
		}
	}

	private async handleUserLeft(
		userId: string,
		guildId: string,
		oldState: VoiceState,
	): Promise<void> {
		try {
			console.log(`🔹 VC Logs: User ${userId} left`);

			// Update the voice session to mark as left
			const leftAt = new Date();
			await this.dbCore.updateVoiceSession(
				userId,
				guildId,
				leftAt,
				this.vcLogsChannelId,
			);

			console.log(`✅ VC Logs: Updated voice session for ${userId}`);
		} catch (error) {
			console.log("🔸 Error handling user leave in VC Logs:", error);
		}
	}

	private async closeExistingSessions(
		userId: string,
		guildId: string,
	): Promise<void> {
		try {
			// Get all active sessions for this user in this channel
			const activeSessions = await this.dbCore.getActiveVoiceSessionsByUser(
				userId,
				guildId,
			);
			const channelSessions = activeSessions.filter(
				(s) => s.channelId === this.vcLogsChannelId,
			);

			if (channelSessions.length > 0) {
				console.log(
					`🔹 VC Logs: Closing ${channelSessions.length} existing sessions for ${userId}`,
				);

				// Close each active session
				for (const session of channelSessions) {
					const leftAt = new Date();
					await this.dbCore.updateVoiceSession(
						userId,
						guildId,
						leftAt,
						session.channelId,
					);
				}
			}
		} catch (error) {
			console.log("🔸 Error closing existing sessions:", error);
		}
	}

	async getCurrentSessions(): Promise<VoiceSession[]> {
		try {
			return await this.dbCore.getActiveVoiceSessionsByUser(
				"",
				this.client.guilds.cache.first()?.id || "",
			);
		} catch (error) {
			console.log("🔸 Error getting current sessions:", error);
			return [];
		}
	}
}
