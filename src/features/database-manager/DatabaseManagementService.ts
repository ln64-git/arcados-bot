import { type Client, type Guild, Message } from "discord.js";
import { config } from "./../../config/index";
import type {
	Message as DBMessage,
	Role,
	User,
	UserInteraction,
	VoiceSession,
} from "../../types/database";
import { DatabaseService } from "./DatabaseService";
import { GuildSyncService } from "./GuildSyncService";
import { RealtimeTrackingService } from "./RealtimeTrackingService";

export class DatabaseManagementService {
	private client: Client;
	private dbService: DatabaseService;
	private guildSyncService: GuildSyncService;
	private trackingService: RealtimeTrackingService;
	private watchInterval: NodeJS.Timeout | null = null;
	private isWatching: boolean = false;

	constructor(client: Client) {
		this.client = client;
		this.dbService = new DatabaseService();
		this.guildSyncService = new GuildSyncService(this.dbService);
		this.trackingService = new RealtimeTrackingService(this.dbService);
	}

	/**
	 * Initialize the database management service and start autonomous watching
	 */
	async initialize(): Promise<void> {
		console.log("🔹 Initializing autonomous database management service...");

		// Initialize database first
		await this.dbService.initialize();
		console.log("🔹 Database service initialized");

		// Set up Discord event handlers for real-time tracking
		this.setupRealtimeTracking();

		// Start autonomous database watching
		await this.startAutonomousWatching();

		console.log(
			"🔹 Autonomous database management service initialized and watching",
		);
	}

	/**
	 * Set up real-time tracking event handlers
	 */
	private setupRealtimeTracking(): void {
		// Message events
		this.client.on("messageCreate", async (message) => {
			await this.trackingService.trackMessage(message);
		});

		this.client.on("messageUpdate", async (_, newMessage) => {
			if (newMessage instanceof Message) {
				await this.trackingService.trackMessageUpdate(newMessage);
			}
		});

		this.client.on("messageDelete", async (message) => {
			await this.trackingService.trackMessageDelete(message);
		});

		// Reaction events
		this.client.on("messageReactionAdd", async (reaction, user) => {
			if (reaction.partial) {
				try {
					await reaction.fetch();
				} catch (error) {
					console.error("🔸 Error fetching reaction:", error);
					return;
				}
			}
			await this.trackingService.trackReactionAdd(reaction, user);
		});

		this.client.on("messageReactionRemove", async (reaction, user) => {
			if (reaction.partial) {
				try {
					await reaction.fetch();
				} catch (error) {
					console.error("🔸 Error fetching reaction:", error);
					return;
				}
			}
			await this.trackingService.trackReactionRemove(reaction, user);
		});

		// Voice state events
		this.client.on("voiceStateUpdate", async (oldState, newState) => {
			await this.trackingService.trackVoiceStateUpdate(oldState, newState);
		});

		// Guild member events
		this.client.on("guildMemberUpdate", async (_, newMember) => {
			if (newMember.partial) {
				try {
					await newMember.fetch();
				} catch (error) {
					console.error("🔸 Error fetching member:", error);
					return;
				}
			}
			await this.trackingService.trackGuildMemberUpdate(newMember);
		});
	}

	/**
	 * Start autonomous database watching and maintenance
	 */
	private async startAutonomousWatching(): Promise<void> {
		if (this.isWatching) {
			console.log("🔹 Database watching already active");
			return;
		}

		this.isWatching = true;
		console.log("🔹 Starting autonomous database watching...");

		// Initial health check and sync
		await this.performAutonomousHealthCheck();

		// Set up periodic health checks (every 5 minutes)
		this.watchInterval = setInterval(
			async () => {
				await this.performAutonomousHealthCheck();
			},
			5 * 60 * 1000,
		); // 5 minutes

		console.log("🔹 Autonomous database watching started (every 5 minutes)");
	}

	/**
	 * Stop autonomous database watching
	 */
	public stopWatching(): void {
		if (this.watchInterval) {
			clearInterval(this.watchInterval);
			this.watchInterval = null;
		}
		this.isWatching = false;
		console.log("🔹 Autonomous database watching stopped");
	}

