import {
	AuditLogEvent,
	type Channel,
	ChannelType,
	type Client,
	type Collection,
	Message as DiscordMessage,
	type User as DiscordUser,
	EmbedBuilder,
	type GuildMember,
	type MessageReaction,
	type PartialMessage,
	type PartialMessageReaction,
	type PartialUser,
	PermissionFlagsBits,
	type VoiceChannel,
	type VoiceState,
} from "discord.js";
import { config, isDevelopment } from "../../config";
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
import type { VoiceInteraction } from "../../types/database";
import { clonePermissionOverwrites } from "../../utils/permissions";
import { getCacheManager } from "../cache-management/DiscordDataCache";
import { DatabaseCore } from "../database-manager/PostgresCore";
import { getEventQueue } from "../event-system/EventQueue";
import { ChannelNamingService } from "./ChannelNamingService";
import { VoiceSessionTracker } from "./VoiceSessionTracker";

export class VoiceManager implements IVoiceManager {
	private client: Client;
	private cache = getCacheManager();
	private readonly debugEnabled = isDevelopment;
	private channelCreationQueue: Array<{
		member: GuildMember;
		config: VoiceChannelConfig;
		resolve: () => void;
		reject: (error: Error) => void;
	}> = [];
	private isProcessingQueue = false;
	private maxConcurrentChannels = 50; // Discord's per-guild daily limit is 500, so 50 is safe
	private channelCreationDelay = 100; // 100ms delay between channel creations
	private orphanedChannelWatcher: NodeJS.Timeout | null = null;
	private sessionReconcileTimer: NodeJS.Timeout | null = null;
	private isWatchingOrphanedChannels = false;
	private isReconciling = false; // Prevent concurrent reconciliation
	private dbCore: DatabaseCore;
	private sessionTracker: VoiceSessionTracker;
	private namingService: ChannelNamingService;
	private activeVoiceSessions: Map<string, VoiceInteraction> = new Map();
	private eventQueue = getEventQueue();

	// Error tracking for voice state updates
	private voiceStateUpdateErrors: Map<string, number> = new Map();
	private readonly MAX_ERRORS_BEFORE_ALERT = 5;
	private lastSyncLogTime = 0;

	// Channels that should be tracked but not modified by the voice manager
	private readonly readOnlyChannels = new Set(
		config.excludedChannelIds || [
			"1287323426465513512",
			"1427152903260344350",
			"1423746690342588516",
		],
	);

	constructor(client: Client) {
		this.client = client;
		this.dbCore = new DatabaseCore();
		this.sessionTracker = new VoiceSessionTracker(this.dbCore);
		this.namingService = new ChannelNamingService();
		this.setupEventHandlers();
		this.startOrphanedChannelWatcher();
		this.startSessionReconciliation();
	}

	async initialize(): Promise<void> {
		await this.dbCore.initialize();
		await this.clearCorruptedCacheEntries();
		await this.forceClearKnownCorruptedEntries();

		// NEW: Clean up duplicate sessions on startup
		await this.cleanupDuplicateSessions();

		await this.checkAndSyncDatabase();
	}

	private async cleanupDuplicateSessions(): Promise<void> {
		console.log("🧹 Cleaning up duplicate voice sessions...");

		// Get all channels
		for (const guild of Array.from(this.client.guilds.cache.values())) {
			for (const channel of Array.from(guild.channels.cache.values())) {
				if (channel.isVoiceBased() && channel.type === ChannelType.GuildVoice) {
					const activeSessions =
						await this.dbCore.getActiveVoiceChannelSessions(channel.id);
					const userSessionMap = new Map<string, typeof activeSessions>();

					// Group sessions by user
					for (const session of activeSessions) {
						if (!userSessionMap.has(session.userId)) {
							userSessionMap.set(session.userId, []);
						}
						const userSessions = userSessionMap.get(session.userId);
						if (userSessions) {
							userSessions.push(session);
						}
					}

					// Close duplicate sessions (keep most recent)
					for (const [userId, sessions] of userSessionMap.entries()) {
						if (sessions.length > 1) {
							sessions.sort(
								(a, b) => b.joinedAt.getTime() - a.joinedAt.getTime(),
							);
							const keepSession = sessions[0];
							const closeSessions = sessions.slice(1);

							for (const session of closeSessions) {
								await this.dbCore.endVoiceChannelSession(
									session.userId,
									session.channelId,
									new Date(),
								);
							}
							console.log(
								`🔧 Cleaned ${closeSessions.length} duplicate sessions for user ${userId} in channel ${channel.name}`,
							);
						}
					}
				}
			}
		}

		console.log("✅ Duplicate session cleanup complete");
	}

	private startSessionReconciliation(): void {
		if (this.sessionReconcileTimer) return;
		// Reconcile every 30 seconds for better consistency

		this.sessionReconcileTimer = setInterval(async () => {
			// Prevent concurrent reconciliation
			if (this.isReconciling) {
				if (this.debugEnabled) {
					console.log("🔸 Skipping reconciliation - already in progress");
				}
				return;
			}

			this.isReconciling = true;
			try {
				// First validate and fix member counts
				await this.validateChannelMemberCounts();

				// Check for issues and only sync if needed
				const issues = await this.findDatabaseIssues();
				if (issues.length > 0) {
					await this.performIncrementalSync(issues);
				}
			} catch (error) {
				if (this.debugEnabled)
					console.warn("🔸 Session reconciliation error:", error);
			} finally {
				this.isReconciling = false;
			}
		}, 120 * 1000); // Run every 2 minutes to reduce race conditions
	}

	private stopSessionReconciliation(): void {
		if (this.sessionReconcileTimer) {
			clearInterval(this.sessionReconcileTimer);
			this.sessionReconcileTimer = null;
		}
	}

	/**
	 * Check if a channel should be treated as read-only (tracked but not modified)
	 */
	private isReadOnlyChannel(channelId: string): boolean {
		return this.readOnlyChannels.has(channelId);
	}

	/**
	 * Force clear known corrupted cache entries that might be missed by the general cleanup
	 */
	private async forceClearKnownCorruptedEntries(): Promise<void> {
		try {
			const { getRedisClient } = await import(
				"../cache-management/RedisManager"
			);
			const redis = await getRedisClient();

			if (redis) {
				// Known corrupted entries that have been causing issues
				const knownCorruptedKeys = [
					"channel_owner:1427044495345717399",
					"channel_owner:1427118373812306042",
					"channel_members:1423746690342588516",
					// Add other known corrupted keys here as they're discovered
				];

				for (const key of knownCorruptedKeys) {
					try {
						const exists = await redis.exists(key);
						if (exists) {
							await redis.del(key);
							console.log(
								`🔹 Force removed known corrupted cache entry: ${key}`,
							);
						}
					} catch (error) {
						console.warn(`🔸 Error force removing ${key}:`, error);
					}
				}
			}
		} catch (error) {
			console.warn("🔸 Error force clearing known corrupted entries:", error);
		}
	}

	/**
	 * Clear any corrupted cache entries on startup
	 */
	private async clearCorruptedCacheEntries(): Promise<void> {
		try {
			// Get Redis client to check for corrupted entries
			const { getRedisClient } = await import(
				"../cache-management/RedisManager"
			);
			const redis = await getRedisClient();

			if (redis) {
				// Get all Redis keys that might contain corrupted data
				const allKeys = await redis.keys("*");
				let corruptedCount = 0;

				// Filter for our specific key patterns
				const channelKeys = allKeys.filter((key) =>
					key.startsWith("channel_owner:"),
				);
				const voiceKeys = allKeys.filter((key) =>
					key.startsWith("active_voice:"),
				);
				const userKeys = allKeys.filter((key) => key.startsWith("user_prefs:"));
				const callStateKeys = allKeys.filter((key) =>
					key.startsWith("call_state:"),
				);
				const channelMemberKeys = allKeys.filter((key) =>
					key.startsWith("channel_members:"),
				);

				// Check for corrupted entries silently

				for (const key of channelKeys) {
					try {
						const value = await redis.get(key);
						if (
							value === "[object Object]" ||
							value === "null" ||
							value === "undefined" ||
							!value ||
							value.trim() === ""
						) {
							await redis.del(key);
							corruptedCount++;
							console.log(`🔹 Removed corrupted cache entry: ${key}`);
						} else {
							// Try to parse as JSON to catch other corruption
							try {
								JSON.parse(value);
							} catch (parseError) {
								await redis.del(key);
								corruptedCount++;
								console.log(
									`🔹 Removed corrupted cache entry (JSON parse failed): ${key}`,
								);
							}
						}
					} catch (error) {
						// If we can't get the value, it's likely corrupted
						await redis.del(key);
						corruptedCount++;
						console.log(
							`🔹 Removed corrupted cache entry (get failed): ${key}`,
						);
					}
				}

				// Check voice session keys
				for (const key of voiceKeys) {
					try {
						const value = await redis.get(key);
						if (
							value === "[object Object]" ||
							value === "null" ||
							value === "undefined" ||
							!value ||
							value.trim() === ""
						) {
							await redis.del(key);
							corruptedCount++;
							console.log(`🔹 Removed corrupted cache entry: ${key}`);
						} else {
							// Try to parse as JSON to catch other corruption
							try {
								JSON.parse(value);
							} catch (parseError) {
								await redis.del(key);
								corruptedCount++;
								console.log(
									`🔹 Removed corrupted cache entry (JSON parse failed): ${key}`,
								);
							}
						}
					} catch (error) {
						// If we can't get the value, it's likely corrupted
						await redis.del(key);
						corruptedCount++;
						console.log(
							`🔹 Removed corrupted cache entry (get failed): ${key}`,
						);
					}
				}

				// Check user preference keys
				for (const key of userKeys) {
					try {
						const value = await redis.get(key);
						if (
							value === "[object Object]" ||
							value === "null" ||
							value === "undefined" ||
							!value ||
							value.trim() === ""
						) {
							await redis.del(key);
							corruptedCount++;
							console.log(`🔹 Removed corrupted cache entry: ${key}`);
						} else {
							// Try to parse as JSON to catch other corruption
							try {
								JSON.parse(value);
							} catch (parseError) {
								await redis.del(key);
								corruptedCount++;
								console.log(
									`🔹 Removed corrupted cache entry (JSON parse failed): ${key}`,
								);
							}
						}
					} catch (error) {
						// If we can't get the value, it's likely corrupted
						await redis.del(key);
						corruptedCount++;
						console.log(
							`🔹 Removed corrupted cache entry (get failed): ${key}`,
						);
					}
				}

				// Check call state keys
				for (const key of callStateKeys) {
					try {
						const value = await redis.get(key);
						if (
							value === "[object Object]" ||
							value === "null" ||
							value === "undefined" ||
							!value ||
							value.trim() === ""
						) {
							await redis.del(key);
							corruptedCount++;
							console.log(`🔹 Removed corrupted cache entry: ${key}`);
						} else {
							// Try to parse as JSON to catch other corruption
							try {
								JSON.parse(value);
							} catch (parseError) {
								await redis.del(key);
								corruptedCount++;
								console.log(
									`🔹 Removed corrupted cache entry (JSON parse failed): ${key}`,
								);
							}
						}
					} catch (error) {
						// If we can't get the value, it's likely corrupted
						await redis.del(key);
						corruptedCount++;
						console.log(
							`🔹 Removed corrupted cache entry (get failed): ${key}`,
						);
					}
				}

				// Check channel member keys
				for (const key of channelMemberKeys) {
					try {
						const value = await redis.get(key);
						if (
							value === "[object Object]" ||
							value === "null" ||
							value === "undefined" ||
							!value ||
							value.trim() === ""
						) {
							await redis.del(key);
							corruptedCount++;
							console.log(`🔹 Removed corrupted cache entry: ${key}`);
						} else {
							// Try to parse as JSON to catch other corruption
							try {
								JSON.parse(value);
							} catch (parseError) {
								await redis.del(key);
								corruptedCount++;
								console.log(
									`🔹 Removed corrupted cache entry (JSON parse failed): ${key}`,
								);
							}
						}
					} catch (error) {
						// If we can't get the value, it's likely corrupted
						await redis.del(key);
						corruptedCount++;
						console.log(
							`🔹 Removed corrupted cache entry (get failed): ${key}`,
						);
					}
				}

				if (corruptedCount > 0) {
					console.log(
						`🔧 Cleaned up ${corruptedCount} corrupted cache entries`,
					);
				}
			}
		} catch (error) {
			console.warn("🔸 Error clearing corrupted cache entries:", error);
		}
	}

