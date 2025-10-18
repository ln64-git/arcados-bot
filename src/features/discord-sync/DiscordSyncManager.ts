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
		const targetGuildId = process.env.GUILD_ID;

		// Guild events
		this.client.on("guildCreate", async (guild) => {
			if (targetGuildId && guild.id === targetGuildId) {
				console.log(`🔹 Bot joined target guild: ${guild.name}`);
				await this.syncGuild(guild);
			}
		});

		this.client.on("guildUpdate", async (oldGuild, newGuild) => {
			if (targetGuildId && newGuild.id === targetGuildId) {
				await this.syncGuild(newGuild);
			}
		});

		this.client.on("guildDelete", async (guild) => {
			if (targetGuildId && guild.id === targetGuildId) {
				console.log(`🔹 Bot left target guild: ${guild.name}`);
				await this.markGuildInactive(guild.id);
			}
		});

		// Channel events
		this.client.on("channelCreate", async (channel) => {
			if (
				targetGuildId &&
				"guild" in channel &&
				channel.guild &&
				channel.guild.id === targetGuildId
			) {
				await this.syncChannel(channel, channel.guild.id);
			}
		});

		this.client.on("channelUpdate", async (oldChannel, newChannel) => {
			if (
				targetGuildId &&
				"guild" in newChannel &&
				newChannel.guild &&
				newChannel.guild.id === targetGuildId
			) {
				await this.syncChannel(newChannel, newChannel.guild.id);
			}
		});

		this.client.on("channelDelete", async (channel) => {
			if (
				targetGuildId &&
				"guild" in channel &&
				channel.guild &&
				channel.guild.id === targetGuildId
			) {
				await this.markChannelInactive(channel.id);
			}
		});

		// Member events
		this.client.on("guildMemberAdd", async (member) => {
			if (targetGuildId && member.guild.id === targetGuildId) {
				await this.syncMemberWithHistory(member);
			}
		});

		this.client.on("guildMemberUpdate", async (oldMember, newMember) => {
			if (targetGuildId && newMember.guild.id === targetGuildId) {
				await this.syncMemberWithHistory(newMember);
			}
		});

		this.client.on("guildMemberRemove", async (member) => {
			if (targetGuildId && member.guild.id === targetGuildId) {
				await this.markMemberInactive(member.id, member.guild.id);
			}
		});

		// User events (global profile changes like username, avatar)
		this.client.on("userUpdate", async (oldUser, newUser) => {
			if (targetGuildId) {
				console.log(
					`🔹 UserUpdate event received for ${newUser.username} (${newUser.id})`,
				);

				// Only sync the user in the target guild
				const guild = this.client.guilds.cache.get(targetGuildId);
				if (guild) {
					const member = guild.members.cache.get(newUser.id);
					if (member) {
						console.log(
							`🔹 Syncing user ${newUser.username} in target guild ${guild.name}`,
						);
						await this.syncMemberWithHistory(member);
					}
				}
			}
		});

		// Role events
		this.client.on("roleCreate", async (role) => {
			if (targetGuildId && role.guild.id === targetGuildId) {
				await this.syncRole(role);
			}
		});

		this.client.on("roleUpdate", async (oldRole, newRole) => {
			if (targetGuildId && newRole.guild.id === targetGuildId) {
				await this.syncRole(newRole);
			}
		});

		this.client.on("roleDelete", async (role) => {
			if (targetGuildId && role.guild.id === targetGuildId) {
				await this.markRoleInactive(role.id);
			}
		});

		// Message events (optional - can be resource intensive)
		this.client.on("messageCreate", async (message) => {
			// Only sync messages in target guild and not from bots
			if (
				targetGuildId &&
				message.guild &&
				message.guild.id === targetGuildId &&
				!message.author.bot
			) {
				await this.syncMessage(message);
			}
		});

		this.client.on("messageUpdate", async (oldMessage, newMessage) => {
			if (
				targetGuildId &&
				newMessage.guild &&
				newMessage.guild.id === targetGuildId &&
				!newMessage.author.bot
			) {
				await this.syncMessage(newMessage);
			}
		});

		this.client.on("messageDelete", async (message) => {
			if (
				targetGuildId &&
				message.guild &&
				message.guild.id === targetGuildId
			) {
				await this.markMessageInactive(message.id);
			}
		});
	}

	/**
	 * Perform startup sync - LIMITED TO GUILD_ID from environment
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

			// Get the target guild ID from environment
			const targetGuildId = process.env.GUILD_ID;
			if (!targetGuildId) {
				console.log("🔹 No GUILD_ID specified in environment, skipping sync");
				return;
			}

			console.log(`🔹 Target guild ID: ${targetGuildId}`);

			// Find the target guild
			const targetGuild = this.client.guilds.cache.get(targetGuildId);
			if (!targetGuild) {
				console.log(
					`🔹 Target guild ${targetGuildId} not found, skipping sync`,
				);
				return;
			}

			console.log(
				`🔹 Found target guild: ${targetGuild.name} (${targetGuild.id})`,
			);

			// Process only the target guild
			if (this.shuttingDown) return;

			// Check if we need full sync or incremental
			const metadata = await this.syncState.getSyncMetadata(
				targetGuildId,
				"guild",
			);
			const needsFullSync = this.syncState.needsFullSync(
				targetGuildId,
				metadata,
			);

			if (needsFullSync) {
				console.log(`🔹 Performing full sync for guild: ${targetGuild.name}`);
				const stats = await this.performFullGuildSync(targetGuild);
				totalSynced += stats.synced;
				totalUpdated += stats.updated;
				totalMarkedInactive += stats.markedInactive;
			} else {
				const stats = await this.performIncrementalGuildSync(targetGuild);
				totalSynced += stats.synced;
				totalUpdated += stats.updated;
				totalMarkedInactive += stats.markedInactive;
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
			// Fetching members silently
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
			// Syncing messages silently

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

			// Member sync status logged silently

			// If getEntityIds returned empty array, it means we should skip sync (recent sync detected)
			if (dbIds.size === 0) {
				// Skipping member sync due to recent sync
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
	 * Sync messages for a guild (healing missing messages) - ULTRA OPTIMIZED VERSION
	 */
	private async syncMessagesIncrementally(guild: Guild): Promise<{
		synced: number;
		updated: number;
		markedInactive: number;
	}> {
		let synced = 0;
		const updated = 0;
		const markedInactive = 0;

		try {
			// Get message IDs from database using a direct query approach
			const dbMessageIds = await this.getExistingMessageIds(guild.id);
			const dbIds = new Set(dbMessageIds);

			// Message sync status logged silently

			// Get all text channels first
			const allTextChannels = Array.from(guild.channels.cache.values()).filter(
				(channel) => channel.isTextBased() && !channel.isDMBased(),
			);

			// OPTIMIZATION 4: Early exit if no channels
			if (allTextChannels.length === 0) {
				console.log(`🔹 No text channels found, skipping message sync`);
				return { synced, updated, markedInactive };
			}

			// OPTIMIZATION 5: Quick check for guild activity using guild-level metrics
			const guildActivityCheck = await this.quickGuildActivityCheck(guild);
			if (!guildActivityCheck.hasRecentActivity) {
				console.log(
					`🔹 Guild ${guild.name} has no recent activity (last activity: ${guildActivityCheck.lastActivity}h ago), skipping message sync`,
				);
				return { synced, updated, markedInactive };
			}

			// SMART FILTERING: Only sync channels with recent activity
			const activeChannels = await this.filterActiveChannels(allTextChannels);

			// Processing active channels silently

			if (activeChannels.length === 0) {
				console.log(`🔹 No active channels found, skipping message sync`);
				return { synced, updated, markedInactive };
			}

			// OPTIMIZATION 6: Dynamic batch sizing based on active channel count
			const BATCH_SIZE = Math.min(
				5,
				Math.max(2, Math.ceil(activeChannels.length / 4)),
			);
			const batches = [];

			for (let i = 0; i < activeChannels.length; i += BATCH_SIZE) {
				batches.push(activeChannels.slice(i, i + BATCH_SIZE));
			}

			for (const batch of batches) {
				if (this.shuttingDown) break;

				// Process batch in parallel
				const batchPromises = batch.map(async (channel) => {
					try {
						// Syncing messages from channel

						// Fetch recent messages (last 100 per channel)
						const messages = await channel.messages.fetch({ limit: 100 });

						let channelSynced = 0;
						let channelSkipped = 0;

						// Process messages in parallel batches
						const messageArray = Array.from(messages.values());
						const MESSAGE_BATCH_SIZE = 10; // Process 10 messages at a time

						for (let i = 0; i < messageArray.length; i += MESSAGE_BATCH_SIZE) {
							if (this.shuttingDown) break;

							const messageBatch = messageArray.slice(
								i,
								i + MESSAGE_BATCH_SIZE,
							);

							// Process message batch in parallel
							const messagePromises = messageBatch.map(async (message) => {
								// Skip bot messages
								if (message.author.bot) return { synced: 0, skipped: 1 };

								const messageId = message.id;

								// Check if message exists in DB using direct select
								const existingMessage = await this.db.db.select(
									`messages:${messageId}`,
								);
								const messageExists =
									existingMessage &&
									Array.isArray(existingMessage) &&
									existingMessage.length > 0;

								if (!messageExists) {
									// Message doesn't exist, sync it
									await this.syncMessage(message);
									return { synced: 1, skipped: 0 };
								} else {
									// Message exists, check for updates
									const dbMessage = existingMessage[0];
									// Check if message was edited
									if (
										message.editedAt &&
										dbMessage.updated_at &&
										message.editedAt > new Date(dbMessage.updated_at)
									) {
										await this.syncMessage(message);
										return { synced: 1, skipped: 0 };
									} else {
										return { synced: 0, skipped: 1 };
									}
								}
							});

							// Wait for message batch to complete
							const batchResults = await Promise.all(messagePromises);

							// Aggregate results
							for (const result of batchResults) {
								channelSynced += result.synced;
								channelSkipped += result.skipped;
							}
						}

						// Channel sync completed silently

						return { synced: channelSynced, skipped: channelSkipped };
					} catch (error) {
						// Handle specific Discord API errors gracefully
						if (
							error instanceof Error &&
							error.message.includes("Missing Access")
						) {
							// Channel no access, skip silently
							return { synced: 0, skipped: 0 };
						}

						console.error(
							`🔸 Error syncing messages from channel ${channel.name}:`,
							error,
						);
						return { synced: 0, skipped: 0 };
					}
				});

				// Wait for batch to complete
				const batchResults = await Promise.all(batchPromises);

				// Aggregate results from batch
				for (const result of batchResults) {
					synced += result.synced;
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

	/**
	 * Quick guild activity check to avoid unnecessary processing
	 */
	private async quickGuildActivityCheck(guild: Guild): Promise<{
		hasRecentActivity: boolean;
		lastActivity: number; // hours ago
	}> {
		try {
			// Check guild-level activity indicators
			const now = Date.now();
			const RECENT_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours

			// Check if guild has recent member count changes (indicates activity)
			const memberCount = guild.memberCount;
			const approximateMemberCount =
				guild.approximateMemberCount || memberCount;

			// If member counts are very different, guild might be active
			const memberCountDifference = Math.abs(
				memberCount - approximateMemberCount,
			);
			if (memberCountDifference > 5) {
				return { hasRecentActivity: true, lastActivity: 0 };
			}

			// Check a few random channels for quick activity assessment
			const channels = Array.from(guild.channels.cache.values()).filter(
				(channel) => channel.isTextBased() && !channel.isDMBased(),
			);

			if (channels.length === 0) {
				return { hasRecentActivity: false, lastActivity: 999999 };
			}

			// Sample 3 channels for quick check
			const sampleSize = Math.min(3, channels.length);
			const sampleChannels = channels.slice(0, sampleSize);

			let mostRecentActivity = 0;

			for (const channel of sampleChannels) {
				try {
					// Quick check using cached data first
					const cachedMessage = channel.messages.cache.last();
					if (cachedMessage) {
						const messageAge = now - cachedMessage.createdTimestamp;
						mostRecentActivity = Math.max(mostRecentActivity, messageAge);
					} else if (channel.lastMessageId) {
						// If we have lastMessageId but no cached message, assume recent activity
						return { hasRecentActivity: true, lastActivity: 0 };
					}
				} catch (error) {
					// Ignore errors in quick check
				}
			}

			const lastActivityHours = Math.round(
				mostRecentActivity / (60 * 60 * 1000),
			);
			const hasRecentActivity = mostRecentActivity <= RECENT_THRESHOLD;

			return { hasRecentActivity, lastActivity: lastActivityHours };
		} catch (error) {
			// If quick check fails, assume activity to be safe
			return { hasRecentActivity: true, lastActivity: 0 };
		}
	}

	/**
	 * Filter channels to only include those with recent activity - OPTIMIZED VERSION
	 */
	private async filterActiveChannels(channels: Channel[]): Promise<Channel[]> {
		const activeChannels: Channel[] = [];
		const RECENT_ACTIVITY_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
		const now = Date.now();

		// Checking channel activity silently

		// OPTIMIZATION 1: Use channel.lastMessageId if available to avoid API calls
		const channelsWithLastMessage = channels.filter((channel) => {
			// Check if channel has a cached last message ID
			return channel.lastMessageId !== null;
		});

		const channelsWithoutLastMessage = channels.filter((channel) => {
			return channel.lastMessageId === null;
		});

		// Reduced logging for channel activity check

		// OPTIMIZATION 2: Process channels with cached last message first (no API calls needed)
		for (const channel of channelsWithLastMessage) {
			try {
				// Get the last message from cache if possible
				const lastMessage = channel.messages.cache.last();

				if (!lastMessage) {
					// Fallback to API if not in cache
					const fetchedMessage = await channel.messages.fetch({ limit: 1 });
					if (fetchedMessage.size === 0) {
						// Channel no messages, skip silently
						continue;
					}
					const message = fetchedMessage.first()!;
					const messageAge = now - message.createdTimestamp;
					const isActive = messageAge <= RECENT_ACTIVITY_THRESHOLD;

					if (isActive) {
						activeChannels.push(channel);
					} else {
						const lastMessageAge = Math.round(messageAge / (60 * 60 * 1000));
						// Channel inactive, skip silently
					}
				} else {
					// Use cached message
					const messageAge = now - lastMessage.createdTimestamp;
					const isActive = messageAge <= RECENT_ACTIVITY_THRESHOLD;

					if (isActive) {
						activeChannels.push(channel);
					} else {
						const lastMessageAge = Math.round(messageAge / (60 * 60 * 1000));
						// Channel inactive, skip silently
					}
				}
			} catch (error) {
				if (
					error instanceof Error &&
					error.message.includes("Missing Access")
				) {
					// Channel no access, skip silently
				} else {
					console.error(
						`🔸 Error checking activity for channel ${channel.name}:`,
						error,
					);
				}
			}
		}

		// OPTIMIZATION 3: Process remaining channels in smaller batches to reduce API load
		if (channelsWithoutLastMessage.length > 0) {
			const BATCH_SIZE = 5; // Smaller batches for API-heavy operations
			const batches = [];

			for (let i = 0; i < channelsWithoutLastMessage.length; i += BATCH_SIZE) {
				batches.push(channelsWithoutLastMessage.slice(i, i + BATCH_SIZE));
			}

			for (const batch of batches) {
				if (this.shuttingDown) break;

				const batchPromises = batch.map(async (channel) => {
					try {
						// Get the last message in the channel
						const lastMessage = await channel.messages.fetch({ limit: 1 });

						if (lastMessage.size === 0) {
							return { channel, isActive: false, reason: "no messages" };
						}

						const message = lastMessage.first();
						if (!message) {
							return { channel, isActive: false, reason: "no messages" };
						}

						const messageAge = now - message.createdTimestamp;
						const isActive = messageAge <= RECENT_ACTIVITY_THRESHOLD;

						return {
							channel,
							isActive,
							reason: isActive ? "recent activity" : "inactive (>24h)",
							lastMessageAge: Math.round(messageAge / (60 * 60 * 1000)), // hours
						};
					} catch (error) {
						// Handle access errors gracefully
						if (
							error instanceof Error &&
							error.message.includes("Missing Access")
						) {
							return { channel, isActive: false, reason: "no access" };
						}

						console.error(
							`🔸 Error checking activity for channel ${channel.name}:`,
							error,
						);
						return { channel, isActive: false, reason: "error" };
					}
				});

				const batchResults = await Promise.all(batchPromises);

				for (const result of batchResults) {
					if (result.isActive) {
						activeChannels.push(result.channel);
					}

					// Log the decision for transparency
					if (result.reason !== "recent activity") {
						// Channel inactive, skip silently
					}
				}
			}
		}

		// Found active channels silently
		return activeChannels;
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
				// Message synced successfully
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
