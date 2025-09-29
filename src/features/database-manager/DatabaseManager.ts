import type { Client, Guild } from "discord.js";
import { config } from "../../config";
import type {
	Message as DBMessage,
	Role,
	User,
	UserInteraction,
	VoiceSession,
} from "../../types/database";
import { DatabaseCore } from "./DatabaseCore";
import { GuildSyncEngine } from "./GuildSyncEngine";
import { RealtimeTracker } from "./RealtimeTracker";

export class DatabaseManager {
	private client: Client;
	private core: DatabaseCore;
	private tracker: RealtimeTracker;
	private syncer: GuildSyncEngine;
	private watchInterval: NodeJS.Timeout | null = null;
	private isWatching: boolean = false;

	constructor(client: Client) {
		this.client = client;
		this.core = new DatabaseCore();
		this.tracker = new RealtimeTracker(this.core);
		this.syncer = new GuildSyncEngine(this.core);
	}

	// ==================== INITIALIZATION ====================

	async initialize(): Promise<void> {
		// Initialize core database
		await this.core.initialize();

		// Set up real-time tracking
		this.tracker.setupEventHandlers(this.client);

		// Start autonomous watching
		await this.startAutonomousWatching();
	}

	// ==================== AUTONOMOUS WATCHING ====================

	private async startAutonomousWatching(): Promise<void> {
		if (this.isWatching) {
			return;
		}

		this.isWatching = true;

		// Initial health check and sync
		await this.performAutonomousHealthCheck();

		// Set up periodic health checks (every 5 minutes)
		this.watchInterval = setInterval(
			async () => {
				await this.performAutonomousHealthCheck();
			},
			5 * 60 * 1000, // 5 minutes
		);
	}

	private async performAutonomousHealthCheck(): Promise<void> {
		try {
			const guild = await this.getTargetGuild();
			if (!guild) {
				console.warn("⚠️ No target guild found for autonomous health check");
				return;
			}

			// Perform health check
			const healthCheck = await this.performDatabaseHealthCheck(guild);

			// If unhealthy, perform auto-sync
			if (!healthCheck.isHealthy) {
				console.log(`🔧 Database unhealthy, performing autonomous sync...`);
				const autoSyncResult = await this.performAutoSync(guild);

				if (autoSyncResult.performed) {
					console.log(`✅ Autonomous sync completed: ${autoSyncResult.reason}`);
				} else {
					console.log(`ℹ️ Autonomous sync not needed: ${autoSyncResult.reason}`);
				}
			}

			// Perform periodic maintenance (every 30 minutes)
			const now = new Date();
			if (now.getMinutes() % 30 === 0) {
				console.log(`🔧 Performing periodic database maintenance...`);
				await this.performDatabaseMaintenance(guild.id);
			}
		} catch (error) {
			console.error("🔸 Error during autonomous health check:", error);
		}
	}

	// ==================== PUBLIC API METHODS ====================

	// Delegate to core for basic operations
	async getUser(discordId: string, guildId: string) {
		return this.core.getUser(discordId, guildId);
	}

	async getUsersByGuild(guildId: string) {
		return this.core.getUsersByGuild(guildId);
	}

	async upsertUser(user: Omit<User, "_id" | "createdAt" | "updatedAt">) {
		return this.core.upsertUser(user);
	}

	async getRolesByGuild(guildId: string) {
		return this.core.getRolesByGuild(guildId);
	}

	async upsertRole(role: Omit<Role, "_id" | "createdAt" | "updatedAt">) {
		return this.core.upsertRole(role);
	}

	async getMessagesByGuild(guildId: string, limit: number = 100) {
		return this.core.getMessagesByGuild(guildId, limit);
	}

	async getMessagesByChannel(
		guildId: string,
		channelName: string,
		limit: number = 100,
	) {
		return this.core.getMessagesByChannel(guildId, channelName, limit);
	}

	async getRecentMessagesWithUsers(guildId: string, limit: number = 20) {
		return this.core.getRecentMessagesWithUsers(guildId, limit);
	}

