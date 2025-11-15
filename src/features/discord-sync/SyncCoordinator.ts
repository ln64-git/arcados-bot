import { PostgreSQLManager } from "../../database/PostgreSQLManager";

/**
 * Coordinates sync operations between LiveEventSync and ReconciliationSync
 * to prevent race conditions and data conflicts.
 *
 * Uses per-resource locking to ensure:
 * 1. Live events always take priority over background healing
 * 2. Watermarks only move forward (never regress)
 * 3. No duplicate work between sync components
 */
export class SyncCoordinator {
	private db: PostgreSQLManager;
	private verbose: boolean;

	// Lock maps: resourceId -> Promise<void> (in-progress operation)
	private guildLocks = new Map<string, Promise<void>>();
	private channelLocks = new Map<string, Promise<void>>();
	private memberLocks = new Map<string, Promise<void>>();

	// Watermark protection: channelId -> last known watermark
	private watermarks = new Map<string, string>();

	// Statistics
	private stats = {
		activeLocks: 0,
		totalConflicts: 0,
		watermarkRejects: 0,
	};

	constructor(db: PostgreSQLManager, verbose: boolean = false) {
		this.db = db;
		this.verbose = verbose;
	}

	/**
	 * Acquire a guild lock
	 * Returns a release function that MUST be called when done
	 */
	async acquireGuildLock(guildId: string): Promise<() => void> {
		return this.acquireLock(this.guildLocks, guildId, "guild");
	}

	/**
	 * Acquire a channel lock
	 */
	async acquireChannelLock(channelId: string): Promise<() => void> {
		return this.acquireLock(this.channelLocks, channelId, "channel");
	}

	/**
	 * Acquire a member lock
	 */
	async acquireMemberLock(memberId: string): Promise<() => void> {
		return this.acquireLock(this.memberLocks, memberId, "member");
	}

	/**
	 * Generic lock acquisition with conflict tracking
	 */
	private async acquireLock(
		lockMap: Map<string, Promise<void>>,
		resourceId: string,
		resourceType: string
	): Promise<() => void> {
		// If lock exists, wait for it to be released
		const existingLock = lockMap.get(resourceId);
		if (existingLock) {
			this.stats.totalConflicts++;
			if (this.verbose) {
				console.log(
					`🔸 SyncCoordinator: Waiting for ${resourceType} lock: ${resourceId}`
				);
			}
			await existingLock;
		}

		// Create a new lock
		let releaseLock: () => void;
		const lockPromise = new Promise<void>((resolve) => {
			releaseLock = resolve;
		});

		lockMap.set(resourceId, lockPromise);
		this.stats.activeLocks++;

		// Return release function
		return () => {
			lockMap.delete(resourceId);
			this.stats.activeLocks--;
			releaseLock!();
		};
	}

	/**
	 * Try to update a channel watermark
	 * Returns true if update was allowed, false if rejected (watermark would regress)
	 *
	 * IMPORTANT: Only LiveEventSync should call this for forward progress.
	 * ReconciliationSync should use tryUpdateWatermarkIfMissing() instead.
	 */
	async tryUpdateWatermark(
		channelId: string,
		newWatermark: string,
		source: "live" | "reconciliation"
	): Promise<boolean> {
		const release = await this.acquireChannelLock(channelId);

		try {
			// Get current watermark from database
			const currentResult = await this.db.getChannelWatermark(channelId);
			const currentWatermark =
				currentResult.success && currentResult.data
					? currentResult.data.last_message_id
					: null;

			// If no current watermark, allow any update
			if (!currentWatermark) {
				await this.db.updateChannelLastMessage(channelId, newWatermark);
				this.watermarks.set(channelId, newWatermark);
				return true;
			}

			// Compare snowflake IDs to ensure watermark moves forward
			const currentSnowflake = BigInt(currentWatermark);
			const newSnowflake = BigInt(newWatermark);

			// Reject if new watermark is older
			if (newSnowflake <= currentSnowflake) {
				this.stats.watermarkRejects++;
				if (this.verbose) {
					console.log(
						`🔸 SyncCoordinator: Rejected watermark update for channel ${channelId} (${source}): ${newWatermark} <= ${currentWatermark}`
					);
				}
				return false;
			}

			// Allow update if watermark moves forward
			await this.db.updateChannelLastMessage(channelId, newWatermark);
			this.watermarks.set(channelId, newWatermark);

			if (this.verbose) {
				console.log(
					`✅ SyncCoordinator: Updated watermark for channel ${channelId} (${source}): ${currentWatermark} -> ${newWatermark}`
				);
			}

			return true;
		} finally {
			release();
		}
	}

	/**
	 * Update watermark ONLY if no watermark currently exists
	 * Used by ReconciliationSync to bootstrap watermarks without interfering with LiveEventSync
	 */
	async tryUpdateWatermarkIfMissing(
		channelId: string,
		newWatermark: string
	): Promise<boolean> {
		const release = await this.acquireChannelLock(channelId);

		try {
			const currentResult = await this.db.getChannelWatermark(channelId);
			const currentWatermark =
				currentResult.success && currentResult.data
					? currentResult.data.last_message_id
					: null;

			// Only update if no watermark exists
			if (!currentWatermark) {
				await this.db.updateChannelLastMessage(channelId, newWatermark);
				this.watermarks.set(channelId, newWatermark);
				return true;
			}

			return false;
		} finally {
			release();
		}
	}

	/**
	 * Check if a message ID is older than the current watermark
	 * Used by ReconciliationSync to avoid syncing messages that LiveEventSync already handled
	 */
	async isMessageOlderThanWatermark(
		channelId: string,
		messageId: string
	): Promise<boolean> {
		const currentResult = await this.db.getChannelWatermark(channelId);
		const currentWatermark =
			currentResult.success && currentResult.data
				? currentResult.data.last_message_id
				: null;

		if (!currentWatermark) {
			return false; // No watermark = no messages synced yet
		}

		const watermarkSnowflake = BigInt(currentWatermark);
		const messageSnowflake = BigInt(messageId);

		return messageSnowflake <= watermarkSnowflake;
	}

	/**
	 * Get sync statistics
	 */
	getStats(): {
		activeLocks: number;
		totalConflicts: number;
		watermarkRejects: number;
	} {
		return { ...this.stats };
	}
}
