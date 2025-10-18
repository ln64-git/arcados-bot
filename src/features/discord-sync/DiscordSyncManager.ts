import type {
	Channel,
	Client,
	Guild,
	GuildMember,
	Message,
	Role,
} from "discord.js";
import type { SurrealDBManager } from "../../database/SurrealDBManager";
import type { DatabaseResult } from "../../database/schema";
import {
	type SurrealChannel,
	type SurrealGuild,
	type SurrealMember,
	type SurrealMessage,
	type SurrealRole,
	discordChannelToSurreal,
	discordGuildToSurreal,
	discordMemberToSurreal,
	discordMessageToSurreal,
	discordRoleToSurreal,
} from "../../database/schema";
import { SyncStateManager } from "./SyncStateManager";
import { UserHistoryTracker } from "./UserHistoryTracker";

export class DiscordSyncManager {
	private client: Client;
	private db: SurrealDBManager;
	private syncing = false;
	private shuttingDown = false;
	private syncState: SyncStateManager;
	private userHistory: UserHistoryTracker;

	constructor(client: Client, db: SurrealDBManager) {
		this.client = client;
		this.db = db;
		this.syncState = new SyncStateManager(db);
		this.userHistory = new UserHistoryTracker();
	}

	async initialize(): Promise<void> {
		if (!this.db.isConnected()) {
			console.log("🔸 Database not connected, skipping sync initialization");
			return;
		}

		// Set up Discord event handlers
		this.setupDiscordEventHandlers();

		// Perform startup sync (incremental or full as needed)
		await this.performStartupSync();
	}

	private setupDiscordEventHandlers(): void {
		// Guild events
		this.client.on("guildCreate", async (guild) => {
			await this.syncGuild(guild);
		});

		this.client.on("guildUpdate", async (oldGuild, newGuild) => {
			await this.syncGuild(newGuild);
		});

		this.client.on("guildDelete", async (guild) => {
			await this.markGuildInactive(guild.id);
		});

		// Channel events
		this.client.on("channelCreate", async (channel) => {
			if ("guild" in channel && channel.guild) {
				await this.syncChannel(channel, channel.guild.id);
			}
		});

		this.client.on("channelUpdate", async (oldChannel, newChannel) => {
			if ("guild" in newChannel && newChannel.guild) {
				await this.syncChannel(newChannel, newChannel.guild.id);
			}
		});

		this.client.on("channelDelete", async (channel) => {
			if ("guild" in channel && channel.guild) {
				await this.markChannelInactive(channel.id);
			}
		});

		// Member events
		this.client.on("guildMemberAdd", async (member) => {
			await this.syncMemberWithHistory(member);
		});

		this.client.on("guildMemberUpdate", async (oldMember, newMember) => {
			await this.syncMemberWithHistory(newMember);
		});

		this.client.on("guildMemberRemove", async (member) => {
			await this.markMemberInactive(member.id, member.guild.id);
		});

		// User events (global profile changes like username, avatar)
		this.client.on("userUpdate", async (oldUser, newUser) => {
			console.log(
				`🔹 UserUpdate event received for ${newUser.username} (${newUser.id})`,
			);

			// Sync the user in all guilds where they are a member
			let syncedGuilds = 0;
			for (const guild of this.client.guilds.cache.values()) {
				const member = guild.members.cache.get(newUser.id);
				if (member) {
					console.log(
						`🔹 Syncing user ${newUser.username} in guild ${guild.name}`,
					);
					await this.syncMemberWithHistory(member);
					syncedGuilds++;
				}
			}
			console.log(
				`🔹 UserUpdate: Synced ${newUser.username} across ${syncedGuilds} guilds`,
			);
		});

		// Role events
		this.client.on("roleCreate", async (role) => {
			await this.syncRole(role);
		});

		this.client.on("roleUpdate", async (oldRole, newRole) => {
			await this.syncRole(newRole);
		});

		this.client.on("roleDelete", async (role) => {
			await this.markRoleInactive(role.id);
		});

		// Message events (optional - can be resource intensive)
		this.client.on("messageCreate", async (message) => {
			// Only sync messages in guilds and not from bots
			if (message.guild && !message.author.bot) {
				await this.syncMessage(message);
			}
		});

		this.client.on("messageUpdate", async (oldMessage, newMessage) => {
			if (newMessage.guild && !newMessage.author.bot) {
				await this.syncMessage(newMessage);
			}
		});

		this.client.on("messageDelete", async (message) => {
			if (message.guild) {
				await this.markMessageInactive(message.id);
			}
		});
	}

