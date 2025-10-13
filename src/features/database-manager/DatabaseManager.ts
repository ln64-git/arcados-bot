import type { Client, Guild } from "discord.js";
import { config } from "../../config";
import type {
	AvatarHistory,
	Message as DBMessage,
	ModPreferences,
	RenamedUser,
	Role,
	User,
	UserStatus,
	VoiceSession,
} from "../../types/database";
import { GuildSyncEngine } from "./GuildSyncEngine";
import { MigrationManager } from "./MigrationManager";
import { DatabaseCore } from "./PostgresCore";

export class DatabaseManager {
	private client: Client;
	private core: DatabaseCore;
	private syncer: GuildSyncEngine;
	private migrationManager: MigrationManager;
	private watchInterval: NodeJS.Timeout | null = null;
	private isWatching = false;

	constructor(client: Client) {
		this.client = client;
		this.core = new DatabaseCore();
		this.syncer = new GuildSyncEngine(this.core);
		this.migrationManager = new MigrationManager();
	}

	// ==================== INITIALIZATION ====================

	async initialize(): Promise<void> {
		// Initialize core database
		await this.core.initialize();

		// Initialize migration manager
		await this.migrationManager.initialize();

		// Check if migration is needed
		const needsMigration = await this.migrationManager.isMigrationNeeded();
		if (needsMigration) {
			console.log("🔧 Database migration needed, running migration...");
			const migrationResult =
				await this.migrationManager.migrateUserPreferencesToUsers();
			if (migrationResult.success) {
				console.log(
					`✅ Migration completed: ${migrationResult.migratedUsers} users, ${migrationResult.migratedPreferences} preferences`,
				);
				// Clean up old collections after successful migration
				await this.migrationManager.cleanupOldCollections();
			} else {
				console.error("🔸 Migration failed:", migrationResult.errors);
			}
		}

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
				console.log("🔧 Database unhealthy, performing autonomous sync...");
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
				console.log("🔧 Performing periodic database maintenance...");
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

	async getMessagesByGuild(guildId: string, limit = 100) {
		return this.core.getMessagesByGuild(guildId, limit);
	}

	async getMessagesByChannel(
		guildId: string,
		channelName: string,
		limit = 100,
	) {
		return this.core.getMessagesByChannel(guildId, channelName, limit);
	}

	async getRecentMessagesWithUsers(guildId: string, limit = 20) {
		return this.core.getRecentMessagesWithUsers(guildId, limit);
	}

	async getOldestMessagesWithUsers(guildId: string, limit = 20) {
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

	async getActiveVoiceDurations(channelId: string, guildId: string) {
		return this.core.getActiveVoiceDurations(channelId, guildId);
	}

	async restoreMemberRoles(member: import("discord.js").GuildMember) {
		return this.core.restoreMemberRoles(member);
	}

	async getGuildStats(guildId: string) {
		return this.core.getGuildStats(guildId);
	}

	async cleanupStaleVoiceSessions() {
		return this.core.cleanupStaleVoiceSessions();
	}

	// ==================== MODERATION PREFERENCES METHODS ====================

	async getModPreferences(userId: string) {
		return this.core.getModPreferences(userId);
	}

	async updateModPreferences(
		userId: string,
		preferences: Partial<ModPreferences>,
	) {
		return this.core.updateModPreferences(userId, preferences);
	}

	async addUserToModerationList(
		ownerId: string,
		guildId: string,
		listType: "bannedUsers" | "mutedUsers" | "kickedUsers" | "deafenedUsers",
		targetUserId: string,
	) {
		return this.core.addUserToModerationList(
			ownerId,
			guildId,
			listType,
			targetUserId,
		);
	}

	async removeUserFromModerationList(
		ownerId: string,
		guildId: string,
		listType: "bannedUsers" | "mutedUsers" | "kickedUsers" | "deafenedUsers",
		targetUserId: string,
	) {
		return this.core.removeUserFromModerationList(
			ownerId,
			guildId,
			listType,
			targetUserId,
		);
	}

	async addRenamedUser(
		ownerId: string,
		guildId: string,
		renamedUser: RenamedUser,
	) {
		return this.core.addRenamedUser(ownerId, guildId, renamedUser);
	}

	async removeRenamedUser(
		ownerId: string,
		guildId: string,
		targetUserId: string,
	) {
		return this.core.removeRenamedUser(ownerId, guildId, targetUserId);
	}

	async isUserInModerationList(
		ownerId: string,
		guildId: string,
		listType: "bannedUsers" | "mutedUsers" | "kickedUsers" | "deafenedUsers",
		targetUserId: string,
	) {
		return this.core.isUserInModerationList(
			ownerId,
			guildId,
			listType,
			targetUserId,
		);
	}

	async getUsersInModerationList(
		ownerId: string,
		guildId: string,
		listType: "bannedUsers" | "mutedUsers" | "kickedUsers" | "deafenedUsers",
	) {
		return this.core.getUsersInModerationList(ownerId, guildId, listType);
	}

	// ==================== AVATAR AND STATUS TRACKING METHODS ====================

	async trackAvatarChange(
		userId: string,
		newAvatarUrl: string,
		avatarHash?: string,
	) {
		return this.core.trackAvatarChange(userId, newAvatarUrl, avatarHash);
	}

	async trackStatusChange(userId: string, newStatus: string) {
		return this.core.trackStatusChange(userId, newStatus);
	}

	async getAvatarHistory(userId: string) {
		return this.core.getAvatarHistory(userId);
	}

	async getStatusHistory(userId: string) {
		return this.core.getStatusHistory(userId);
	}

	async getCurrentStatus(userId: string) {
		return this.core.getCurrentStatus(userId);
	}

	async cleanupUserHistory(userId: string) {
		return this.core.cleanupUserHistory(userId);
	}

	async getAvatarAsBase64(userId: string, avatarIndex = 0) {
		return this.core.getAvatarAsBase64(userId, avatarIndex);
	}

	async getStorageStats() {
		return this.core.getStorageStats();
	}

	async cleanupOrphanedImages() {
		return this.core.cleanupOrphanedImages();
	}

	// ==================== MIGRATION METHODS ====================

	async getMigrationStatus() {
		return this.migrationManager.getMigrationStatus();
	}

	async runMigration() {
		return this.migrationManager.migrateUserPreferencesToUsers();
	}

	async cleanupOldCollections() {
		return this.migrationManager.cleanupOldCollections();
	}

	// Delegate to syncer for sync operations
	async checkGuildSyncStatus(guildId: string) {
		return this.syncer.checkGuildSyncStatus(guildId);
	}

	async syncGuild(guild: Guild, forceFullSync = false, messageLimit = 1000) {
		return this.syncer.syncGuild(guild, forceFullSync, messageLimit);
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
		}
		// Look for Arcados guild specifically, or use first available guild
		const guild =
			this.client.guilds.cache.find((g) => g.name === "Arcados") ||
			this.client.guilds.cache.first();
		if (!guild) {
			console.warn("⚠️ No guilds found for database operations");
			return null;
		}
		console.log(
			`🔹 No GUILD_ID configured, using guild: ${guild.name} (${guild.id})`,
		);
		return guild;
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

			// Calculate sync percentages using actual database stats
			const userSyncPercent =
				stats.totalUsers > 0
					? Math.round((stats.totalUsers / discordUsers) * 100)
					: 0;
			const roleSyncPercent =
				stats.totalRoles > 0
					? Math.round((stats.totalRoles / discordRoles) * 100)
					: 0;

			// Determine health status based on actual data
			const isHealthy =
				syncStatus.isSynced && userSyncPercent >= 95 && roleSyncPercent >= 95;

			// Generate recommendations based on actual database stats
			const recommendations: string[] = [];
			if (userSyncPercent < 95)
				recommendations.push(`Users sync: ${userSyncPercent}% (needs refresh)`);
			if (roleSyncPercent < 95)
				recommendations.push(`Roles sync: ${roleSyncPercent}% (needs refresh)`);
			if (stats.totalMessages === 0) recommendations.push("No messages synced");
			if (stats.totalVoiceSessions === 0)
				recommendations.push("No voice sessions tracked");

			// Check if sync record is stale (actual counts differ from sync record)
			if (
				syncStatus.stats.totalUsers !== stats.totalUsers ||
				syncStatus.stats.totalMessages !== stats.totalMessages ||
				syncStatus.stats.totalRoles !== stats.totalRoles
			) {
				recommendations.push("Sync record is stale (needs refresh)");
			}

			// Update sync status with actual stats to fix stale data
			const updatedSyncStatus = {
				...syncStatus,
				stats: {
					totalUsers: stats.totalUsers,
					totalMessages: stats.totalMessages,
					totalRoles: stats.totalRoles,
					totalVoiceSessions: stats.totalVoiceSessions,
				},
			};

			return {
				isHealthy,
				syncStatus: updatedSyncStatus,
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

	async cleanupActiveSessions(): Promise<void> {
		try {
			console.log("🔧 Cleaning up active voice sessions...");

			// Get all active voice channel sessions
			const activeSessions =
				await this.postgresCore.getActiveVoiceChannelSessions();

			let cleanedCount = 0;

			for (const session of activeSessions) {
				// Check if the user is actually in the voice channel
				const channel = this.client.channels.cache.get(session.channel_id);

				if (!channel || !channel.isVoiceBased()) {
					// Channel doesn't exist or isn't a voice channel, mark session as ended
					await this.postgresCore.endVoiceChannelSession(
						session.user_id,
						session.channel_id,
						new Date(),
					);
					cleanedCount++;
					continue;
				}

				// Check if user is actually in the channel
				const member = channel.members.get(session.user_id);
				if (!member) {
					// User is not in the channel, mark session as ended
					await this.postgresCore.endVoiceChannelSession(
						session.user_id,
						session.channel_id,
						new Date(),
					);
					cleanedCount++;
				}
			}

			if (cleanedCount > 0) {
				console.log(`🔧 Cleaned up ${cleanedCount} stale voice sessions`);
			} else {
				console.log("🔧 No stale voice sessions found");
			}
		} catch (error) {
			console.error("🔸 Failed to cleanup active sessions:", error);
		}
	}

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