	async getOldestMessagesWithUsers(guildId: string, limit: number = 20) {
		return this.core.getOldestMessagesWithUsers(guildId, limit);
	}

	async batchInsertMessages(
		messages: Omit<DBMessage, "_id" | "createdAt" | "updatedAt">[],
	) {
		return this.core.batchInsertMessages(messages);
	}

	async getVoiceSessionsByUser(userId: string, guildId: string) {
		return this.core.getVoiceSessionsByUser(userId, guildId);
	}

	async getVoiceSessionsByGuild(guildId: string) {
		return this.core.getVoiceSessionsByGuild(guildId);
	}

	async createVoiceSession(
		session: Omit<VoiceSession, "_id" | "createdAt" | "updatedAt">,
	) {
		return this.core.createVoiceSession(session);
	}

	async updateVoiceSession(userId: string, guildId: string, leftAt: Date) {
		return this.core.updateVoiceSession(userId, guildId, leftAt);
	}

	async recordInteraction(
		interaction: Omit<UserInteraction, "_id" | "createdAt">,
	) {
		return this.core.recordInteraction(interaction);
	}

	async getUserInteractions(
		fromUserId: string,
		toUserId: string,
		guildId: string,
	) {
		return this.core.getUserInteractions(fromUserId, toUserId, guildId);
	}

	async getGuildStats(guildId: string) {
		return this.core.getGuildStats(guildId);
	}

	// Delegate to syncer for sync operations
	async checkGuildSyncStatus(guildId: string) {
		return this.syncer.checkGuildSyncStatus(guildId);
	}

	async syncGuild(
		guild: Guild,
		forceFullSync: boolean = false,
		messageLimit: number = 1000,
	) {
		return this.syncer.syncGuild(guild, forceFullSync, messageLimit);
	}

	// Delegate to tracker for real-time operations
	getActiveVoiceSessions() {
		return this.tracker.getActiveVoiceSessions();
	}

	async cleanupActiveSessions() {
		return this.tracker.cleanupActiveSessions();
	}

	// ==================== UTILITY METHODS ====================

	private async getTargetGuild(): Promise<Guild | null> {
		if (config.guildId) {
			const guild = this.client.guilds.cache.get(config.guildId);
			if (!guild) {
				console.warn(`⚠️ Guild ${config.guildId} not found`);
				return null;
			}
			return guild;
		} else {
			// Look for Arcados guild specifically, or use first available guild
			const guild =
				this.client.guilds.cache.find((g) => g.name === "Arcados") ||
				this.client.guilds.cache.first();
			if (!guild) {
				console.warn(`⚠️ No guilds found for database operations`);
				return null;
			}
			console.log(
				`🔹 No GUILD_ID configured, using guild: ${guild.name} (${guild.id})`,
			);
			return guild;
		}
	}