	/**
	 * Perform startup sync - decides between incremental or full sync
	 */
	private async performStartupSync(): Promise<void> {
		if (this.syncing || this.shuttingDown) {
			console.log("🔸 Sync already in progress or shutting down, skipping");
			return;
		}

		this.syncing = true;

		try {
			const startTime = Date.now();
			let totalSynced = 0;
			let totalUpdated = 0;
			let totalMarkedInactive = 0;

			// Sync all guilds
			for (const [guildId, guild] of this.client.guilds.cache) {
				if (this.shuttingDown) break;

				// Check if we need full sync or incremental
				const metadata = await this.syncState.getSyncMetadata(guildId, "guild");
				const needsFullSync = this.syncState.needsFullSync(guildId, metadata);

				if (needsFullSync) {
					const stats = await this.performFullGuildSync(guild);
					totalSynced += stats.synced;
					totalUpdated += stats.updated;
					totalMarkedInactive += stats.markedInactive;
				} else {
					const stats = await this.performIncrementalGuildSync(guild);
					totalSynced += stats.synced;
					totalUpdated += stats.updated;
					totalMarkedInactive += stats.markedInactive;
				}
			}

			const duration = ((Date.now() - startTime) / 1000).toFixed(2);
			console.log(
				`🔹 Sync completed in ${duration}s: ${totalSynced} new, ${totalUpdated} updated, ${totalMarkedInactive} marked inactive`,
			);
		} catch (error) {
			console.error("🔸 Error during startup sync:", error);
		} finally {
			this.syncing = false;
		}
	}

