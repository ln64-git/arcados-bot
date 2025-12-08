/**
 * Permission Override Helper
 *
 * Centralized utility for managing Discord permission overrides on voice channels.
 * Consolidates duplicate permission application/removal logic from ModerationService
 * and BlockEnforcementService.
 *
 * This helper provides:
 * - Consistent error handling for permission operations
 * - Standardized logging format
 * - Batch operations for multiple channels/users
 * - Testable permission management in isolation
 */

import type { PermissionOverwriteOptions, VoiceChannel } from "discord.js";
import { VoiceLogger } from "./VoiceLogger";

export interface PermissionResult {
	success: number;
	failed: number;
	errors: Array<{ id: string; error: any }>;
}

export class PermissionOverrideHelper {
	/**
	 * Apply permission overrides to multiple channels for a single user
	 *
	 * Use case: When a user is banned/blocked and needs to be locked out of all their channels
	 *
	 * @param channels - Array of voice channels to apply permissions to
	 * @param userId - User ID to apply permissions for
	 * @param permissions - Permission overrides to apply (e.g., { Connect: false })
	 * @param logContext - Context string for logging (e.g., "BAN", "BLOCK")
	 * @returns Result with success/failure counts
	 */
	static async applyToChannels(
		channels: VoiceChannel[],
		userId: string,
		permissions: PermissionOverwriteOptions,
		logContext: string,
	): Promise<PermissionResult> {
		const result: PermissionResult = {
			success: 0,
			failed: 0,
			errors: [],
		};

		for (const channel of channels) {
			try {
				await channel.permissionOverwrites.edit(userId, permissions);
				result.success++;
				if (logContext === "BLOCK") {
					VoiceLogger.block(`Applied permissions to ${channel.name} for user ${userId}`);
				} else if (logContext === "BAN" || logContext === "MODERATION") {
					VoiceLogger.moderation(`Applied permissions to ${channel.name} for user ${userId}`);
				} else {
					VoiceLogger.info(logContext, `Applied permissions to ${channel.name} for user ${userId}`);
				}
			} catch (error) {
				result.failed++;
				result.errors.push({ id: channel.id, error });
				VoiceLogger.error(logContext, `Failed to apply permissions to channel ${channel.name}`, error);
			}
		}

		return result;
	}

	/**
	 * Apply permission overrides to a single channel for multiple users
	 *
	 * Use case: When a channel is created and owner's ban/block list needs to be applied
	 *
	 * @param channel - Voice channel to apply permissions to
	 * @param userIds - Array of user IDs to apply permissions for
	 * @param permissions - Permission overrides to apply (e.g., { Connect: false })
	 * @param logContext - Context string for logging (e.g., "BAN", "BLOCK")
	 * @returns Result with success/failure counts
	 */
	static async applyToUsers(
		channel: VoiceChannel,
		userIds: string[],
		permissions: PermissionOverwriteOptions,
		logContext: string,
	): Promise<PermissionResult> {
		const result: PermissionResult = {
			success: 0,
			failed: 0,
			errors: [],
		};

		for (const userId of userIds) {
			try {
				await channel.permissionOverwrites.edit(userId, permissions);
				result.success++;
				if (logContext === "BLOCK") {
					VoiceLogger.block(`Applied permissions to ${channel.name} for user ${userId}`);
				} else if (logContext === "BAN" || logContext === "MODERATION") {
					VoiceLogger.moderation(`Applied permissions to ${channel.name} for user ${userId}`);
				} else {
					VoiceLogger.info(logContext, `Applied permissions to ${channel.name} for user ${userId}`);
				}
			} catch (error) {
				result.failed++;
				result.errors.push({ id: userId, error });
				VoiceLogger.error(logContext, `Failed to apply permissions for user ${userId}`, error);
			}
		}

		return result;
	}