	/**
	 * Check database sync status and sync any inconsistencies on startup
	 */
	private async checkAndSyncDatabase(): Promise<void> {
		try {
			console.log("🔍 Checking database sync status...");

			// First, sync all voice channels from Discord API (source of truth)
			await this.syncAllVoiceChannelsFromDiscord();

			const syncResult = await this.performDatabaseSyncCheck();

			if (syncResult.needsSync) {
				console.log(
					`🔧 Database sync needed: ${syncResult.issues.length} issues found`,
				);
				console.log("Issues:", syncResult.issues);
				await this.performIncrementalSync(syncResult.issues);
				console.log("✅ Database sync completed");
			} else {
				console.log("✅ Database is in sync");
			}
		} catch (error) {
			console.error("🔸 Error during database sync check:", error);
		}
	}

	/**
	 * Sync all voice channels from Discord API (source of truth)
	 * This ensures database accurately reflects who's currently in voice channels
	 */
	private async syncAllVoiceChannelsFromDiscord(): Promise<void> {
		try {
			console.log("🔄 Syncing voice channels from Discord API...");
			let totalSynced = 0;
			let totalFixed = 0;

			for (const guild of Array.from(this.client.guilds.cache.values())) {
				// Only upsert/sync for the configured server
				if (guild.id !== config.guildId) {
					continue;
				}
				for (const channel of Array.from(guild.channels.cache.values())) {
					if (
						channel.isVoiceBased() &&
						channel.type === ChannelType.GuildVoice
					) {
						const voiceChannel = channel as VoiceChannel;

						// Ensure channel is upserted during sync so DB reflects Discord
						try {
							await this.dbCore.upsertChannel({
								discordId: voiceChannel.id,
								guildId: guild.id,
								channelName: voiceChannel.name,
								position: voiceChannel.position ?? 0,
								isActive: true,
								activeUserIds: Array.from(voiceChannel.members.keys()),
								memberCount: voiceChannel.members.size,
								status: null,
								lastStatusChange: null,
							});
						} catch (error) {
							console.warn(
								`🔸 Failed to upsert channel ${voiceChannel.id} during sync:`,
								error,
							);
						}

						// Include excluded channels in sync - we want to track users but not manage ownership
						// Only skip spawn channels from sync
						const isSpawnChannel =
							config.spawnChannelIds?.includes(voiceChannel.id) ?? false;
						if (isSpawnChannel) {
							continue;
						}

						const discordMembers = Array.from(voiceChannel.members.keys());

						// Get active sessions from database for this channel
						const activeSessions = await this.dbCore.getActiveChannelMembers(
							voiceChannel.id,
						);

						// Find users in Discord but not in database (missing sessions)
						const missingSessions = discordMembers.filter(
							(userId) => !activeSessions.includes(userId),
						);

						// Find users in database but not in Discord (orphaned sessions)
						const orphanedSessions = activeSessions.filter(
							(userId) => !discordMembers.includes(userId),
						);

						// Create missing sessions
						for (const userId of missingSessions) {
							const member = voiceChannel.members.get(userId);
							if (member) {
								try {
									// Double-check that the user doesn't already have an active session
									const existingSession =
										await this.dbCore.getCurrentVoiceChannelSession(userId);
									if (
										!existingSession ||
										existingSession.channelId !== voiceChannel.id
									) {
										await this.sessionTracker.trackUserJoin(
											member,
											voiceChannel,
										);
										totalFixed++;
									}
								} catch (error) {
									// If it's a duplicate key error, that's expected - user already has a session
									const err = error as { code?: string; message?: string };
									if (err.code === "23505") {
										console.log(
											`  ℹ️ User ${userId} already has active session in ${voiceChannel.name}`,
										);
									} else {
										console.error(
											`  🔸 Failed to create session for user ${userId}:`,
											err.message,
										);
									}
								}
							}
						}

						// Close orphaned sessions
						for (const userId of orphanedSessions) {
							const member = guild.members.cache.get(userId);
							if (member) {
								try {
									await this.sessionTracker.trackUserLeave(
										member,
										voiceChannel,
									);
									totalFixed++;
								} catch (error) {
									const err = error as { message?: string };
									console.error(
										`  🔸 Failed to close orphaned session for user ${userId}:`,
										err.message,
									);
								}
							}
						}

						if (missingSessions.length > 0 || orphanedSessions.length > 0) {
							console.log(
								`🔧 Channel ${voiceChannel.name}: +${missingSessions.length} sessions, -${orphanedSessions.length} sessions`,
							);
						}

						totalSynced++;
					}
				}
			}

			console.log(
				`✅ Discord sync completed: ${totalSynced} channels checked, ${totalFixed} sessions fixed`,
			);
		} catch (error) {
			console.error("🔸 Error syncing voice channels from Discord:", error);
		}
	}

	/**
	 * Perform database sync check to identify inconsistencies
	 */
	private async performDatabaseSyncCheck(): Promise<{
		needsSync: boolean;
		issues: string[];
	}> {
		const issues: string[] = [];

		try {
			// Check for orphaned voice sessions (users in channels but no active session)
			const orphanedSessions = await this.findOrphanedVoiceSessions();
			if (orphanedSessions.length > 0) {
				issues.push(`Found ${orphanedSessions.length} orphaned voice sessions`);
			}

			// Check for missing voice sessions (active sessions but user not in channel)
			const missingSessions = await this.findMissingVoiceSessions();
			if (missingSessions.length > 0) {
				issues.push(`Found ${missingSessions.length} missing voice sessions`);
			}

			// Check for inconsistent channel ownership
			const ownershipIssues = await this.findOwnershipInconsistencies();
			if (ownershipIssues.length > 0) {
				issues.push(
					`Found ${ownershipIssues.length} ownership inconsistencies`,
				);
			}

			return {
				needsSync: issues.length > 0,
				issues,
			};
		} catch (error) {
			console.error("🔸 Error performing sync check:", error);
			return { needsSync: false, issues: [`Sync check failed: ${error}`] };
		}
	}

	/**
	 * Find orphaned voice sessions (users in channels but no active session)
	 */
	private async findOrphanedVoiceSessions(): Promise<string[]> {
		const orphaned: string[] = [];

		for (const guild of Array.from(this.client.guilds.cache.values())) {
			for (const channel of Array.from(guild.channels.cache.values())) {
				if (channel.isVoiceBased() && channel.type === ChannelType.GuildVoice) {
					const voiceChannel = channel as VoiceChannel;

					for (const [userId, member] of Array.from(voiceChannel.members)) {
						if (!member.user.bot) {
							const user = await this.dbCore.getUser(userId, guild.id);
							if (user) {
				const interactions = Array.isArray(user.voiceInteractions)
					? user.voiceInteractions
					: (() => {
						try {
							return JSON.parse(
								(Array.isArray(user.voiceInteractions)
									? user.voiceInteractions
									: (user as any).voice_interactions || "[]",
							) as string,
							);
						} catch {
							return [] as typeof user.voiceInteractions;
						}
					})();
								const hasActiveSessionInThisChannel = interactions.some(
									(interaction) =>
										interaction.channelId === channel.id && !interaction.leftAt,
								);

								if (!hasActiveSessionInThisChannel) {
									orphaned.push(
										`User ${userId} in channel ${channel.name} has no active session`,
									);
								}
							}
						}
					}
				}
			}
		}

		return orphaned;
	}

	/**
	 * Find missing voice sessions (active sessions but user not in channel)
	 */
	private async findMissingVoiceSessions(): Promise<string[]> {
		const missing: string[] = [];

		try {
			// Source of truth: active rows in voice_channel_sessions
			const activeSessions = await this.dbCore.getAllActiveSessions();
			for (const session of activeSessions) {
				const guild = this.client.guilds.cache.get(session.guildId);
				if (!guild) {
					missing.push(
						`Active session for user ${session.userId} in unknown guild ${session.guildId}`,
					);
					continue;
				}
				const channel = guild.channels.cache.get(session.channelId);
				if (!channel || !channel.isVoiceBased()) {
					missing.push(
						`Active session for user ${session.userId} in non-existent channel ${session.channelId}`,
					);
					continue;
				}
				const voiceChannel = channel as VoiceChannel;
				const member = voiceChannel.members.get(session.userId);
				if (!member) {
					missing.push(
						`Active session for user ${session.userId} but user not in channel ${session.channelName}`,
					);
				}
			}
		} catch (error: unknown) {
			console.error("🔸 Error finding missing voice sessions:", error as Error);
		}

		return missing;
	}