	/**
	 * Perform autonomous health check and maintenance
	 */
	private async performAutonomousHealthCheck(): Promise<void> {
		try {
			const guild = await this.getTargetGuild();
			if (!guild) {
				console.warn("⚠️ No target guild found for autonomous health check");
				return;
			}

			console.log(
				`🔍 Performing autonomous database health check for guild: ${guild.name}`,
			);

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
			} else {
				console.log(`✅ Database is healthy, no action needed`);
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

	/**
	 * Get the target guild for database operations
	 */
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

	// ==================== COMPREHENSIVE DATABASE MANAGEMENT ====================

	/**
	 * Comprehensive database health check and sync
	 */
	async performDatabaseHealthCheck(guild: Guild): Promise<{
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
		} | null;
		recommendations: string[];
		stats: {
			totalUsers: number;
			totalMessages: number;
			totalRoles: number;
			totalVoiceSessions: number;
		};
	}> {
		try {
			console.log(
				`🔍 Performing comprehensive database health check for guild: ${guild.name}`,
			);

			const syncStatus = await this.guildSyncService.checkGuildSyncStatus(
				guild.id,
			);
			const stats = await this.getGuildStats(guild.id);

			// Get actual Discord data for comparison
			const discordUsers = guild.memberCount;
			const discordRoles = guild.roles.cache.size;
			const discordChannels = guild.channels.cache.filter((c) =>
				c.isTextBased(),
			).size;

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

			// Display health report
			console.log(`\n📊 DATABASE HEALTH REPORT`);
			console.log(`═══════════════════════════════════════`);
			console.log(`🏰 Guild: ${guild.name}`);
			console.log(
				`🔄 Health Status: ${isHealthy ? "✅ HEALTHY" : "⚠️ NEEDS ATTENTION"}`,
			);
			console.log(`\n📈 Data Comparison:`);
			console.log(
				`   👥 Users:    ${stats.totalUsers}/${discordUsers} (${userSyncPercent}%)`,
			);
			console.log(
				`   🎭 Roles:    ${stats.totalRoles}/${discordRoles} (${roleSyncPercent}%)`,
			);
			console.log(
				`   💬 Messages: ${stats.totalMessages} (${discordChannels} channels)`,
			);
			console.log(`   🎤 Voice:    ${stats.totalVoiceSessions} sessions`);
			console.log(
				`   ⏰ Last Sync: ${syncStatus.lastSync ? syncStatus.lastSync.toLocaleString() : "Never"}`,
			);

			if (recommendations.length > 0) {
				console.log(`\n⚠️ Recommendations:`);
				recommendations.forEach((rec) => {
					console.log(`   • ${rec}`);
				});
			} else {
				console.log(`\n🎉 All systems operational! Database is healthy.`);
			}

			console.log(`═══════════════════════════════════════\n`);

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
				syncStatus: null,
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

	/**
	 * Comprehensive database sync with detailed reporting
	 */
	async performComprehensiveSync(
		guild: Guild,
		forceFullSync: boolean = false,
	): Promise<{
		success: boolean;
		syncedUsers: number;
		syncedRoles: number;
		syncedMessages: number;
		errors: string[];
		duration: number;
		summary: string;
	}> {
		const startTime = Date.now();

		try {
			console.log(
				`🔄 Starting comprehensive database sync for guild: ${guild.name}`,
			);

			const result = await this.guildSyncService.syncGuild(
				guild,
				forceFullSync,
			);
			const duration = Date.now() - startTime;

			const summary = result.success
				? `✅ Sync completed in ${duration}ms: ${result.syncedUsers} users, ${result.syncedRoles} roles, ${result.syncedMessages} messages`
				: `❌ Sync failed after ${duration}ms with ${result.errors.length} errors`;

			console.log(summary);

			return {
				...result,
				duration,
				summary,
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			console.error(`🔸 Comprehensive sync failed after ${duration}ms:`, error);

			return {
				success: false,
				syncedUsers: 0,
				syncedRoles: 0,
				syncedMessages: 0,
				errors: [error as string],
				duration,
				summary: `❌ Sync failed after ${duration}ms: ${error}`,
			};
		}
	}

	/**
	 * Auto-sync with intelligent decision making
	 */
	async performAutoSync(guild: Guild): Promise<{
		performed: boolean;
		reason: string;
		result?: {
			success: boolean;
			syncedUsers: number;
			syncedRoles: number;
			syncedMessages: number;
			errors: string[];
			duration: number;
			summary: string;
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
			const result = await this.performComprehensiveSync(guild, true);

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

	/**
	 * Database maintenance and optimization
	 */
	async performDatabaseMaintenance(guildId: string): Promise<{
		success: boolean;
		operations: string[];
		errors: string[];
	}> {
		const operations: string[] = [];
		const errors: string[] = [];

		try {
			console.log(`🔧 Performing database maintenance for guild: ${guildId}`);

			// Cleanup active voice sessions
			try {
				await this.cleanupActiveSessions();
				operations.push("Cleaned up active voice sessions");
			} catch (error) {
				errors.push(`Failed to cleanup voice sessions: ${error}`);
			}

			// Sync Sapphire VC logs if available
			try {
				const vcResult = await this.syncSapphireVCLogs();
				if (vcResult.success) {
					operations.push(
						`Synced ${vcResult.sessionsCreated} Sapphire VC sessions`,
					);
				} else {
					errors.push(`Sapphire VC sync failed: ${vcResult.errors.join(", ")}`);
				}
			} catch (error) {
				errors.push(`Sapphire VC sync error: ${error}`);
			}

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

	// ==================== USER MANAGEMENT ====================

	/**
	 * Get user by Discord ID and guild ID
	 */
	async getUser(discordId: string, guildId: string): Promise<User | null> {
		try {
			return await this.dbService.getUser(discordId, guildId);
		} catch (error) {
			console.error("🔸 Error getting user:", error);
			return null;
		}
	}

	/**
	 * Get all users in a guild
	 */
	async getUsersByGuild(guildId: string): Promise<User[]> {
		try {
			return await this.dbService.getUsersByGuild(guildId);
		} catch (error) {
			console.error("🔸 Error getting users by guild:", error);
			return [];
		}
	}

	/**
	 * Update or create user
	 */
	async upsertUser(
		user: Omit<User, "_id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		try {
			await this.dbService.upsertUser(user);
		} catch (error) {
			console.error("🔸 Error upserting user:", error);
			throw error;
		}
	}

	// ==================== ROLE MANAGEMENT ====================

	/**
	 * Get all roles in a guild
	 */
	async getRolesByGuild(guildId: string): Promise<Role[]> {
		try {
			return await this.dbService.getRolesByGuild(guildId);
		} catch (error) {
			console.error("🔸 Error getting roles by guild:", error);
			return [];
		}
	}

	/**
	 * Update or create role
	 */
	async upsertRole(
		role: Omit<Role, "_id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		try {
			await this.dbService.upsertRole(role);
		} catch (error) {
			console.error("🔸 Error upserting role:", error);
			throw error;
		}
	}

	// ==================== MESSAGE MANAGEMENT ====================

	/**
	 * Get messages by guild
	 */
	async getMessagesByGuild(
		guildId: string,
		limit: number = 100,
	): Promise<DBMessage[]> {
		try {
			return await this.dbService.getMessagesByGuild(guildId, limit);
		} catch (error) {
			console.error("🔸 Error getting messages by guild:", error);
			return [];
		}
	}

	/**
	 * Get messages by channel
	 */
	async getMessagesByChannel(
		guildId: string,
		channelName: string,
		limit: number = 100,
	): Promise<DBMessage[]> {
		try {
			return await this.dbService.getMessagesByChannel(
				guildId,
				channelName,
				limit,
			);
		} catch (error) {
			console.error("🔸 Error getting messages by channel:", error);
			return [];
		}
	}

	/**
	 * Get recent messages with user data
	 */
	async getRecentMessagesWithUsers(
		guildId: string,
		limit: number = 20,
	): Promise<
		{
			message: DBMessage;
			user: User | null;
		}[]
	> {
		try {
			return await this.dbService.getRecentMessagesWithUsers(guildId, limit);
		} catch (error) {
			console.error("🔸 Error getting recent messages with users:", error);
			return [];
		}
	}

	/**
	 * Get oldest messages with user data
	 */
	async getOldestMessagesWithUsers(
		guildId: string,
		limit: number = 20,
	): Promise<
		{
			message: DBMessage;
			user: User | null;
		}[]
	> {
		try {
			return await this.dbService.getOldestMessagesWithUsers(guildId, limit);
		} catch (error) {
			console.error("🔸 Error getting oldest messages with users:", error);
			return [];
		}
	}

	/**
	 * Batch insert messages
	 */
	async batchInsertMessages(
		messages: Omit<DBMessage, "_id" | "createdAt" | "updatedAt">[],
	): Promise<void> {
		try {
			await this.dbService.batchInsertMessages(messages);
		} catch (error) {
			console.error("🔸 Error batch inserting messages:", error);
			throw error;
		}
	}

	// ==================== VOICE SESSION MANAGEMENT ====================

	/**
	 * Get voice sessions by user
	 */
	async getVoiceSessionsByUser(
		userId: string,
		guildId: string,
	): Promise<VoiceSession[]> {
		try {
			return await this.dbService.getVoiceSessionsByUser(userId, guildId);
		} catch (error) {
			console.error("🔸 Error getting voice sessions by user:", error);
			return [];
		}
	}

	/**
	 * Get voice sessions by guild
	 */
	async getVoiceSessionsByGuild(guildId: string): Promise<VoiceSession[]> {
		try {
			return await this.dbService.getVoiceSessionsByGuild(guildId);
		} catch (error) {
			console.error("🔸 Error getting voice sessions by guild:", error);
			return [];
		}
	}

	/**
	 * Create voice session
	 */
	async createVoiceSession(
		session: Omit<VoiceSession, "_id" | "createdAt" | "updatedAt">,
	): Promise<void> {
		try {
			await this.dbService.createVoiceSession(session);
		} catch (error) {
			console.error("🔸 Error creating voice session:", error);
			throw error;
		}
	}

	/**
	 * Update voice session (when user leaves)
	 */
	async updateVoiceSession(
		userId: string,
		guildId: string,
		leftAt: Date,
	): Promise<void> {
		try {
			await this.dbService.updateVoiceSession(userId, guildId, leftAt);
		} catch (error) {
			console.error("🔸 Error updating voice session:", error);
			throw error;
		}
	}

	// ==================== INTERACTION MANAGEMENT ====================

	/**
	 * Record user interaction
	 */
	async recordInteraction(
		interaction: Omit<UserInteraction, "_id" | "createdAt">,
	): Promise<void> {
		try {
			await this.dbService.recordInteraction(interaction);
		} catch (error) {
			console.error("🔸 Error recording interaction:", error);
			throw error;
		}
	}

	/**
	 * Get user interactions
	 */
	async getUserInteractions(
		fromUserId: string,
		toUserId: string,
		guildId: string,
	): Promise<UserInteraction[]> {
		try {
			return await this.dbService.getUserInteractions(
				fromUserId,
				toUserId,
				guildId,
			);
		} catch (error) {
			console.error("🔸 Error getting user interactions:", error);
			return [];
		}
	}

	// ==================== STATISTICS ====================

	/**
	 * Get guild statistics
	 */
	async getGuildStats(guildId: string): Promise<{
		totalUsers: number;
		totalMessages: number;
		totalRoles: number;
		totalVoiceSessions: number;
	}> {
		try {
			return await this.dbService.getGuildStats(guildId);
		} catch (error) {
			console.error("🔸 Error getting guild stats:", error);
			return {
				totalUsers: 0,
				totalMessages: 0,
				totalRoles: 0,
				totalVoiceSessions: 0,
			};
		}
	}

	// ==================== DATABASE MAINTENANCE ====================

	/**
	 * Wipe entire database
	 */
	async wipeDatabase(): Promise<void> {
		try {
			await this.dbService.wipeDatabase();
			console.log("🔹 Database wiped successfully");
		} catch (error) {
			console.error("🔸 Error wiping database:", error);
			throw error;
		}
	}

	/**
	 * Sync Sapphire VC logs
	 */
	async syncSapphireVCLogs(): Promise<{
		success: boolean;
		sessionsCreated: number;
		errors: string[];
	}> {
		try {
			return await this.dbService.syncSapphireVCLogs();
		} catch (error) {
			console.error("🔸 Error syncing Sapphire VC logs:", error);
			return { success: false, sessionsCreated: 0, errors: [error as string] };
		}
	}

	/**
	 * Get active voice sessions
	 */
	getActiveVoiceSessions(): Map<string, VoiceSession> {
		return this.trackingService.getActiveVoiceSessions();
	}

	/**
	 * Cleanup active voice sessions
	 */
	async cleanupActiveSessions(): Promise<void> {
		try {
			await this.trackingService.cleanupActiveSessions();
		} catch (error) {
			console.error("🔸 Error cleaning up active sessions:", error);
		}
	}

	/**
	 * Cleanup database resources
	 */
	async cleanup(): Promise<void> {
		console.log("🔹 Cleaning up autonomous database management service...");

		// Stop autonomous watching
		this.stopWatching();

		// Cleanup active sessions
		await this.cleanupActiveSessions();

		console.log("🔹 Autonomous database management service cleanup completed");
	}
}
