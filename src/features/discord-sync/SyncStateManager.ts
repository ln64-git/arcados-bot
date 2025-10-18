import type { SurrealDBManager } from "../../database/SurrealDBManager";
import type { SyncMetadata } from "../../database/schema";

export class SyncStateManager {
	private db: SurrealDBManager;
	private readonly FULL_SYNC_THRESHOLD_DAYS = 7; // Perform full sync if >7 days since last

	constructor(db: SurrealDBManager) {
		this.db = db;
	}

	/**
	 * Get sync metadata for a specific guild and entity type
	 */
	async getSyncMetadata(
		guildId: string,
		entityType: "guild" | "channel" | "role" | "member" | "message",
	): Promise<SyncMetadata | null> {
		try {
			const result = await this.db.getSyncMetadata(guildId, entityType);
			return result.success && result.data ? result.data : null;
		} catch (error) {
			console.error(
				`🔸 Error getting sync metadata for ${guildId}:${entityType}:`,
				error,
			);
			return null;
		}
	}

	/**
	 * Update sync metadata status
	 */
	async updateSyncMetadata(
		guildId: string,
		entityType: "guild" | "channel" | "role" | "member" | "message",
		status: "healthy" | "needs_healing" | "syncing",
		entityCount?: number,
	): Promise<void> {
		try {
			const metadata: Partial<SyncMetadata> = {
				id: `${guildId}:${entityType}`,
				guild_id: guildId,
				entity_type: entityType,
				last_check: new Date(),
				status,
				updated_at: new Date(),
			};

			if (entityCount !== undefined) {
				metadata.entity_count = entityCount;
			}

			await this.db.upsertSyncMetadata(metadata);
		} catch (error) {
			console.error(
				`🔸 Error updating sync metadata for ${guildId}:${entityType}:`,
				error,
			);
		}
	}

	/**
	 * Determine if a full sync is needed for this guild
	 */
	needsFullSync(guildId: string, metadata: SyncMetadata | null): boolean {
		// First sync - always do full sync
		if (!metadata || (!metadata.last_full_sync && !metadata.last_check)) {
			return true;
		}

		// Status indicates healing needed
		if (metadata.status === "needs_healing") {
			return true;
		}

		// Check if last sync (full or incremental) was more than threshold days ago
		const lastSyncTime = metadata.last_full_sync || metadata.last_check;
		const daysSinceLastSync =
			(Date.now() - new Date(lastSyncTime).getTime()) / (1000 * 60 * 60 * 24);

		return daysSinceLastSync > this.FULL_SYNC_THRESHOLD_DAYS;
	}

	/**
	 * Record successful sync completion
	 */
	async recordSyncCompletion(
		guildId: string,
		entityType: "guild" | "channel" | "role" | "member" | "message",
		entityCount: number,
		wasFullSync: boolean,
	): Promise<void> {
		try {
			// Sync completion recorded silently

			const metadata: Partial<SyncMetadata> = {
				id: `${guildId}:${entityType}`,
				guild_id: guildId,
				entity_type: entityType,
				last_check: new Date(),
				entity_count: entityCount,
				status: "healthy",
				updated_at: new Date(),
			};

			if (wasFullSync) {
				metadata.last_full_sync = new Date();
				console.log(`🔹 Setting last_full_sync to: ${metadata.last_full_sync}`);
			}

			// If no record exists, add created_at
			const existing = await this.getSyncMetadata(guildId, entityType);
			if (!existing) {
				metadata.created_at = new Date();
			}

			const result = await this.db.upsertSyncMetadata(metadata);
			// Upsert result logged silently
		} catch (error) {
			console.error(
				`🔸 Error recording sync completion for ${guildId}:${entityType}:`,
				error,
			);
		}
	}

	/**
	 * Mark sync as in progress
	 */
	async markSyncInProgress(
		guildId: string,
		entityType: "guild" | "channel" | "role" | "member" | "message",
	): Promise<void> {
		await this.updateSyncMetadata(guildId, entityType, "syncing");
	}

	/**
	 * Get all sync metadata for a guild
	 */
	async getAllGuildMetadata(guildId: string): Promise<SyncMetadata[]> {
		try {
			const types: Array<"guild" | "channel" | "role" | "member" | "message"> =
				["guild", "channel", "role", "member", "message"];
			const results = await Promise.all(
				types.map((type) => this.getSyncMetadata(guildId, type)),
			);
			return results.filter((r): r is SyncMetadata => r !== null);
		} catch (error) {
			console.error(
				`🔸 Error getting all guild metadata for ${guildId}:`,
				error,
			);
			return [];
		}
	}
}