	/**
	 * Perform full sync for a guild (used on first sync or when healing is needed)
	 */
	private async performFullGuildSync(guild: Guild): Promise<{
		synced: number;
		updated: number;
		markedInactive: number;
	}> {
		let synced = 0;
		const updated = 0;
		const markedInactive = 0;

		try {
			// Mark sync as in progress
			await this.syncState.markSyncInProgress(guild.id, "guild");

			// Sync guild
			await this.syncGuild(guild);
			synced++;

			// Sync channels in batches for better performance
			await this.syncState.markSyncInProgress(guild.id, "channel");
			const channelData = Array.from(guild.channels.cache.values()).map(
				(channel) => discordChannelToSurreal(channel, guild.id),
			);
			const channelResult = await this.db.batchUpsertChannels(channelData);
			if (channelResult.success) {
				synced += channelData.length;
			}
			await this.syncState.recordSyncCompletion(
				guild.id,
				"channel",
				guild.channels.cache.size,
				true,
			);

			// Sync roles in batches for better performance
			await this.syncState.markSyncInProgress(guild.id, "role");
			const roleData = Array.from(guild.roles.cache.values()).map((role) =>
				discordRoleToSurreal(role),
			);
			const roleResult = await this.db.batchUpsertRoles(roleData);
			if (roleResult.success) {
				synced += roleData.length;
			}
			await this.syncState.recordSyncCompletion(
				guild.id,
				"role",
				guild.roles.cache.size,
				true,
			);

			// Sync members in batches for better performance
			await this.syncState.markSyncInProgress(guild.id, "member");
			console.log(`🔹 Fetching members for guild ${guild.name} (${guild.id})`);
			const members = await guild.members.fetch();
			const memberData = Array.from(members.values()).map((member) =>
				discordMemberToSurreal(member),
			);

			// Process members in parallel batches of 20
			const batchSize = 20;
			for (let i = 0; i < memberData.length; i += batchSize) {
				if (this.shuttingDown) break;
				const batch = memberData.slice(i, i + batchSize);
				const batchPromises = batch.map(async (member) => {
					const result = await this.db.upsertMember(member);
					if (!result.success) {
					}
					return result.success;
				});
				const batchResults = await Promise.all(batchPromises);
				const successCount = batchResults.filter(Boolean).length;
				synced += successCount;
			}

			await this.syncState.recordSyncCompletion(
				guild.id,
				"member",
				members.size,
				true,
			);

			// Sync messages from all text channels
			await this.syncState.markSyncInProgress(guild.id, "message");
			console.log(`🔹 Syncing messages for guild ${guild.name}`);

			let messageCount = 0;
			for (const channel of guild.channels.cache.values()) {
				if (this.shuttingDown) break;

				if (channel.isTextBased() && !channel.isDMBased()) {
					try {
						// Fetch recent messages (last 50 per channel for full sync)
						const messages = await channel.messages.fetch({ limit: 50 });

						for (const message of messages.values()) {
							if (this.shuttingDown) break;

							// Skip bot messages
							if (message.author.bot) continue;

							await this.syncMessage(message);
							messageCount++;
						}
					} catch (error) {
						console.error(
							`🔸 Error syncing messages from channel ${channel.name}:`,
							error,
						);
					}
				}
			}

			synced += messageCount;
			await this.syncState.recordSyncCompletion(
				guild.id,
				"message",
				messageCount,
				true,
			);

			// Mark guild sync as complete
			await this.syncState.recordSyncCompletion(guild.id, "guild", 1, true);

			return { synced, updated, markedInactive };
		} catch (error) {
			console.error(
				`🔸 Error during full sync for guild ${guild.name}:`,
				error,
			);
			return { synced, updated, markedInactive };
		}
	}

	/**
	 * Perform incremental sync - only sync differences
	 */
	private async performIncrementalGuildSync(guild: Guild): Promise<{
		synced: number;
		updated: number;
		markedInactive: number;
	}> {
		let synced = 0;
		let updated = 0;
		let markedInactive = 0;

		try {
			// Always update guild info
			await this.syncGuild(guild);

			// Check and sync channels
			const channelStats = await this.syncEntityType(
				guild,
				"channel",
				guild.channels.cache,
				(channel) => this.syncChannel(channel, guild.id),
			);
			synced += channelStats.synced;
			updated += channelStats.updated;
			markedInactive += channelStats.markedInactive;

			// Check and sync roles
			const roleStats = await this.syncEntityType(
				guild,
				"role",
				guild.roles.cache,
				(role) => this.syncRole(role),
			);
			synced += roleStats.synced;
			updated += roleStats.updated;
			markedInactive += roleStats.markedInactive;

			// Check and sync members (with history tracking)
			const memberStats = await this.syncMembersIncrementally(guild);
			synced += memberStats.synced;
			updated += memberStats.updated;
			markedInactive += memberStats.markedInactive;

			// Check and sync messages (healing missing messages)
			const messageStats = await this.syncMessagesIncrementally(guild);
			synced += messageStats.synced;
			updated += messageStats.updated;
			markedInactive += messageStats.markedInactive;

			// Perform health check - DISABLED due to SurrealDB query issues
			// await this.detectHealthIssues(guild.id);

			return { synced, updated, markedInactive };
		} catch (error) {
			console.error(
				`🔸 Error during incremental sync for guild ${guild.name}:`,
				error,
			);
			return { synced, updated, markedInactive };
		}
	}