	/**
	 * Remove permission overrides from multiple channels for a single user
	 *
	 * Use case: When a user is unbanned/unblocked and should regain access to channels
	 *
	 * @param channels - Array of voice channels to remove permissions from
	 * @param userId - User ID to remove permissions for
	 * @param logContext - Context string for logging (e.g., "BAN", "BLOCK")
	 */
	static async removeFromChannels(
		channels: VoiceChannel[],
		userId: string,
		logContext: string,
	): Promise<PermissionResult> {
		const result: PermissionResult = {
			success: 0,
			failed: 0,
			errors: [],
		};

		for (const channel of channels) {
			try {
				await channel.permissionOverwrites.delete(userId);
				result.success++;
				if (logContext === "BLOCK") {
					VoiceLogger.block(`Removed permissions from ${channel.name} for user ${userId}`);
				} else if (logContext === "BAN" || logContext === "MODERATION") {
					VoiceLogger.moderation(`Removed permissions from ${channel.name} for user ${userId}`);
				} else {
					VoiceLogger.info(logContext, `Removed permissions from ${channel.name} for user ${userId}`);
				}
			} catch (error) {
				result.failed++;
				result.errors.push({ id: channel.id, error });
				VoiceLogger.error(logContext, `Failed to remove permissions from channel ${channel.name}`, error);
			}
		}

		return result;
	}

	/**
	 * Remove permission overrides from a single channel for multiple users
	 *
	 * Use case: When cleaning up permissions on channel deletion or owner change
	 *
	 * @param channel - Voice channel to remove permissions from
	 * @param userIds - Array of user IDs to remove permissions for
	 * @param logContext - Context string for logging (e.g., "BAN", "BLOCK")
	 */
	static async removeFromUsers(
		channel: VoiceChannel,
		userIds: string[],
		logContext: string,
	): Promise<PermissionResult> {
		const result: PermissionResult = {
			success: 0,
			failed: 0,
			errors: [],
		};

		for (const userId of userIds) {
			try {
				await channel.permissionOverwrites.delete(userId);
				result.success++;
				if (logContext === "BLOCK") {
					VoiceLogger.block(`Removed permissions from ${channel.name} for user ${userId}`);
				} else if (logContext === "BAN" || logContext === "MODERATION") {
					VoiceLogger.moderation(`Removed permissions from ${channel.name} for user ${userId}`);
				} else {
					VoiceLogger.info(logContext, `Removed permissions from ${channel.name} for user ${userId}`);
				}
			} catch (error) {
				result.failed++;
				result.errors.push({ id: userId, error });
				VoiceLogger.error(logContext, `Failed to remove permissions for user ${userId}`, error);
			}
		}

		return result;
	}

	/**
	 * Apply a single permission override (convenience method)
	 *
	 * Use case: Quick single-channel, single-user permission update
	 *
	 * @param channel - Voice channel to apply permissions to
	 * @param userId - User ID to apply permissions for
	 * @param permissions - Permission overrides to apply
	 * @param logContext - Context string for logging
	 * @returns True if successful, false otherwise
	 */
	static async applySingle(
		channel: VoiceChannel,
		userId: string,
		permissions: PermissionOverwriteOptions,
		logContext: string,
	): Promise<boolean> {
		try {
			await channel.permissionOverwrites.edit(userId, permissions);
			if (logContext === "BLOCK") {
				VoiceLogger.block(`Applied permissions to ${channel.name} for user ${userId}`);
			} else if (logContext === "BAN" || logContext === "MODERATION") {
				VoiceLogger.moderation(`Applied permissions to ${channel.name} for user ${userId}`);
			} else {
				VoiceLogger.info(logContext, `Applied permissions to ${channel.name} for user ${userId}`);
			}
			return true;
		} catch (error) {
			VoiceLogger.error(logContext, `Failed to apply permissions to ${channel.name} for user ${userId}`, error);
			return false;
		}
	}

	/**
	 * Remove a single permission override (convenience method)
	 *
	 * Use case: Quick single-channel, single-user permission removal
	 *
	 * @param channel - Voice channel to remove permissions from
	 * @param userId - User ID to remove permissions for
	 * @param logContext - Context string for logging
	 * @returns True if successful, false otherwise
	 */
	static async removeSingle(
		channel: VoiceChannel,
		userId: string,
		logContext: string,
	): Promise<boolean> {
		try {
			await channel.permissionOverwrites.delete(userId);
			if (logContext === "BLOCK") {
				VoiceLogger.block(`Removed permissions from ${channel.name} for user ${userId}`);
			} else if (logContext === "BAN" || logContext === "MODERATION") {
				VoiceLogger.moderation(`Removed permissions from ${channel.name} for user ${userId}`);
			} else {
				VoiceLogger.info(logContext, `Removed permissions from ${channel.name} for user ${userId}`);
			}
			return true;
		} catch (error) {
			VoiceLogger.error(logContext, `Failed to remove permissions from ${channel.name} for user ${userId}`, error);
			return false;
		}
	}
}