	/**
	 * Find ownership inconsistencies
	 */
	private async findOwnershipInconsistencies(): Promise<string[]> {
		const inconsistencies: string[] = [];

		for (const guild of Array.from(this.client.guilds.cache.values())) {
			for (const channel of Array.from(guild.channels.cache.values())) {
				if (channel.isVoiceBased() && channel.type === ChannelType.GuildVoice) {
					const voiceChannel = channel as VoiceChannel;
					const owner = await this.getChannelOwner(channel.id);

					if (owner) {
						const ownerInChannel = voiceChannel.members.has(owner.userId);
						if (!ownerInChannel) {
							inconsistencies.push(
								`Channel ${channel.name} has owner ${owner.userId} who is not in the channel`,
							);
						}
					}
				}
			}
		}

		return inconsistencies;
	}

	/**
	 * Validate channel member counts by comparing Discord API vs database
	 */
	private async validateChannelMemberCounts(): Promise<void> {
		try {
			// Add a small delay to allow Discord events to settle
			await new Promise((resolve) => setTimeout(resolve, 1000));

			let totalChannelsChecked = 0;
			let discrepanciesFound = 0;
			let discrepanciesFixed = 0;

			for (const guild of Array.from(this.client.guilds.cache.values())) {
				for (const channel of Array.from(guild.channels.cache.values())) {
					if (
						channel.isVoiceBased() &&
						channel.type === ChannelType.GuildVoice
					) {
						const voiceChannel = channel as VoiceChannel;

						// Include excluded channels in member count validation - we track users but skip ownership management
						// Only skip spawn channels from validation
						const isSpawnChannel =
							config.spawnChannelIds?.includes(voiceChannel.id) ?? false;
						if (isSpawnChannel) {
							continue;
						}

						const discordMemberCount = Array.from(
							voiceChannel.members.values(),
						).length;

						const dbMemberCount = await this.dbCore.getActiveChannelMemberCount(
							voiceChannel.id,
						);

						if (discordMemberCount !== dbMemberCount) {
							discrepanciesFound++;
							console.warn(
								`⚠️ Member count mismatch in ${voiceChannel.name}: Discord=${discordMemberCount}, DB=${dbMemberCount}`,
							);

							// Fix the discrepancy by syncing the channel's active users
							try {
								await this.dbCore.syncChannelActiveUsers(voiceChannel.id);
								discrepanciesFixed++;
								console.log(`🔧 Fixed member count for ${voiceChannel.name}`);
							} catch (syncError) {
								console.error(
									`🔸 Failed to sync member count for ${voiceChannel.name}:`,
									syncError,
								);
							}
						}

						totalChannelsChecked++;
					}
				}
			}

			if (discrepanciesFound > 0) {
				console.warn(
					`⚠️ Found ${discrepanciesFound} member count discrepancies across ${totalChannelsChecked} channels`,
				);
				if (discrepanciesFixed > 0) {
					console.log(
						`🔧 Fixed ${discrepanciesFixed} member count discrepancies`,
					);
				}
			}
		} catch (error) {
			console.error("🔸 Error validating channel member counts:", error);
		}
	}

	/**
	 * Find all database issues that need to be fixed
	 */
	private async findDatabaseIssues(): Promise<string[]> {
		const issues: string[] = [];

		// Check for orphaned voice sessions
		const orphanedSessions = await this.findOrphanedVoiceSessions();
		if (orphanedSessions.length > 0) {
			issues.push(`Found ${orphanedSessions.length} orphaned voice sessions`);
		}

		// Check for missing voice sessions
		const missingSessions = await this.findMissingVoiceSessions();
		if (missingSessions.length > 0) {
			issues.push(`Found ${missingSessions.length} missing voice sessions`);
		}

		// Check for ownership inconsistencies
		const ownershipIssues = await this.findOwnershipInconsistencies();
		if (ownershipIssues.length > 0) {
			issues.push(`Found ${ownershipIssues.length} ownership inconsistencies`);
		}

		return issues;
	}

	/**
	 * Perform incremental sync to fix identified issues
	 */
	private async performIncrementalSync(issues: string[]): Promise<void> {
		try {
			// Sync orphaned voice sessions
			const orphanedSessions = await this.findOrphanedVoiceSessions();
			if (orphanedSessions.length > 0) {
				// Only log if there are many orphaned sessions or it's been a while since last sync
				const shouldLog = orphanedSessions.length >= 3 || !this.lastSyncLogTime || (Date.now() - this.lastSyncLogTime) > 30000;
				if (shouldLog) {
					console.log(`🔄 Syncing ${orphanedSessions.length} orphaned voice sessions...`);
					this.lastSyncLogTime = Date.now();
				}
				await this.syncOrphanedVoiceSessions();
			}

			// Sync missing voice sessions
			const missingSessions = await this.findMissingVoiceSessions();
			if (missingSessions.length > 0) {
				console.log(
					`🔧 Closing ${missingSessions.length} missing voice sessions...`,
				);
				await this.closeMissingVoiceSessions();
			}

			// Sync ownership inconsistencies
			const ownershipIssues = await this.findOwnershipInconsistencies();
			if (ownershipIssues.length > 0) {
				console.log(
					`🔧 Fixing ${ownershipIssues.length} ownership inconsistencies...`,
				);
				await this.fixOwnershipInconsistencies();
			}

			// Sync all channel member counts to ensure database consistency
			await this.dbCore.syncAllChannelsActiveUsers();

			// Only log completion if there were issues to fix
			if (issues.length > 0) {
				console.log("✅ Incremental sync completed");
			}
		} catch (error) {
			console.error("🔸 Error during incremental sync:", error);
		}
	}

	/**
	 * Sync orphaned voice sessions by creating missing sessions
	 */
	private async syncOrphanedVoiceSessions(): Promise<void> {
		for (const guild of Array.from(this.client.guilds.cache.values())) {
			for (const channel of Array.from(guild.channels.cache.values())) {
				if (channel.isVoiceBased() && channel.type === ChannelType.GuildVoice) {
					const voiceChannel = channel as VoiceChannel;

					for (const [userId, member] of Array.from(voiceChannel.members)) {
						if (!member.user.bot) {
							const user = await this.dbCore.getUser(userId, guild.id);
							if (user) {
								const interactions = Array.isArray(user.voiceInteractions)
									? user.voiceInteractions
									: (() => {
										try {
											return JSON.parse(
												(Array.isArray(user.voiceInteractions)
													? user.voiceInteractions
													: (user as any).voice_interactions || "[]",
											) as string,
											);
										} catch {
											return [] as typeof user.voiceInteractions;
										}
									})();
								const hasActiveSessionInThisChannel = interactions.some(
									(interaction) =>
										interaction.channelId === channel.id && !interaction.leftAt,
								);

								if (!hasActiveSessionInThisChannel) {
									// Create missing voice session
									const session: VoiceInteraction = {
										channelId: channel.id,
										channelName: channel.name,
										guildId: guild.id,
										joinedAt: new Date(), // Use current time as approximation
									};

									await this.dbCore.addVoiceInteraction(
										userId,
										guild.id,
										session,
									);
									// Only log if debug is enabled
									if (this.debugEnabled) {
										console.log(
											`🔹 Created missing voice session for user ${userId} in channel ${channel.name}`,
										);
									}
								}
							}
						}
					}
				}
			}
		}
	}

	/**
	 * Close missing voice sessions
	 */
	private async closeMissingVoiceSessions(): Promise<void> {
		try {
			const activeSessions = await this.dbCore.getAllActiveSessions();
			for (const session of activeSessions) {
				try {
					const guild = this.client.guilds.cache.get(session.guildId);
					if (!guild) {
						await this.dbCore.endVoiceChannelSession(
							session.userId,
							session.channelId,
							new Date(),
						);
						console.log(
							`🔹 Closed session for user ${session.userId} in unknown guild ${session.guildId}`,
						);
						continue;
					}
					const channel = guild.channels.cache.get(session.channelId);
					if (!channel || !channel.isVoiceBased()) {
						await this.dbCore.endVoiceChannelSession(
							session.userId,
							session.channelId,
							new Date(),
						);
						console.log(
							`🔹 Closed session for user ${session.userId} in non-existent channel`,
						);
						continue;
					}
					const voiceChannel = channel as VoiceChannel;
					const member = voiceChannel.members.get(session.userId);
					if (!member) {
						await this.dbCore.endVoiceChannelSession(
							session.userId,
							session.channelId,
							new Date(),
						);
						console.log(
							`🔹 Closed session for user ${session.userId} not in channel ${session.channelName}`,
						);
					}
				} catch (sessionError) {
					console.warn(
						`🔸 Error closing session for user ${session.userId} in channel ${session.channelId}:`,
						sessionError,
					);
					// Continue with other sessions even if one fails
				}
			}
		} catch (error: unknown) {
			console.error("🔸 Error closing missing voice sessions:", error as Error);
		}
	}

	/**
	 * Fix ownership inconsistencies
	 */
	private async fixOwnershipInconsistencies(): Promise<void> {
		for (const guild of Array.from(this.client.guilds.cache.values())) {
			for (const channel of Array.from(guild.channels.cache.values())) {
				if (channel.isVoiceBased() && channel.type === ChannelType.GuildVoice) {
					const voiceChannel = channel as VoiceChannel;
					const owner = await this.getChannelOwner(channel.id);

					if (owner) {
						const ownerInChannel = voiceChannel.members.has(owner.userId);
						if (!ownerInChannel) {
							// Remove ownership for user not in channel
							await this.removeChannelOwner(channel.id);
							console.log(
								`🔹 Removed ownership for user ${owner.userId} not in channel ${channel.name}`,
							);

							// Try to assign new ownership if channel has members
							if (voiceChannel.members.size > 0) {
								await this.universalOwnershipSync(channel.id);
							}
						}
					}
				}
			}
		}
	}