	/**
	 * Generic method to sync entity type (channels, roles)
	 */
	private async syncEntityType<T extends { id: string }>(
		guild: Guild,
		entityType: "channel" | "role",
		discordEntities: Map<string, T>,
		syncFn: (entity: T) => Promise<void>,
	): Promise<{ synced: number; updated: number; markedInactive: number }> {
		let synced = 0;
		const updated = 0;
		let markedInactive = 0;

		try {
			// Get entity IDs from database
			const dbResult = await this.db.getEntityIds(guild.id, entityType);
			const dbIds = new Set(dbResult.success ? dbResult.data : []);
			const discordIds = new Set(discordEntities.keys());

			// Find missing entities (in Discord but not in DB)
			const missingIds = Array.from(discordIds).filter((id) => !dbIds.has(id));

			// Find orphaned entities (in DB but not in Discord)
			const orphanedIds = Array.from(dbIds).filter((id) => !discordIds.has(id));

			// Sync missing entities in batches
			if (missingIds.length > 0) {
				const missingEntities = missingIds
					.map((id) => discordEntities.get(id))
					.filter((entity) => entity !== undefined);

				if (entityType === "channel") {
					const channelData = missingEntities.map((entity) =>
						discordChannelToSurreal(entity as unknown as Channel, guild.id),
					);
					const result = await this.db.batchUpsertChannels(channelData);
					if (result.success) synced += channelData.length;
				} else if (entityType === "role") {
					const roleData = missingEntities.map((entity) =>
						discordRoleToSurreal(entity as unknown as Role),
					);
					const result = await this.db.batchUpsertRoles(roleData);
					if (result.success) synced += roleData.length;
				}
			}

			// Mark orphaned entities as inactive
			if (orphanedIds.length > 0) {
				await this.db.bulkMarkInactive(entityType, orphanedIds);
				markedInactive += orphanedIds.length;
			}

			// Update sync metadata
			await this.syncState.recordSyncCompletion(
				guild.id,
				entityType,
				discordEntities.size,
				false,
			);

			return { synced, updated, markedInactive };
		} catch (error) {
			console.error(`🔸 Error syncing ${entityType}s:`, error);
			return { synced, updated, markedInactive };
		}
	}

	/**
	 * Sync members incrementally with profile change tracking
	 */
	private async syncMembersIncrementally(guild: Guild): Promise<{
		synced: number;
		updated: number;
		markedInactive: number;
	}> {
		let synced = 0;
		let updated = 0;
		let markedInactive = 0;

		try {
			// Get member IDs from database
			const dbResult = await this.db.getEntityIds(guild.id, "member");
			const dbIds = new Set(dbResult.success ? dbResult.data : []);

			console.log(
				`🔹 syncMembersIncrementally: DB has ${dbIds.size} members for guild ${guild.name}`,
			);

			// If getEntityIds returned empty array, it means we should skip sync (recent sync detected)
			if (dbIds.size === 0) {
				console.log(
					`🔹 syncMembersIncrementally: Skipping member sync for guild ${guild.name} (recent sync detected)`,
				);
				return { synced: 0, updated: 0, markedInactive: 0 };
			}

			// Fetch all members from Discord
			const members = await guild.members.fetch();
			const discordIds = new Set(
				Array.from(members.values()).map((m) => `${guild.id}:${m.id}`),
			);

			// Find missing members (in Discord but not in DB)
			const missingMemberIds = Array.from(discordIds).filter(
				(id) => !dbIds.has(id),
			);

			// Find orphaned members (in DB but not in Discord)
			const orphanedIds = Array.from(dbIds).filter((id) => !discordIds.has(id));

			// Sync missing members
			for (const fullId of missingMemberIds) {
				if (this.shuttingDown) break;
				const parts = fullId.split(":");
				const memberId = parts[1];
				if (!memberId) continue;
				const member = members.get(memberId);
				if (member) {
					await this.syncMemberWithHistory(member);
					synced++;
				}
			}

			// Check existing members for changes (profile updates)
			for (const [memberId, member] of members) {
				if (this.shuttingDown) break;
				const fullId = `${guild.id}:${memberId}`;
				if (dbIds.has(fullId) && !missingMemberIds.includes(fullId)) {
					// Member exists, check for profile changes
					const dbMemberResult = await this.db.getMember(memberId, guild.id);
					if (dbMemberResult.success && dbMemberResult.data) {
						const historyEntry = this.userHistory.compareAndTrack(
							member,
							dbMemberResult.data,
						);
						if (historyEntry) {
							// Profile changed, update with history
							const currentMemberData = discordMemberToSurreal(member);
							const updatedMemberData = this.userHistory.createUpdatedMember(
								currentMemberData,
								dbMemberResult.data,
								historyEntry,
							);
							await this.db.upsertMember(updatedMemberData);
							updated++;

							const changeSummary =
								this.userHistory.getChangeSummary(historyEntry);
							console.log(
								`🔹 Updated member ${member.user.username}: ${changeSummary}`,
							);
						}
					}
				}
			}

			// Mark orphaned members as inactive
			if (orphanedIds.length > 0) {
				await this.db.bulkMarkInactive("member", orphanedIds);
				markedInactive += orphanedIds.length;
			}

			// Update sync metadata
			await this.syncState.recordSyncCompletion(
				guild.id,
				"member",
				members.size,
				false,
			);

			return { synced, updated, markedInactive };
		} catch (error) {
			console.error("🔸 Error syncing members incrementally:", error);
			return { synced, updated, markedInactive };
		}
	}

