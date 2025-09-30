import type { GuildMember } from "discord.js";
import { getCacheManager } from "../cache-management/DiscordDataCache";

export interface UserRoleData {
	userId: string;
	guildId: string;
	roleIds: string[];
	storedAt: Date;
	lastUpdated: Date;
}

export class UserManager {
	private cache = getCacheManager();

	/**
	 * Store user roles when they leave the server
	 */
	async storeUserRoles(member: GuildMember): Promise<void> {
		try {
			// Get all roles except @everyone
			const roleIds = member.roles.cache
				.filter((role) => role.id !== member.guild.id)
				.map((role) => role.id);

			if (roleIds.length === 0) {
				console.log(`🔹 User ${member.user.tag} had no roles to store`);
				return;
			}

			const userRoleData: UserRoleData = {
				userId: member.id,
				guildId: member.guild.id,
				roleIds,
				storedAt: new Date(),
				lastUpdated: new Date(),
			};

			// Store in cache and database
			await this.cache.setUserRoleData(
				member.id,
				member.guild.id,
				userRoleData,
			);

			console.log(
				`🔹 Stored ${roleIds.length} roles for user ${member.user.tag} (${member.id})`,
			);
		} catch (error) {
			console.error(
				`🔸 Error storing user roles for ${member.user.tag}:`,
				error,
			);
		}
	}

	/**
	 * Restore user roles when they rejoin the server
	 */
	async restoreUserRoles(member: GuildMember): Promise<void> {
		try {
			const userRoleData = await this.getStoredUserRoles(
				member.id,
				member.guild.id,
			);

			if (!userRoleData || userRoleData.roleIds.length === 0) {
				console.log(`🔹 No stored roles found for user ${member.user.tag}`);
				return;
			}

			// Filter out roles that no longer exist in the guild
			const validRoles = userRoleData.roleIds.filter((roleId) =>
				member.guild.roles.cache.has(roleId),
			);

			if (validRoles.length === 0) {
				console.log(
					`🔹 No valid roles found for user ${member.user.tag} - all stored roles may have been deleted`,
				);
				return;
			}

			// Add roles to the member
			await member.roles.add(
				validRoles,
				"Automatic role restoration on rejoin",
			);

			console.log(
				`🔹 Restored ${validRoles.length} roles for user ${member.user.tag} (${member.id})`,
			);

			// Log the restoration action
			await this.logRoleRestoration(member, validRoles);
		} catch (error) {
			console.error(
				`🔸 Error restoring user roles for ${member.user.tag}:`,
				error,
			);
		}
	}

	/**
	 * Get stored user roles
	 */
	async getStoredUserRoles(
		userId: string,
		guildId: string,
	): Promise<UserRoleData | null> {
		try {
			return await this.cache.getUserRoleData(userId, guildId);
		} catch (error) {
			console.error(`🔸 Error getting stored user roles for ${userId}:`, error);
			return null;
		}
	}

	/**
	 * Clear stored user roles (useful for manual cleanup)
	 */
	async clearStoredUserRoles(userId: string, guildId: string): Promise<void> {
		try {
			await this.cache.deleteUserRoleData(userId, guildId);
			console.log(
				`🔹 Cleared stored roles for user ${userId} in guild ${guildId}`,
			);
		} catch (error) {
			console.error(
				`🔸 Error clearing stored user roles for ${userId}:`,
				error,
			);
		}
	}

	/**
	 * Get all users with stored roles in a guild
	 */
	async getUsersWithStoredRoles(guildId: string): Promise<UserRoleData[]> {
		try {
			return await this.cache.getAllUserRoleData(guildId);
		} catch (error) {
			console.error(
				`🔸 Error getting users with stored roles for guild ${guildId}:`,
				error,
			);
			return [];
		}
	}

	/**
	 * Log role restoration action
	 */
	private async logRoleRestoration(
		member: GuildMember,
		restoredRoles: string[],
	): Promise<void> {
		try {
			const roleNames = restoredRoles
				.map((roleId) => member.guild.roles.cache.get(roleId)?.name)
				.filter(Boolean)
				.join(", ");

			console.log(
				`🔹 Role restoration completed for ${member.user.tag}: ${roleNames}`,
			);

			// You could also log this to a database or send to a logging channel
			// For now, we'll just use console logging
		} catch (error) {
			console.error(`🔸 Error logging role restoration:`, error);
		}
	}

	/**
	 * Check if user has stored roles
	 */
	async hasStoredRoles(userId: string, guildId: string): Promise<boolean> {
		const userRoleData = await this.getStoredUserRoles(userId, guildId);
		return userRoleData !== null && userRoleData.roleIds.length > 0;
	}

	/**
	 * Get count of stored roles for a user
	 */
	async getStoredRoleCount(userId: string, guildId: string): Promise<number> {
		const userRoleData = await this.getStoredUserRoles(userId, guildId);
		return userRoleData?.roleIds.length || 0;
	}
}

export function userManager(): UserManager {
	return new UserManager();
}