	private async performDatabaseHealthCheck(guild: Guild): Promise<{
		isHealthy: boolean;
		syncStatus: {
			isSynced: boolean;
			lastSync?: Date;
			needsFullSync: boolean;
			stats: {
				totalUsers: number;
				totalMessages: number;
				totalRoles: number;
				totalVoiceSessions: number;
			};
		};
		recommendations: string[];
		stats: {
			totalUsers: number;
			totalMessages: number;
			totalRoles: number;
			totalVoiceSessions: number;
		};
	}> {
		try {
			const syncStatus = await this.checkGuildSyncStatus(guild.id);
			const stats = await this.getGuildStats(guild.id);

			// Get actual Discord data for comparison
			const discordUsers = guild.memberCount;
			const discordRoles = guild.roles.cache.size;

			// Calculate sync percentages
			const userSyncPercent =
				stats.totalUsers > 0
					? Math.round((stats.totalUsers / discordUsers) * 100)
					: 0;
			const roleSyncPercent =
				stats.totalRoles > 0
					? Math.round((stats.totalRoles / discordRoles) * 100)
					: 0;

			// Determine health status
			const isHealthy =
				syncStatus.isSynced && userSyncPercent >= 95 && roleSyncPercent >= 95;

			// Generate recommendations
			const recommendations: string[] = [];
			if (userSyncPercent < 95)
				recommendations.push(`Users sync: ${userSyncPercent}% (needs refresh)`);
			if (roleSyncPercent < 95)
				recommendations.push(`Roles sync: ${roleSyncPercent}% (needs refresh)`);
			if (stats.totalMessages === 0) recommendations.push(`No messages synced`);
			if (stats.totalVoiceSessions === 0)
				recommendations.push(`No voice sessions tracked`);

			return {
				isHealthy,
				syncStatus,
				recommendations,
				stats,
			};
		} catch (error) {
			console.error("🔸 Error during database health check:", error);
			return {
				isHealthy: false,
				syncStatus: {
					isSynced: false,
					needsFullSync: true,
					stats: {
						totalUsers: 0,
						totalMessages: 0,
						totalRoles: 0,
						totalVoiceSessions: 0,
					},
				},
				recommendations: [`Health check failed: ${error}`],
				stats: {
					totalUsers: 0,
					totalMessages: 0,
					totalRoles: 0,
					totalVoiceSessions: 0,
				},
			};
		}
	}

	private async performAutoSync(guild: Guild): Promise<{
		performed: boolean;
		reason: string;
		result?: {
			success: boolean;
			syncedUsers: number;
			syncedRoles: number;
			syncedMessages: number;
			errors: string[];
		};
	}> {
		try {
			const healthCheck = await this.performDatabaseHealthCheck(guild);

			// Determine if sync is needed
			const needsSync =
				healthCheck.syncStatus?.needsFullSync ||
				healthCheck.syncStatus?.stats.totalUsers === 0 ||
				healthCheck.syncStatus?.stats.totalMessages === 0 ||
				healthCheck.recommendations.some((rec) =>
					rec.includes("needs refresh"),
				);

			if (!needsSync) {
				return {
					performed: false,
					reason: "Database is healthy, no sync needed",
				};
			}

			console.log(
				`🔧 Auto-sync triggered: ${healthCheck.recommendations.join(", ")}`,
			);
			const result = await this.syncGuild(guild, true);

			return {
				performed: true,
				reason: `Auto-sync triggered due to: ${healthCheck.recommendations.join(", ")}`,
				result,
			};
		} catch (error) {
			console.error("🔸 Error during auto-sync:", error);
			return {
				performed: false,
				reason: `Auto-sync failed: ${error}`,
			};
		}
	}

	private async performDatabaseMaintenance(guildId: string): Promise<{
		success: boolean;
		operations: string[];
		errors: string[];
	}> {
		const operations: string[] = [];
		const errors: string[] = [];

		try {
			console.log(`🔧 Performing database maintenance for guild: ${guildId}`);

			// Cleanup active sessions
			await this.cleanupActiveSessions();
			operations.push("Cleaned up active voice sessions");

			// Get updated stats
			const stats = await this.getGuildStats(guildId);
			operations.push(
				`Updated stats: ${stats.totalUsers} users, ${stats.totalMessages} messages, ${stats.totalRoles} roles, ${stats.totalVoiceSessions} voice sessions`,
			);

			const success = errors.length === 0;
			console.log(
				`🔧 Database maintenance ${success ? "completed successfully" : "completed with errors"}`,
			);

			return { success, operations, errors };
		} catch (error) {
			console.error("🔸 Database maintenance failed:", error);
			return {
				success: false,
				operations,
				errors: [...errors, `Maintenance failed: ${error}`],
			};
		}
	}

	// ==================== CLEANUP ====================

	async cleanup(): Promise<void> {
		// Stop autonomous watching
		if (this.watchInterval) {
			clearInterval(this.watchInterval);
			this.watchInterval = null;
		}
		this.isWatching = false;

		// Cleanup active sessions
		await this.cleanupActiveSessions();
	}
}