	/**
	 * Sync a member with history tracking
	 */
	private async syncMemberWithHistory(member: GuildMember): Promise<void> {
		if (this.shuttingDown) return;

		try {
			// Check if member already exists
			const dbMemberResult = await this.db.getMember(
				member.id,
				member.guild.id,
			);

			if (dbMemberResult.success && dbMemberResult.data) {
				// Member exists, check for changes
				const historyEntry = this.userHistory.compareAndTrack(
					member,
					dbMemberResult.data,
				);

				if (historyEntry) {
					console.log(
						`🔹 Changes detected for ${member.user.username}:`,
						historyEntry.changed_fields,
					);

					// Profile changed, update with history
					const currentMemberData = discordMemberToSurreal(member);
					const updatedMemberData = this.userHistory.createUpdatedMember(
						currentMemberData,
						dbMemberResult.data,
						historyEntry,
					);
					const upsertResult = await this.db.upsertMember(updatedMemberData);

					const changeSummary = this.userHistory.getChangeSummary(historyEntry);
					console.log(
						`🔹 Updated member ${member.user.username}: ${changeSummary}`,
					);
				} else {
					// No profile changes, just update roles and timestamps
					await this.syncMember(member);
				}
			} else {
				// New member, sync normally
				const syncResult = await this.syncMember(member);
			}
		} catch (error) {
			// Suppress connection errors during shutdown
			if (
				error instanceof Error &&
				(error.message.includes("no connection available") ||
					error.message.includes("connection to SurrealDB has dropped"))
			) {
				return;
			}
			console.error(
				`🔸 Error syncing member with history ${member.user.username}:`,
				error,
			);
		}
	}

	/**
	 * Detect health issues by comparing database counts with Discord counts
	 */
	private async detectHealthIssues(guildId: string): Promise<boolean> {
		try {
			const guild = this.client.guilds.cache.get(guildId);
			if (!guild) return false;

			const dbCounts = await this.db.getEntityCounts(guildId);
			const members = await guild.members.fetch();
			const discordCounts = {
				channels: guild.channels.cache.size,
				roles: guild.roles.cache.size,
				members: members.size,
			};

			// Check for significant discrepancies (>10%)
			const threshold = 0.1;
			for (const [type, count] of Object.entries(discordCounts)) {
				const dbCount = dbCounts[type] || 0;
				if (count === 0) continue; // Skip if Discord has 0 (edge case)

				const diff = Math.abs(count - dbCount) / count;
				if (diff > threshold) {
					console.log(
						`🔸 Health issue detected for ${type} in guild ${guild.name}: DB has ${dbCount}, Discord has ${count} (${(diff * 100).toFixed(1)}% difference)`,
					);
					await this.syncState.updateSyncMetadata(
						guildId,
						type as "channel" | "role" | "member",
						"needs_healing",
					);
					return true;
				}
			}

			return false;
		} catch (error) {
			console.error(
				`🔸 Error detecting health issues for guild ${guildId}:`,
				error,
			);
			return false;
		}
	}