	private setupEventHandlers() {
		// Voice state events - handled directly
		this.client.on("voiceStateUpdate", async (oldState, newState) => {
			await this.handleVoiceStateUpdate(oldState, newState);
		});

		// Listen for channel updates to capture manual renames
		this.client.on("channelUpdate", async (oldChannel, newChannel) => {
			await this.handleChannelUpdate(oldChannel, newChannel);
		});

		// Message events - Non-blocking queue
		this.client.on("messageCreate", (message) => {
			this.eventQueue.enqueueMessage(message);
		});

		this.client.on("messageUpdate", (_, newMessage) => {
			if (newMessage instanceof DiscordMessage) {
				this.eventQueue.enqueueMessageUpdate(_, newMessage);
			}
		});

		this.client.on("messageDelete", (message) => {
			this.eventQueue.enqueueMessageDelete(message);
		});

		// Reaction events - Non-blocking queue
		this.client.on("messageReactionAdd", (reaction, user) => {
			this.eventQueue.enqueueReactionAdd(reaction, user);
		});

		this.client.on("messageReactionRemove", (reaction, user) => {
			this.eventQueue.enqueueReactionRemove(reaction, user);
		});

		// Guild member events - Non-blocking queue
		this.client.on("guildMemberUpdate", (oldMember, newMember) => {
			this.eventQueue.enqueueGuildMemberUpdate(
				oldMember as GuildMember,
				newMember,
			);
		});

		// Process queued events
		this.eventQueue.on("messageCreate", async (message) => {
			await this.trackMessage(message);
		});

		this.eventQueue.on("messageUpdate", async ({ newMessage }) => {
			if (newMessage instanceof DiscordMessage) {
				await this.trackMessageUpdate(newMessage);
			}
		});

		this.eventQueue.on("messageDelete", async (message) => {
			await this.trackMessageDelete(message);
		});

		this.eventQueue.on("messageReactionAdd", async ({ reaction, user }) => {
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

		this.eventQueue.on("messageReactionRemove", async ({ reaction, user }) => {
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

		this.eventQueue.on("voiceStateUpdate", async ({ oldState, newState }) => {
			// Voice tracking is now handled by handleVoiceStateUpdate method
		});

		this.eventQueue.on("guildMemberUpdate", async ({ newMember }) => {
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

	private async processChannelCreationQueue() {
		if (this.isProcessingQueue || this.channelCreationQueue.length === 0) {
			return;
		}

		this.isProcessingQueue = true;
		console.log(
			`🔹 Processing channel creation queue: ${this.channelCreationQueue.length} pending`,
		);

		while (this.channelCreationQueue.length > 0) {
			const queueItem = this.channelCreationQueue.shift();
			if (!queueItem) break;
			const { member, config, resolve, reject } = queueItem;

			try {
				// Check if we've hit the concurrent channel limit
				const currentChannelCount = member.guild.channels.cache.filter(
					(c) =>
						c.type === ChannelType.GuildVoice && c.name.includes("'s Room"),
				).size;

				if (currentChannelCount >= this.maxConcurrentChannels) {
					console.log(
						`🔸 Channel limit reached (${this.maxConcurrentChannels}), queuing for later`,
					);
					// Re-queue this request
					this.channelCreationQueue.unshift({
						member,
						config,
						resolve,
						reject,
					});
					break;
				}

				await this.createTemporaryChannel(member, config);
				resolve();

				// Add delay between channel creations to respect rate limits
				if (this.channelCreationQueue.length > 0) {
					await new Promise((resolve) =>
						setTimeout(resolve, this.channelCreationDelay),
					);
				}
			} catch (error) {
				console.error(
					`🔸 Failed to create channel for ${member.displayName}:`,
					error,
				);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		}

		this.isProcessingQueue = false;
		console.log("🔹 Channel creation queue processed");
	}

	private startOrphanedChannelWatcher(): void {
		if (this.isWatchingOrphanedChannels) {
			return;
		}

		this.isWatchingOrphanedChannels = true;

		// Check for orphaned channels every 2 minutes
		this.orphanedChannelWatcher = setInterval(
			async () => {
				await this.checkForOrphanedChannels();
			},
			2 * 60 * 1000,
		); // 2 minutes

		// Initial check after 30 seconds
		setTimeout(async () => {
			await this.checkForOrphanedChannels();
		}, 30 * 1000);
	}

	private async checkForOrphanedChannels(): Promise<void> {
		// Currently a no-op until we maintain a Redis set of active channels.
		return;
	}

	private stopOrphanedChannelWatcher(): void {
		if (this.orphanedChannelWatcher) {
			clearInterval(this.orphanedChannelWatcher);
			this.orphanedChannelWatcher = null;
		}
		this.isWatchingOrphanedChannels = false;
	}

	private async cleanupStaleChannelEntries(): Promise<void> {
		// No-op with Redis-only ownership tracking.
		if (this.debugEnabled)
			console.log(
				"🔹 Stale channel entries cleanup disabled - using Redis-only ownership tracking",
			);
		return;
	}

	private async handleVoiceStateUpdate(
		oldState: VoiceState,
		newState: VoiceState,
	) {
		// Only log significant state changes, not every update
		const username = oldState.member?.user.username || newState.member?.user.username;
		const isSignificantChange = 
			(!oldState.channelId && newState.channelId) || // User joined
			(oldState.channelId && !newState.channelId) || // User left
			(oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId); // User moved

		if (this.debugEnabled && isSignificantChange) {
			console.log(`🔍 ${username}: ${!oldState.channelId ? 'joined' : !newState.channelId ? 'left' : 'moved'} ${newState.channelId || oldState.channelId}`);
		}

		try {
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

				// Check for auto-assignment when user joins any voice channel
				await this.checkAndAutoAssignOwnership(newState.channelId);
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

				// Check for auto-assignment when user moves to a different channel
				await this.checkAndAutoAssignOwnership(newState.channelId);
			}
		} catch (error) {
			const userId = newState.member?.id || oldState.member?.id || "unknown";
			const errorCount = (this.voiceStateUpdateErrors.get(userId) || 0) + 1;
			this.voiceStateUpdateErrors.set(userId, errorCount);

			console.error(
				`🔸 Voice state update failed for user ${userId} (error ${errorCount}/${this.MAX_ERRORS_BEFORE_ALERT}):`,
				error,
			);

			if (errorCount >= this.MAX_ERRORS_BEFORE_ALERT) {
				console.error(
					`🔸 ALERT: User ${userId} has failed ${errorCount} voice state updates - requires investigation`,
				);
				// Trigger manual sync for this user
				await this.forceUserVoiceSync(userId);
			}
		}
	}

	private async forceUserVoiceSync(userId: string): Promise<void> {
		// Find user's current voice channel and sync their session
		for (const guild of Array.from(this.client.guilds.cache.values())) {
			for (const channel of Array.from(guild.channels.cache.values())) {
				if (channel.isVoiceBased() && channel.type === ChannelType.GuildVoice) {
					const member = channel.members.get(userId);
					if (member && !member.user.bot) {
						try {
							await this.sessionTracker.trackUserJoin(
								member,
								channel as VoiceChannel,
							);
							console.log(
								`✅ Force synced user ${userId} in channel ${channel.id}`,
							);
							this.voiceStateUpdateErrors.delete(userId); // Reset error count
							return;
						} catch (error) {
							console.error(`🔸 Failed to force sync user ${userId}:`, error);
						}
					}
				}
			}
		}
		console.warn(
			`🔸 Could not find user ${userId} in any voice channel for force sync`,
		);
	}

	private async handleUserJoined(newState: VoiceState) {
		const channel = newState.channel;
		if (!channel || !newState.member) {
			return;
		}

		// Check if this is a spawn channel FIRST (before tracking)
		const isSpawnChannel =
			config.spawnChannelIds?.includes(channel.id) ?? false;

		// Track voice interaction for ALL channels except spawn channels
		// This includes excluded channels - we want to track users but not manage ownership
		if (!isSpawnChannel) {
			try {
				// Validate channel data before tracking
				if (!channel.id || !channel.name || !newState.member?.id) {
					console.warn(
						`🔸 Skipping voice tracking - invalid channel data: id=${channel.id}, name=${channel.name}, memberId=${newState.member?.id}`,
					);
					return;
				}

				if (this.debugEnabled) {
					console.log(`🔍 Tracking join for ${newState.member.user.username} to ${channel.name}`);
				}
				await this.sessionTracker.trackUserJoin(
					newState.member,
					channel as VoiceChannel,
				);
			} catch (error) {
				console.warn(`🔸 Failed to track voice interaction: ${error}`);
			}
		} else {
			if (this.debugEnabled) {
				console.log(`🔍 Skipping voice tracking for spawn channel: ${channel.name}`);
			}
		}

		// Skip ownership management for excluded channels
		if (this.isReadOnlyChannel(channel.id)) {
			console.log(
				`🔸 Channel ${channel.name} (${channel.id}) is read-only, skipping ownership management`,
			);
			return;
		}

		// If not a spawn channel, we're done (ownership management already handled above)
		if (!isSpawnChannel) {
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
			spawnChannelIds: config.spawnChannelIds || [],
			channelNameTemplate: "{displayname}'s Room",
			maxChannels: 10,
			channelLimit: 10,
		};

		// Queue channel creation to handle rapid joins gracefully
		console.log(
			`🔹 Queuing channel creation for ${newState.member.displayName}`,
		);
		await new Promise<void>((resolve, reject) => {
			this.channelCreationQueue.push({
				member: newState.member as GuildMember,
				config: defaultConfig,
				resolve,
				reject,
			});
			this.processChannelCreationQueue();
		});
	}

	private async handleUserLeft(oldState: VoiceState) {
		const channel = oldState.channel;
		if (!channel || !oldState.member) return;

		if (this.debugEnabled) {
			console.log(
				`🔍 handleUserLeft called for user ${oldState.member.user.username} leaving channel ${channel.id}`,
			);
		}

		// Check if this is a spawn channel FIRST (before tracking)
		const isSpawnChannel =
			config.spawnChannelIds?.includes(channel.id) ?? false;

		// Track voice interaction for ALL channels except spawn channels
		// This includes excluded channels - we want to track users but not manage ownership
		if (!isSpawnChannel) {
			try {
				// Validate channel data before tracking
				if (!channel.id || !channel.name || !oldState.member?.id) {
					console.warn(
						`🔸 Skipping voice tracking - invalid channel data: id=${channel.id}, name=${channel.name}, memberId=${oldState.member?.id}`,
					);
					return;
				}

				if (this.debugEnabled) {
					console.log(`🔍 Tracking leave for ${oldState.member.user.username} from ${channel.name}`);
				}
				await this.sessionTracker.trackUserLeave(
					oldState.member,
					channel as VoiceChannel,
				);
			} catch (error) {
				console.warn(`🔸 Failed to update voice interaction: ${error}`);
			}
		} else {
			if (this.debugEnabled) {
				console.log(`🔍 Skipping voice tracking for spawn channel: ${channel.name}`);
			}
		}

		// Restore user's nickname when they leave any voice channel
		await this.restoreUserNickname(oldState.member.id, oldState.guild.id);

		// Skip ownership management for excluded channels
		if (this.isReadOnlyChannel(channel.id)) {
			console.log(
				`🔸 Channel ${channel.name} (${channel.id}) is read-only, skipping ownership management`,
			);
			return;
		}

		// Check if this is a dynamic voice channel (created by our system)
		if (
			channel.name.includes("'s Room | #") ||
			channel.name.includes("'s Channel")
		) {
			// Check if channel is now empty
			if (channel.members.size === 0) {
				console.log(`🔹 Auto-deleting empty dynamic channel: ${channel.name}`);
				await this.deleteTemporaryChannel(channel as VoiceChannel);
				return;
			}
		}

		const owner = await this.getChannelOwner(channel.id);
		if (!owner || owner.userId !== oldState.member.id) {
			// Check if this channel needs an owner (orphaned channel)
			await this.handleOrphanedChannel(channel as VoiceChannel);
			return;
		}

		await this.handleOwnerLeft(channel as VoiceChannel);
	}

	private async handleUserMoved(oldState: VoiceState, newState: VoiceState) {
		if (!oldState.member || !newState.member) return;

		// Check if either channel is a spawn channel
		const oldIsSpawnChannel =
			config.spawnChannelIds?.includes(oldState.channelId || "") ?? false;
		const newIsSpawnChannel =
			config.spawnChannelIds?.includes(newState.channelId || "") ?? false;

		// Track voice interaction for ALL channels except spawn channels
		// This includes excluded channels - we want to track users but not manage ownership
		if (!oldIsSpawnChannel && !newIsSpawnChannel) {
			try {
				// Validate channel data before tracking
				if (
					!oldState.channel?.id ||
					!oldState.channel?.name ||
					!newState.channel?.id ||
					!newState.channel?.name ||
					!newState.member?.id
				) {
					console.warn(
						`🔸 Skipping voice move tracking - invalid channel data: oldId=${oldState.channel?.id}, oldName=${oldState.channel?.name}, newId=${newState.channel?.id}, newName=${newState.channel?.name}, memberId=${newState.member?.id}`,
					);
					return;
				}

				await this.sessionTracker.trackUserMove(
					newState.member,
					oldState.channel as VoiceChannel,
					newState.channel as VoiceChannel,
				);
			} catch (error) {
				console.warn(`🔸 Failed to track voice move: ${error}`);
			}
		}

		// Handle spawn channel logic for moves
		if (newIsSpawnChannel) {
			await this.handleUserJoined(newState);
		} else {
			// Handle business logic (nickname restoration, channel management, etc.)
			await this.handleUserLeft(oldState);
			await this.handleUserJoined(newState);
		}
	}

	private async handleChannelUpdate(oldChannel: Channel, newChannel: Channel) {
		// Only handle voice channels
		if (
			!newChannel.isVoiceBased() ||
			newChannel.type !== ChannelType.GuildVoice
		) {
			return;
		}

		// Cast to VoiceChannel to access properties
		const oldVoiceChannel = oldChannel as VoiceChannel;
		const newVoiceChannel = newChannel as VoiceChannel;

		// Determine if topic/status or name changed
		const oldTopic = (oldVoiceChannel as unknown as { topic?: string }).topic;
		const newTopic = (newVoiceChannel as unknown as { topic?: string }).topic;
		const nameChanged = oldVoiceChannel.name !== newVoiceChannel.name;
		const statusChanged = oldTopic !== newTopic;

		// If nothing relevant changed, exit early
		if (!nameChanged && !statusChanged) {
			return;
		}

		// Check who made the change via audit logs, and gate persistence by admin
		try {
			const logs = await newVoiceChannel.guild.fetchAuditLogs({
				type: AuditLogEvent.ChannelUpdate,
				limit: 5,
			});
			const entry = logs.entries.find(
				(e) => (e.target as { id?: string } | null)?.id === newVoiceChannel.id,
			);
			if (entry?.executor) {
				const executor = entry.executor;
				const member = await newVoiceChannel.guild.members
					.fetch(executor.id)
					.catch(() => null);
				const isAdmin = Boolean(
					member?.permissions?.has?.(PermissionFlagsBits.Administrator),
				);
				if (!isAdmin) {
					console.log(
						`🔸 Skipping DB persistence for ${newVoiceChannel.name} update; executor ${executor.id} lacks admin`,
					);
					return;
				}
			}
		} catch (auditError) {
			console.warn(
				"🔸 Failed to check audit logs for channel update:",
				auditError,
			);
			return; // Fail closed: do not persist without confirming admin
		}

		// For read-only channels, we still persist allowed admin changes, but skip ownership logic later
		const isReadOnly = this.isReadOnlyChannel(newVoiceChannel.id);

		// Only log if the name actually changed
		if (nameChanged) {
			console.log(
				`🔍 Channel renamed: "${oldVoiceChannel.name}" → "${newVoiceChannel.name}"`,
			);
			console.log(`🔍 Channel ID: ${newVoiceChannel.id}`);
			console.log(
				`🔍 Is read-only: ${this.isReadOnlyChannel(newVoiceChannel.id)}`,
			);
		}

		// Check if this channel has an owner (regardless of naming pattern)
		// This allows us to capture renames for any channel that has been claimed/owned
		const owner = await this.getChannelOwner(newVoiceChannel.id);
		if (!owner) {
			console.log(
				`🔸 No owner found for channel ${newVoiceChannel.name}, skipping preference update`,
			);
			return;
		}

		console.log(
			`🔹 Found owner ${owner.userId} for channel ${newVoiceChannel.name}`,
		);

		// Update channel (name/status) in database (all channels are tracked)
		try {
			if (newVoiceChannel.guild.id === config.guildId) {
				await this.dbCore.upsertChannel({
					discordId: newVoiceChannel.id,
					guildId: newVoiceChannel.guild.id,
					channelName: newVoiceChannel.name,
					position: newVoiceChannel.position,
					isActive: true,
					activeUserIds: Array.from(newVoiceChannel.members.keys()),
					memberCount: newVoiceChannel.members.size,
					status: newTopic || undefined,
					lastStatusChange: statusChanged ? new Date() : undefined,
				});
			}
		} catch (error) {
			console.warn(`🔸 Failed to update channel name in database: ${error}`);
		}

		// If read-only, skip the rest (ownership logic below should not run)
		if (isReadOnly) {
			return;
		}

		// Update user's preferred channel name when they manually rename via Discord UI
		// This allows moderators to rename channels without using commands (avoiding rate limits)
		try {
			// Check if this rename was likely initiated by the user (not our bot)
			// We can detect this by checking if the new name doesn't match our naming patterns
			const isUserInitiatedRename = !(await this.isBotGeneratedName(
				newVoiceChannel.name,
				owner.userId,
			));

			if (isUserInitiatedRename) {
				console.log(
					`🔹 User manually renamed channel to: "${newVoiceChannel.name}"`,
				);

				// Update the user's preferred channel name in the database
				await this.updateUserPreferredChannelName(
					owner.userId,
					newVoiceChannel.guild.id,
					newVoiceChannel.name,
				);

				console.log(
					`✅ Updated preferred channel name for user ${owner.userId}: "${newVoiceChannel.name}"`,
				);
			} else {
				console.log(
					"🔸 Skipping preference update - rename appears to be bot-generated",
				);
			}
		} catch (error) {
			console.warn(`🔸 Failed to update preferred channel name: ${error}`);
		}
	}

	/**
	 * Check if a channel name appears to be generated by our bot
	 * This helps distinguish between bot-initiated renames and user-initiated renames
	 */
	private async isBotGeneratedName(
		channelName: string,
		ownerId: string,
	): Promise<boolean> {
		// Get the owner's display name to check against our naming patterns
		const guild = this.client.guilds.cache.first();
		if (!guild) return false;

		const member = guild.members.cache.get(ownerId);
		if (!member) return false;

		const ownerDisplayName =
			member.nickname || member.displayName || member.user.username;
		const expectedBotName = `${ownerDisplayName}'s Channel`;

		// Check if this matches our default bot naming pattern
		if (channelName === expectedBotName) {
			return true;
		}

		// Check if this matches the user's preferred channel name (also bot-generated)
		try {
			const preferences = await this.getUserPreferences(ownerId, guild.id);
			if (
				preferences?.preferredChannelName &&
				channelName === preferences.preferredChannelName
			) {
				return true;
			}
		} catch (error) {
			// If we can't get preferences, assume it's user-initiated
		}

		// If it doesn't match either pattern, it's likely user-initiated
		return false;
	}

	/**
	 * Update user's preferred channel name in the database
	 */
	private async updateUserPreferredChannelName(
		userId: string,
		guildId: string,
		channelName: string,
	): Promise<void> {
		try {
			// Use existing DatabaseCore instance instead of creating a new one
			await this.dbCore.updateModPreferences(userId, guildId, {
				preferredChannelName: channelName,
			});

			// Invalidate cache to ensure fresh data is fetched
			await this.cache.invalidateUserPreferences(userId, guildId);

			// Force cache refresh by getting preferences (this will populate cache with fresh data)
			await this.cache.getUserPreferences(userId, guildId);

			console.log(
				`🔹 Successfully updated preferred channel name to "${channelName}"`,
			);
		} catch (error) {
			console.error(
				`🔸 Failed to update preferred channel name in database: ${error}`,
			);
			throw error;
		}
	}

	private async isDynamicChannel(channelId: string): Promise<boolean> {
		try {
			const channelOwner = await this.getChannelOwner(channelId);
			return !!channelOwner;
		} catch (error) {
			console.error(
				`🔸 Error checking if channel ${channelId} is dynamic:`,
				error,
			);
			return false;
		}
	}

	async createTemporaryChannel(
		member: GuildMember,
		config: VoiceChannelConfig,
	): Promise<void> {
		// Generate unique channel name with random ID
		const randomId = Math.floor(Math.random() * 1000)
			.toString()
			.padStart(3, "0");

		// Get the proper channel name using our centralized naming service
		const memberDisplayName =
			member.nickname || member.displayName || member.user.username;

		// Check if user has a preferred channel name in their preferences
		let channelName = `${memberDisplayName}'s Channel`; // Default fallback

		try {
			const preferences = await this.getUserPreferences(
				member.id,
				member.guild.id,
			);
			if (preferences?.preferredChannelName) {
				channelName = preferences.preferredChannelName;
				console.log(`🔹 Using user's preferred channel name: "${channelName}"`);
			}
		} catch (error) {
			console.warn(
				`🔸 Failed to get user preferences for channel naming: ${error}`,
			);
			// Fall back to default naming
		}

		// Get the spawn channel to determine positioning and privacy settings
		// Use the first spawn channel if multiple are configured
		const spawnChannelId = config.spawnChannelIds?.[0];
		if (!spawnChannelId) {
			console.warn("🔸 No spawn channels configured");
			return;
		}

		const spawnChannel = member.guild.channels.cache.get(spawnChannelId);
		if (!spawnChannel || !spawnChannel.isVoiceBased()) {
			console.warn(
				`🔸 Spawn channel ${spawnChannelId} not found or not a voice channel`,
			);
			return;
		}

		// Calculate position - place directly above the spawn channel
		// Set position to spawnChannelPosition - 1 to ensure it appears above
		const spawnChannelPosition = spawnChannel.position;
		const newChannelPosition = Math.max(0, spawnChannelPosition - 1);

		console.log(
			`🔹 Creating channel "${channelName}" at position ${newChannelPosition} (spawn channel is at position ${spawnChannelPosition})`,
		);

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

		// Build permission overwrites array - Grant CHANNEL-SPECIFIC permissions only
		// NOTE: MoveMembers, MuteMembers, DeafenMembers, ManageRoles are SERVER-WIDE permissions and should NOT be granted to channel owners
		let permissionOverwrites: Array<{
			id: string;
			allow?: bigint[];
			deny?: bigint[];
		}> = [
			{
				id: member.id,
				allow: [
					PermissionFlagsBits.ManageChannels, // Allows renaming, deleting, etc. (channel-specific)
					PermissionFlagsBits.CreateInstantInvite, // Create invites for this channel
					PermissionFlagsBits.Connect, // Connect to voice
					PermissionFlagsBits.Speak, // Speak in voice
					PermissionFlagsBits.UseVAD, // Use voice activity detection
					PermissionFlagsBits.PrioritySpeaker, // Priority speaker
					PermissionFlagsBits.Stream, // Stream video
					// REMOVED: MoveMembers, MuteMembers, DeafenMembers, ManageRoles (these are server-wide permissions!)
				],
			},
		];

		// Inherit privacy settings from spawn channel
		if (isSpawnChannelPrivate) {
			// Use the centralized permission cloning utility
			console.log(
				`🔹 Copying ALL permission overwrites from spawn channel ${spawnChannel.name}`,
			);

			// We'll clone permissions after channel creation since we need the channel object
			permissionOverwrites = []; // Clear the array since we'll handle this separately
		}

		const channel = await member.guild.channels.create({
			name: channelName,
			type: ChannelType.GuildVoice,
			parent: member.voice.channel?.parent,
			position: newChannelPosition,
			permissionOverwrites,
		});

		// Clone permissions from spawn channel if it was private
		if (isSpawnChannelPrivate) {
			try {
				await clonePermissionOverwrites(
					spawnChannel as VoiceChannel,
					channel,
					member.id,
				);
			} catch (error) {
				console.error(
					"🔸 Error cloning permissions from spawn channel:",
					error,
				);
			}
		}

		await member.voice.setChannel(channel as VoiceChannel);
		await this.setChannelOwner(channel.id, member.id, member.guild.id);

		// Track channel in database (newly created channels are not excluded)
		try {
			if (channel.guild.id === config.guildId) {
				await this.dbCore.upsertChannel({
					discordId: channel.id,
					guildId: channel.guild.id,
					channelName: channel.name,
					position: channel.position,
					isActive: true,
					activeUserIds: [member.id],
					memberCount: 1,
				});
			}
		} catch (error) {
			console.warn(`🔸 Failed to track new channel in database: ${error}`);
		}

		// Wait a moment for Discord to fully process the channel creation
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Apply user preferences to the new channel
		await this.applyUserPreferencesToChannel(channel.id, member.id);

		try {
			const embed = new EmbedBuilder()
				.setTitle(`**${member.user.displayName || member.user.username}**`)
				.setDescription(
					"Welcome to your channel, as the moderator you can use the following commands.",
				)
				.addFields({
					name: "Available Commands",
					value: [
						"`/disconnect` - Disconnect users",
						"`/kick` - Kick users from channel",
						"`/ban` - Ban/Unban users",
						"`/mute` - Mute/Unmute users",
						"`/deafen` - Deafen/Undeafen users",
						"`/rename` - Change channel name",
						"`/limit` - Set user limit",
						"`/lock` - Lock/Unlock channel",
						"`/hide` - Hide/Show channel",
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
		// Skip read-only channels
		if (this.isReadOnlyChannel(channel.id)) {
			console.log(
				`🔸 Channel ${channel.name} (${channel.id}) is read-only, skipping owner left handling`,
			);
			return;
		}

		const members = channel.members.filter((member) => !member.user.bot);

		if (members.size === 0) {
			// No members left, delete the channel
			await this.deleteTemporaryChannel(channel);
		} else {
			// Find the longest standing user using voice activity data
			const newOwner = await this.findLongestStandingUser(channel, members);
			if (!newOwner) return;

			// Clear user-specific permission overwrites but preserve role-based permissions
			// This fixes the issue where verified role permissions were being lost during ownership transfers
			const permissionOverwrites = channel.permissionOverwrites.cache;
			let deletedUserPermissions = 0;
			let preservedRolePermissions = 0;

			for (const [id, overwrite] of permissionOverwrites) {
				// Skip new owner, @everyone role, and all other roles
				if (
					id !== newOwner.id &&
					id !== channel.guild.roles.everyone.id &&
					!channel.guild.roles.cache.has(id)
				) {
					// Only delete user-specific permissions, not role-based ones
					await overwrite.delete(
						"Ownership transfer - clearing old user permissions",
					);
					deletedUserPermissions++;
				} else if (channel.guild.roles.cache.has(id)) {
					preservedRolePermissions++;
				}
			}

			console.log(
				`🔹 Ownership transfer: Deleted ${deletedUserPermissions} user permissions, preserved ${preservedRolePermissions} role permissions`,
			);

			// Set new owner permissions - CHANNEL-SPECIFIC ONLY
			// NOTE: Do NOT grant server-wide moderation permissions to channel owners
			await channel.permissionOverwrites.create(newOwner.id, {
				ManageChannels: true, // Channel-specific: rename, delete channel
				CreateInstantInvite: true, // Channel-specific: create invites
				Connect: true, // Channel-specific: connect to voice
				Speak: true, // Channel-specific: speak in voice
				UseVAD: true, // Channel-specific: use voice activity detection
				PrioritySpeaker: true, // Channel-specific: priority speaker
				Stream: true, // Channel-specific: stream video
				// REMOVED: MoveMembers, MuteMembers, DeafenMembers, ManageRoles (server-wide permissions!)
			});

			await this.setChannelOwner(channel.id, newOwner.id, channel.guild.id);

			// Update call state with new owner but preserve current call state
			const currentCallState = await this.getCallState(channel.id);
			if (currentCallState) {
				currentCallState.currentOwner = newOwner.id;
				currentCallState.lastUpdated = new Date();
				await this.updateCallState(currentCallState);
			}

			// Apply new owner's preferences using centralized method
			await this.applyUserPreferencesToChannel(channel.id, newOwner.id);

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

	/**
	 * Handle channels that don't have owners (orphaned channels)
	 * This assigns ownership to the longest-standing user and renames the channel
	 */
	private async handleOrphanedChannel(channel: VoiceChannel): Promise<void> {
		try {
			// Skip read-only channels
			if (this.isReadOnlyChannel(channel.id)) {
				console.log(
					`🔸 Channel ${channel.name} (${channel.id}) is read-only, skipping orphaned channel handling`,
				);
				return;
			}

			// Skip "Available Channel" - these should remain unowned
			if (channel.name.toLowerCase().includes("available")) {
				return;
			}

			// Skip if channel is empty
			const members = channel.members.filter((member) => !member.user.bot);
			if (members.size === 0) {
				return;
			}

			// Check if current owner is actually in the channel
			const currentOwner = await this.getChannelOwner(channel.id);
			if (currentOwner) {
				const ownerInChannel = members.has(currentOwner.userId);
				if (ownerInChannel) {
					// Owner is present, no need to reassign
					return;
				}
				// Owner is not in channel - remove their ownership
				console.log(
					`🔸 Owner ${currentOwner.userId} is not in channel, removing ownership`,
				);
				await this.removeChannelOwner(channel.id);
			}

			// Find the longest standing user
			const longestUser = await this.findLongestStandingUser(channel, members);
			if (!longestUser) {
				return;
			}

			// Auto-assigning ownership to longest-standing user

			// Assign ownership to the longest-standing user
			await this.setChannelOwner(channel.id, longestUser.id, channel.guild.id);

			// Set owner permissions
			await channel.permissionOverwrites.create(longestUser.id, {
				ManageChannels: true,
				CreateInstantInvite: true,
				Connect: true,
				Speak: true,
				UseVAD: true,
				PrioritySpeaker: true,
				Stream: true,
			});

			// Apply user preferences to the channel
			await this.applyUserPreferencesToChannel(channel.id, longestUser.id);

			// Apply nicknames to all current members based on new owner's preferences
			for (const [userId, member] of channel.members) {
				if (!member.user.bot) {
					await this.applyNicknamesToNewJoiner(channel.id, userId);
				}
			}

			const embed = new EmbedBuilder()
				.setTitle("🤖 Auto-Assigned Ownership")
				.setDescription(
					`**${longestUser.displayName || longestUser.user.username}** has been automatically assigned as the owner of this channel based on their total time spent here.`,
				)
				.setColor(0x51cf66)
				.setTimestamp();

			try {
				await channel.send({ embeds: [embed] });
			} catch (_error) {
				// Continue without sending the message - ownership assignment still succeeded
			}
		} catch (error) {
			console.error(`🔸 Error handling orphaned channel ${channel.id}:`, error);
		}
	}

	/**
	 * Universal ownership synchronization system
	 * Handles all miscalibrations between different sources of truth
	 */
	private async universalOwnershipSync(channelId: string): Promise<void> {
		try {
			// Skip read-only channels
			if (this.isReadOnlyChannel(channelId)) {
				console.log(
					`🔸 Channel ${channelId} is read-only, skipping universal ownership sync`,
				);
				return;
			}

			// Get all sources of ownership information
			const dbOwner = await this.getChannelOwner(channelId);
			const channel = this.client.channels.cache.get(channelId) as VoiceChannel;

			if (!channel || !channel.isVoiceBased()) {
				return;
			}

			// Get current active members
			const currentMembers = new Set<string>();
			for (const [userId, member] of channel.members) {
				if (!member.user.bot) {
					currentMembers.add(userId);
				}
			}

			// Get longest-standing user from voice sessions
			const longestUser = await this.findLongestStandingUser(
				channel,
				channel.members,
			);

			let correctOwner: string | null = null;
			let ownershipSource = "";

			// Priority 1: Owner must be currently in the channel
			if (dbOwner && currentMembers.has(dbOwner.userId)) {
				correctOwner = dbOwner.userId;
				ownershipSource = "Database (owner is active)";
			} else if (dbOwner && !currentMembers.has(dbOwner.userId)) {
				console.log(
					`🔸 Database owner ${dbOwner.userId} is not in channel - invalidating`,
				);
				await this.removeChannelOwner(channelId);
			}

			// Priority 2: If no valid owner, assign to longest-standing user in channel
			if (!correctOwner && longestUser && currentMembers.has(longestUser.id)) {
				correctOwner = longestUser.id;
				ownershipSource = "Longest-standing user (active)";
			}

			// Priority 3: If no one is active, assign to longest-standing user overall
			if (!correctOwner && longestUser) {
				correctOwner = longestUser.id;
				ownershipSource = "Longest-standing user (inactive)";
			}

			// Apply correct ownership if different from current
			if (correctOwner && (!dbOwner || dbOwner.userId !== correctOwner)) {
				await this.setChannelOwner(channelId, correctOwner, channel.guild.id);

				// Set owner permissions
				const newOwnerMember = channel.members.get(correctOwner);
				if (newOwnerMember) {
					await channel.permissionOverwrites.create(correctOwner, {
						ManageChannels: true,
						CreateInstantInvite: true,
						Connect: true,
						Speak: true,
						UseVAD: true,
						PrioritySpeaker: true,
						Stream: true,
					});
				}

				// Apply user preferences
				await this.applyUserPreferencesToChannel(channelId, correctOwner);
			}
		} catch (error) {
			console.error(
				`🔸 Error in universal ownership sync for ${channelId}:`,
				error,
			);
		}
	}
	private async checkAndAutoAssignOwnership(channelId: string): Promise<void> {
		try {
			// Skip read-only channels
			if (this.isReadOnlyChannel(channelId)) {
				console.log(
					`🔸 Channel ${channelId} is read-only, skipping auto-assign ownership`,
				);
				return;
			}

			// Get the channel from the guild
			const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
			if (!channel) {
				console.warn(`🔸 Channel ${channelId} not found`);
				return;
			}

			// Use universal sync instead of the old logic
			await this.universalOwnershipSync(channel.id);

			// Find user with longest total duration in this channel
			const longestUser = await this.findLongestStandingUser(
				channel,
				channel.members,
			);
			if (!longestUser) {
				return; // Couldn't determine longest-standing user
			}

			// Auto-assigning ownership to longest-standing user

			// Set ownership
			await this.setChannelOwner(channel.id, longestUser.id, channel.guild.id);

			// Set permissions for the new owner
			await channel.permissionOverwrites.create(longestUser.id, {
				ManageChannels: true,
				CreateInstantInvite: true,
				Connect: true,
				Speak: true,
				UseVAD: true,
				PrioritySpeaker: true,
				Stream: true,
			});

			// Apply new owner's preferences
			await this.applyUserPreferencesToChannel(channelId, longestUser.id);

			// Try to rename channel to owner's preferred name or default name
			const ownerDisplayName =
				longestUser.displayName || longestUser.user.username;

			// Check if user has a preferred channel name
			let expectedChannelName = `${ownerDisplayName}'s Channel`; // Default fallback
			try {
				const preferences = await this.getUserPreferences(
					longestUser.id,
					channel.guild.id,
				);
				if (preferences?.preferredChannelName) {
					expectedChannelName = preferences.preferredChannelName;
					console.log(
						`🔹 Using owner's preferred channel name: "${expectedChannelName}"`,
					);
				}
			} catch (error) {
				console.warn(
					`🔸 Failed to get user preferences for channel naming: ${error}`,
				);
				// Fall back to default naming
			}

			if (
				!channel.name.includes(ownerDisplayName) &&
				!channel.name.toLowerCase().includes("available") &&
				channel.name !== expectedChannelName
			) {
				try {
					await channel.setName(expectedChannelName);
					console.log(`🔹 Renamed channel to "${expectedChannelName}"`);
				} catch (error) {
					console.log(`🔸 Could not rename channel: ${error}`);
					// Continue without renaming - ownership assignment still succeeded
				}
			}

			// Send notification
			const embed = new EmbedBuilder()
				.setTitle("🤖 Auto-Assigned Ownership")
				.setDescription(
					`**${ownerDisplayName}** has been automatically assigned as the owner of this channel based on their total time spent here.`,
				)
				.setColor(0x51cf66)
				.setTimestamp();

			try {
				await channel.send({ embeds: [embed] });
			} catch (_error) {
				// Failed to send message, but ownership assignment still succeeded
			}
		} catch (error) {
			console.error(
				`🔸 Error in auto-assignment for channel ${channelId}:`,
				error,
			);
		}
	}

	async deleteTemporaryChannel(channel: VoiceChannel): Promise<void> {
		try {
			// Remove channel from database tracking (all channels are tracked)
			try {
				await this.dbCore.deleteChannel(channel.id, channel.guild.id);
			} catch (error) {
				console.warn(`🔸 Failed to remove channel from database: ${error}`);
			}

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
		// Skip ownership changes for read-only channels
		if (this.isReadOnlyChannel(channelId)) {
			console.log(
				`🔸 Channel ${channelId} is read-only, skipping ownership assignment`,
			);
			return;
		}

		// Get current owner to track as previous owner
		const currentOwner = await this.getChannelOwner(channelId);

		await this.cache.setChannelOwnershipCache(channelId, {
			userId,
			ownedSince: new Date(),
			previousOwnerId: currentOwner?.userId,
		});

		// Apply only channel-level preferences immediately (name, limit, lock)
		// User-specific preferences (mutes, blocks) will only affect incoming users
		const channel = this.client.channels.cache.get(channelId);
		if (channel?.isVoiceBased()) {
			const voiceChannel = channel as VoiceChannel;
			const preferences = await this.getUserPreferences(userId, guildId);

			// Channel naming is now handled during creation, no need to rename here
			// await this.namingService.setNameForOwner(voiceChannel, userId, {
			// 	skipRenamePatterns: ["available", "new channel", "temp"],
			// });

			if (preferences) {
				// User limit - applies immediately to channel capacity
				if (preferences.preferredUserLimit) {
					try {
						await voiceChannel.setUserLimit(preferences.preferredUserLimit);
					} catch (_error) {
						// Insufficient permissions to change user limit
					}
				}
				// Lock status - applies immediately to channel access
				if (preferences.preferredLocked !== undefined) {
					try {
						await voiceChannel.permissionOverwrites.edit(
							voiceChannel.guild.roles.everyone,
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
		const ownershipData = await this.cache.getChannelOwnershipCache(channelId);
		if (!ownershipData) return null;

		return {
			channelId,
			userId: ownershipData.userId,
			guildId: "unknown", // We'll need to get this from the channel
			createdAt: ownershipData.ownedSince,
			lastActivity: new Date(),
			previousOwnerId: ownershipData.previousOwnerId,
		};
	}

	async removeChannelOwner(channelId: string): Promise<void> {
		await this.cache.removeChannelOwnershipCache(channelId);
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
		// Return default config - guild configs are no longer cached
		const defaultConfig: VoiceChannelConfig = {
			guildId,
			spawnChannelIds: config.spawnChannelIds || [],
			channelNameTemplate: "{displayname}'s Room",
			maxChannels: 10,
			channelLimit: 10,
		};

		return defaultConfig;
	}

	async logModerationAction(
		log: Omit<ModerationLog, "id" | "timestamp">,
	): Promise<void> {
		try {
			await this.dbCore.addModHistory(log.performerId, log.guildId, {
				action: log.action,
				targetUserId: log.targetId || "unknown",
				channelId: log.channelId,
				reason: log.reason,
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
		// DISABLED: This method causes channel naming conflicts
		// Channel naming is now handled by ChannelNamingService
		console.log(
			"🔸 applyUserPreferencesToChannel disabled to prevent naming conflicts",
		);
		return;
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
		if (!callState || !callState.currentOwner) {
			// No call state or no current owner - skip preference application
			return;
		}

		// Get the guild ID from the channel
		const channel = await this.client.channels.fetch(channelId);
		if (
			!channel ||
			!channel.isVoiceBased() ||
			channel.type !== ChannelType.GuildVoice
		) {
			return;
		}

		const preferences = await this.getUserPreferences(
			callState.currentOwner,
			channel.guild.id,
		);
		if (!preferences) {
			// No preferences found - this is normal for new users
			return;
		}

		const member = channel.members.get(userId);
		if (!member) {
			return;
		}

		// Check if user should be banned
		if (preferences.bannedUsers.includes(userId)) {
			console.log(
				`🔹 Applying owner preferences: Disconnecting banned user ${userId} from channel ${channelId}`,
			);
			try {
				await member.voice.disconnect("Owner preferences: pre-banned");
				return;
			} catch (error) {
				console.warn(`🔸 Failed to disconnect banned user ${userId}: ${error}`);
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
		limit = 10,
	): Promise<ModerationLog[]> {
		try {
			// Get all users in the guild to find moderation logs
			const channel = this.client.channels.cache.get(channelId);
			if (!channel?.isVoiceBased()) return [];

			const guildId = channel.guild.id;
			const users = await this.dbCore.getUsersByGuild(guildId);

			const allLogs: ModerationLog[] = [];

			for (const user of users) {
				const modHistory = await this.dbCore.getUserModHistory(
					user.discordId,
					guildId,
					limit,
				);
				for (const entry of modHistory) {
					if (entry.channelId === channelId) {
						allLogs.push({
							id: `${entry.channelId}-${user.discordId}-${entry.timestamp.getTime()}`,
							channelId: entry.channelId,
							performerId: user.discordId,
							targetId: entry.targetUserId,
							action: entry.action as ModerationLog["action"],
							reason: entry.reason,
							timestamp: entry.timestamp,
							guildId,
						});
					}
				}
			}

			// Sort by timestamp descending and limit results
			return allLogs
				.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
				.slice(0, limit);
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
		color = 0x00ff00,
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
			// Try Redis cache first for real-time data
			const cachedMembers = await this.cache.getChannelMembers(channel.id);
			if (cachedMembers.length > 0) {
				const earliest = cachedMembers.sort(
					(a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
				)[0];
				const member = members.get(earliest.userId);
				if (member) return member;
			}

			// Fallback to database - get users and compare their voice interactions
			const userIds = Array.from(members.keys());
			const users = await this.dbCore.getUsersInGuild(
				channel.guild.id,
				userIds,
			);

			let longestUser: GuildMember | null = null;
			let earliestJoin: Date | null = null;

			for (const user of users) {
				// Get active voice interactions for this channel
				const activeInteractions = user.voiceInteractions.filter(
					(interaction) =>
						interaction.channelId === channel.id && !interaction.leftAt,
				);

				if (activeInteractions.length > 0) {
					// Sort by join time and get the earliest
					const earliestInteraction = activeInteractions.sort(
						(a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
					)[0];

					if (!earliestJoin || earliestInteraction.joinedAt < earliestJoin) {
						earliestJoin = earliestInteraction.joinedAt;
						longestUser = members.get(user.discordId) || null;
					}
				}
			}

			// If no user found with voice interaction data, return the first member
			return longestUser || members.first() || null;
		} catch (error) {
			console.warn(`🔸 Error finding longest standing user: ${error}`);
			// Fallback to first member
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
				reason: "Nickname reset to original",
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
				reason: "All nicknames reset",
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
			for (const channel of Array.from(guild.channels.cache.values())) {
				if (channel.isVoiceBased()) {
					const owner = await this.getChannelOwner(channel.id);
					if (owner) {
						const preferences = await this.getUserPreferences(
							owner.userId,
							guildId,
						);
						if (preferences?.renamedUsers) {
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
			try {
				await member.setNickname(
					originalNickname,
					"User left voice channel - nickname restored",
				);
			} catch (error) {
				// Log permission errors but don't fail the entire operation
				if (
					error instanceof Error &&
					error.message.includes("Missing Permissions")
				) {
					console.warn(
						`🔸 Missing permissions to restore nickname for user ${userId}: ${error.message}`,
					);
				} else {
					throw error; // Re-throw other errors
				}
			}

			// Remove all rename records for this user
			for (const ownerId of channelsToUpdate) {
				const preferences = await this.getUserPreferences(ownerId, guildId);
				if (preferences?.renamedUsers) {
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
		// Skip nickname application for read-only channels
		if (this.isReadOnlyChannel(channelId)) {
			return;
		}

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

	/**
	 * Get comprehensive channel state information
	 * @param channelId The voice channel ID
	 * @returns Channel state data including owner, members, moderation info, and inheritance order
	 */
	// ==================== PUBLIC ORPHANED CHANNEL METHODS ====================

	/**
	 * Manually trigger orphaned channel cleanup
	 */
	async cleanupOrphanedChannels(): Promise<{
		cleaned: number;
		errors: string[];
	}> {
		const errors: string[] = [];
		let cleaned = 0;

		try {
			if (this.debugEnabled)
				console.log("🔧 Manual orphaned channel cleanup triggered");

			const orphanedChannels: VoiceChannel[] = [];

			// Check all guilds
			for (const guild of Array.from(this.client.guilds.cache.values())) {
				// Find all voice channels that match our naming pattern
				const dynamicChannels = guild.channels.cache.filter(
					(channel) =>
						channel.type === ChannelType.GuildVoice &&
						(channel.name.includes("'s Room | #") ||
							channel.name.includes("'s Channel")),
				) as Collection<string, VoiceChannel>;

				for (const channel of Array.from(dynamicChannels.values())) {
					// Check if channel is empty
					if (channel.members.size === 0) {
						// Check if channel has an owner in our database
						const owner = await this.getChannelOwner(channel.id);

						if (owner) {
							// Channel has an owner but is empty - this is an orphaned channel
							orphanedChannels.push(channel);
						}
					}
				}
			}

			// Clean up orphaned channels
			for (const channel of orphanedChannels) {
				try {
					// Remove owner from database
					await this.removeChannelOwner(channel.id);

					// Delete the channel
					await this.deleteTemporaryChannel(channel);

					cleaned++;
					console.log(`✅ Cleaned up orphaned channel: ${channel.name}`);
				} catch (error) {
					const errorMsg = `Failed to clean up orphaned channel ${channel.name}: ${error}`;
					errors.push(errorMsg);
					console.error(`🔸 ${errorMsg}`);
				}
			}

			if (this.debugEnabled)
				console.log(
					`🔧 Manual cleanup completed: ${cleaned} channels cleaned, ${errors.length} errors`,
				);
		} catch (error) {
			const errorMsg = `Manual orphaned channel cleanup failed: ${error}`;
			errors.push(errorMsg);
			console.error(`🔸 ${errorMsg}`);
		}

		return { cleaned, errors };
	}

	/**
	 * Get statistics about orphaned channels
	 * @returns Promise<{ total: number; orphaned: number; details: Array<{ name: string; owner: string; empty: boolean }> }>
	 */
	async getOrphanedChannelStats(): Promise<{
		total: number;
		orphaned: number;
		details: Array<{ name: string; owner: string; empty: boolean }>;
	}> {
		const details: Array<{ name: string; owner: string; empty: boolean }> = [];
		let total = 0;
		let orphaned = 0;

		try {
			// Check all guilds
			for (const guild of Array.from(this.client.guilds.cache.values())) {
				// Find all voice channels that match our naming pattern
				const dynamicChannels = guild.channels.cache.filter(
					(channel) =>
						channel.type === ChannelType.GuildVoice &&
						(channel.name.includes("'s Room | #") ||
							channel.name.includes("'s Channel")),
				) as Collection<string, VoiceChannel>;

				total += dynamicChannels.size;

				for (const channel of Array.from(dynamicChannels.values())) {
					const owner = await this.getChannelOwner(channel.id);
					const isEmpty = channel.members.size === 0;

					details.push({
						name: channel.name,
						owner: owner?.userId || "No owner",
						empty: isEmpty,
					});

					if (owner && isEmpty) {
						orphaned++;
					}
				}
			}
		} catch (error) {
			console.error("🔸 Error getting orphaned channel stats:", error);
		}

		return { total, orphaned, details };
	}

	// ==================== REALTIME TRACKING METHODS ====================

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
			await this.dbCore.upsertMessage(dbMessage);

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
			await this.dbCore.upsertMessage(dbMessage);
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
				guildId: newMember.guild.id,
				username: newMember.user.username,
				displayName: newMember.displayName,
				nickname: newMember.nickname || undefined,
				discriminator: newMember.user.discriminator,
				avatar: newAvatarUrl,
				avatarHistory: [],
				bot: newMember.user.bot,
				usernameHistory: [],
				displayNameHistory: [],
				nicknameHistory: [],
				roles: newMember.roles.cache.map((role) => role.id),
				joinedAt: newMember.joinedAt || now,
				lastSeen: now,
				statusHistory: [],
				status: newStatus,
				relationships: [],
				voiceInteractions: [],
				modPreferences: {
					bannedUsers: [],
					mutedUsers: [],
					kickedUsers: [],
					deafenedUsers: [],
					renamedUsers: [],
					modHistory: [],
					lastUpdated: now,
				},
			};

			await this.dbCore.upsertUser(user);

			// Note: Avatar and status change tracking would need to be implemented in DatabaseCore
		} catch (error) {
			console.error("🔸 Error tracking guild member update:", error);
		}
	}

	// ==================== UTILITY METHODS ====================

	getActiveVoiceSessions(): Map<string, VoiceInteraction> {
		return this.activeVoiceSessions;
	}

	async cleanupActiveSessions(): Promise<void> {
		try {
			// Close all active sessions
			for (const [userId, session] of this.activeVoiceSessions) {
				const leftAt = new Date();
				await this.dbCore.updateVoiceInteraction(
					userId,
					session.guildId,
					session.channelId,
					leftAt,
					0,
				);
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
			// Get user data to find active voice interactions
			const user = await this.dbCore.getUser(userId, guildId);
			if (!user) return;

			const activeSessions = user.voiceInteractions.filter(
				(interaction) => !interaction.leftAt,
			);

			if (activeSessions.length > 0) {
				console.log(
					`🔹 Closing ${activeSessions.length} active sessions for user ${userId}`,
				);

				// Close each active session
				for (const session of activeSessions) {
					const leftAt = new Date();
					await this.dbCore.updateVoiceInteraction(
						userId,
						guildId,
						session.channelId,
						leftAt,
						0, // Duration will be calculated by the database
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

	/**
	 * Cleanup method to stop watchers and clear resources
	 */
	async cleanup(): Promise<void> {
		this.stopOrphanedChannelWatcher();
		this.stopSessionReconciliation();
		await this.cleanupActiveSessions();
		if (this.debugEnabled) console.log("🔹 VoiceManager cleanup completed");
	}

	async getChannelState(channelId: string): Promise<{
		owner: VoiceChannelOwner | null;
		memberIds: string[];
		moderationInfo: {
			bannedUsers: string[];
			mutedUsers: string[];
			deafenedUsers: string[];
		};
		inheritanceOrder: Array<{ userId: string; duration: number }>;
		createdAt: Date;
		guildId: string;
		channelName: string;
	}> {
		try {
			const channel = this.client.channels.cache.get(channelId) as VoiceChannel;
			if (!channel || !channel.isVoiceBased()) {
				throw new Error("Channel not found or not a voice channel");
			}

			// Get channel owner
			const owner = await this.getChannelOwner(channelId);

			// Get current member IDs (excluding bots)
			const memberIds = Array.from(channel.members.keys()).filter(
				(id) => !channel.members.get(id)?.user.bot,
			);

			// PostgreSQL implementation pending; return basic state without inheritance order
			return {
				owner,
				memberIds,
				moderationInfo: {
					bannedUsers: [],
					mutedUsers: [],
					deafenedUsers: [],
				},
				inheritanceOrder: [],
				createdAt: channel.createdAt,
				guildId: channel.guild.id,
				channelName: channel.name,
			};
		} catch (error) {
			console.error("🔸 Error getting channel state:", error);
			throw error;
		}
	}
}

export function voiceManager(client: Client): VoiceManager {
	const manager = new VoiceManager(client);
	// Initialize database connection
	manager.initialize().catch(console.error);
	return manager;
}