	// Guild sync methods
	private async syncGuild(guild: Guild): Promise<void> {
		if (this.shuttingDown) return;

		try {
			const guildData = discordGuildToSurreal(guild);
			const result = await this.db.upsertGuild(guildData);

			if (result.success) {
			} else {
				console.error(`🔸 Failed to sync guild ${guild.name}:`, result.error);
			}
		} catch (error) {
			// Suppress connection errors during shutdown
			if (
				error instanceof Error &&
				(error.message.includes("no connection available") ||
					error.message.includes("connection to SurrealDB has dropped"))
			) {
				return;
			}
			console.error(`🔸 Error syncing guild ${guild.name}:`, error);
		}
	}

	private async markGuildInactive(guildId: string): Promise<void> {
		try {
			const result = await this.db.upsertGuild({
				id: guildId,
				active: false,
				updated_at: new Date(),
			});

			if (result.success) {
				console.log(`🔹 Marked guild ${guildId} as inactive`);
			} else {
				console.error(
					`🔸 Failed to mark guild ${guildId} as inactive:`,
					result.error,
				);
			}
		} catch (error) {
			console.error(`🔸 Error marking guild ${guildId} as inactive:`, error);
		}
	}

	// Channel sync methods
	private async syncChannel(channel: Channel, guildId: string): Promise<void> {
		if (this.shuttingDown) return;

		try {
			const channelData = discordChannelToSurreal(channel, guildId);
			const result = await this.db.upsertChannel(channelData);

			if (result.success) {
				const channelName = "name" in channel ? channel.name : channel.id;
			} else {
				const channelName = "name" in channel ? channel.name : channel.id;
				console.error(
					`🔸 Failed to sync channel ${channelName}:`,
					result.error,
				);
			}
		} catch (error) {
			// Suppress connection errors during shutdown
			if (
				error instanceof Error &&
				(error.message.includes("no connection available") ||
					error.message.includes("connection to SurrealDB has dropped"))
			) {
				return;
			}
			const channelName = "name" in channel ? channel.name : channel.id;
			console.error(`🔸 Error syncing channel ${channelName}:`, error);
		}
	}

	private async markChannelInactive(channelId: string): Promise<void> {
		try {
			const result = await this.db.upsertChannel({
				id: channelId,
				active: false,
				updated_at: new Date(),
			});

			if (result.success) {
				console.log(`🔹 Marked channel ${channelId} as inactive`);
			} else {
				console.error(
					`🔸 Failed to mark channel ${channelId} as inactive:`,
					result.error,
				);
			}
		} catch (error) {
			console.error(
				`🔸 Error marking channel ${channelId} as inactive:`,
				error,
			);
		}
	}

	// Member sync methods
	private async syncMember(
		member: GuildMember,
	): Promise<DatabaseResult<SurrealMember>> {
		if (this.shuttingDown) return { success: false, error: "Shutting down" };

		try {
			const memberData = discordMemberToSurreal(member);
			const result = await this.db.upsertMember(memberData);

			if (result.success) {
				return result;
			}
			console.error(
				`🔸 Failed to sync member ${member.displayName}:`,
				result.error,
			);
			return result;
		} catch (error) {
			// Suppress connection errors during shutdown
			if (
				error instanceof Error &&
				(error.message.includes("no connection available") ||
					error.message.includes("connection to SurrealDB has dropped"))
			) {
				return { success: false, error: "Connection unavailable" };
			}
			console.error(`🔸 Error syncing member ${member.displayName}:`, error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	private async markMemberInactive(
		memberId: string,
		guildId: string,
	): Promise<void> {
		try {
			const result = await this.db.upsertMember({
				id: `${guildId}:${memberId}`,
				guild_id: guildId,
				user_id: memberId,
				active: false,
				updated_at: new Date(),
			});

			if (result.success) {
				console.log(`🔹 Marked member ${memberId} as inactive`);
			} else {
				console.error(
					`🔸 Failed to mark member ${memberId} as inactive:`,
					result.error,
				);
			}
		} catch (error) {
			console.error(`🔸 Error marking member ${memberId} as inactive:`, error);
		}
	}

	// Role sync methods
	private async syncRole(role: Role): Promise<void> {
		if (this.shuttingDown) return;

		try {
			const roleData = discordRoleToSurreal(role);
			const result = await this.db.upsertRole(roleData);

			if (result.success) {
			} else {
				console.error(`🔸 Failed to sync role ${role.name}:`, result.error);
			}
		} catch (error) {
			// Suppress connection errors during shutdown
			if (
				error instanceof Error &&
				(error.message.includes("no connection available") ||
					error.message.includes("connection to SurrealDB has dropped"))
			) {
				return;
			}
			console.error(`🔸 Error syncing role ${role.name}:`, error);
		}
	}

	private async markRoleInactive(roleId: string): Promise<void> {
		try {
			const result = await this.db.upsertRole({
				id: roleId,
				active: false,
				updated_at: new Date(),
			});

			if (result.success) {
				console.log(`🔹 Marked role ${roleId} as inactive`);
			} else {
				console.error(
					`🔸 Failed to mark role ${roleId} as inactive:`,
					result.error,
				);
			}
		} catch (error) {
			console.error(`🔸 Error marking role ${roleId} as inactive:`, error);
		}
	}

	/**
	 * Sync messages for a guild (healing missing messages)
	 */
	private async syncMessagesIncrementally(guild: Guild): Promise<{
		synced: number;
		updated: number;
		markedInactive: number;
	}> {
		let synced = 0;
		let updated = 0;
		const markedInactive = 0;

		try {
			console.log(`🔹 Starting message sync for guild ${guild.name}`);

			// Get message IDs from database using a direct query approach
			// Since getEntityIds has workarounds that don't work well for messages
			const dbMessageIds = await this.getExistingMessageIds(guild.id);
			const dbIds = new Set(dbMessageIds);

			console.log(
				`🔹 syncMessagesIncrementally: DB has ${dbIds.size} messages for guild ${guild.name}`,
			);

			// Only sync if we have a discrepancy (missing messages)
			if (dbIds.size === 0) {
				console.log(
					`🔹 syncMessagesIncrementally: No messages found in DB, performing full message sync for guild ${guild.name}`,
				);
			} else {
				console.log(
					`🔹 syncMessagesIncrementally: Found ${dbIds.size} existing messages, checking for missing ones`,
				);
			}

			// Sync messages from all text channels
			for (const channel of guild.channels.cache.values()) {
				if (this.shuttingDown) break;

				if (channel.isTextBased() && !channel.isDMBased()) {
					try {
						console.log(`🔹 Syncing messages from channel ${channel.name}`);

						// Fetch recent messages (last 100 per channel)
						const messages = await channel.messages.fetch({ limit: 100 });

						let channelSynced = 0;
						let channelSkipped = 0;

						for (const message of messages.values()) {
							if (this.shuttingDown) break;

							// Skip bot messages
							if (message.author.bot) continue;

							const messageId = message.id;

							// Check if message exists in DB
							if (!dbIds.has(messageId)) {
								// Message doesn't exist, sync it
								await this.syncMessage(message);
								synced++;
								channelSynced++;
							} else {
								// Message exists, check for updates
								const dbMessageResult = await this.db.getMessage(messageId);
								if (dbMessageResult.success && dbMessageResult.data) {
									const dbMessage = dbMessageResult.data;
									// Check if message was edited
									if (
										message.editedAt &&
										dbMessage.updated_at &&
										message.editedAt > new Date(dbMessage.updated_at)
									) {
										await this.syncMessage(message);
										updated++;
										channelSynced++;
									} else {
										channelSkipped++;
									}
								} else {
									channelSkipped++;
								}
							}
						}

						if (channelSynced > 0) {
							console.log(
								`🔹 Synced ${channelSynced} messages from ${channel.name} (${channelSkipped} already up-to-date)`,
							);
						} else {
							console.log(
								`🔹 All messages in ${channel.name} are already up-to-date (${channelSkipped} messages)`,
							);
						}
					} catch (error) {
						console.error(
							`🔸 Error syncing messages from channel ${channel.name}:`,
							error,
						);
					}
				}
			}

			return { synced, updated, markedInactive };
		} catch (error) {
			// Suppress connection errors during shutdown
			if (
				error instanceof Error &&
				(error.message.includes("no connection available") ||
					error.message.includes("connection to SurrealDB has dropped"))
			) {
				return { synced, updated, markedInactive };
			}
			console.error(
				`🔸 Error during incremental message sync for guild ${guild.name}:`,
				error,
			);
			return { synced, updated, markedInactive };
		}
	}

	// Message sync methods
	private async syncMessage(message: Message): Promise<void> {
		try {
			const guildId = message.guild?.id;
			if (!guildId) {
				console.error(`🔸 Message ${message.id} has no guild ID, skipping`);
				return;
			}

			const messageData = discordMessageToSurreal(message, guildId);
			const result = await this.db.upsertMessage(messageData);

			if (result.success) {
				console.log(`🔹 Successfully synced message ${message.id}`);
			} else {
				console.error(`🔸 Failed to sync message ${message.id}:`, result.error);
			}
		} catch (error) {
			console.error(`🔸 Error syncing message ${message.id}:`, error);
		}
	}

	private async markMessageInactive(messageId: string): Promise<void> {
		try {
			const result = await this.db.upsertMessage({
				id: messageId,
				active: false,
				updated_at: new Date(),
			});

			if (result.success) {
				console.log(`🔹 Marked message ${messageId} as inactive`);
			} else {
				console.error(
					`🔸 Failed to mark message ${messageId} as inactive:`,
					result.error,
				);
			}
		} catch (error) {
			console.error(
				`🔸 Error marking message ${messageId} as inactive:`,
				error,
			);
		}
	}

	/**
	 * Get existing message IDs from database for a guild
	 * This bypasses the getEntityIds workaround to get actual message data
	 */
	private async getExistingMessageIds(guildId: string): Promise<string[]> {
		return await this.db.getExistingMessageIds(guildId);
	}

	// Utility methods
	isSyncing(): boolean {
		return this.syncing;
	}

	async forceSyncGuild(guildId: string): Promise<void> {
		const guild = this.client.guilds.cache.get(guildId);
		if (guild) {
			await this.syncGuild(guild);
		}
	}

	async forceSyncMember(guildId: string, memberId: string): Promise<void> {
		const guild = this.client.guilds.cache.get(guildId);
		if (guild) {
			try {
				const member = await guild.members.fetch(memberId);
				await this.syncMember(member);
			} catch (error) {
				console.error(`🔸 Failed to fetch member ${memberId} for sync:`, error);
			}
		}
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		// Silent shutdown - no console output to prevent lingering logs

		// Give a brief moment for any ongoing operations to finish
		await new Promise((resolve) => setTimeout(resolve, 50)); // Reduced timeout
	}
}
