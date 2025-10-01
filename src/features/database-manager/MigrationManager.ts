import type { Db } from "mongodb";
import type { ModPreferences, RenamedUser, User } from "../../types/database";
import { getDatabase } from "./DatabaseConnection";

export class MigrationManager {
	private db: Db | null = null;

	async initialize(): Promise<void> {
		this.db = await getDatabase();
		if (!this.db) {
			throw new Error("Database connection failed.");
		}
	}

	/**
	 * Migrate user preferences from separate collections to user documents
	 * This is a one-time migration to restructure the data
	 */
	async migrateUserPreferencesToUsers(): Promise<{
		success: boolean;
		migratedUsers: number;
		migratedPreferences: number;
		errors: string[];
	}> {
		const errors: string[] = [];
		let migratedUsers = 0;
		let migratedPreferences = 0;

		try {
			if (!this.db) {
				throw new Error("Database not initialized");
			}

			console.log("🔧 Starting user preferences migration...");

			// Get all users
			const users = await this.db.collection("users").find({}).toArray();
			console.log(`📊 Found ${users.length} users to migrate`);

			// Get all user preferences
			const userPreferences = await this.db
				.collection("userPreferences")
				.find({})
				.toArray();
			console.log(
				`📊 Found ${userPreferences.length} user preferences to migrate`,
			);

			// Get all voice channel owners
			const channelOwners = await this.db
				.collection("voiceChannelOwners")
				.find({})
				.toArray();
			console.log(`📊 Found ${channelOwners.length} channel owners to migrate`);

			// Create a map of preferences by userId
			const preferencesMap = new Map<string, Record<string, unknown>[]>();
			for (const pref of userPreferences) {
				if (!preferencesMap.has(pref.userId)) {
					preferencesMap.set(pref.userId, []);
				}
				const existingPrefs = preferencesMap.get(pref.userId);
				if (existingPrefs) {
					existingPrefs.push(pref);
				}
			}

			// Create a map of channel owners by userId
			const ownersMap = new Map<string, Record<string, unknown>[]>();
			for (const owner of channelOwners) {
				if (!ownersMap.has(owner.userId)) {
					ownersMap.set(owner.userId, []);
				}
				const existingOwners = ownersMap.get(owner.userId);
				if (existingOwners) {
					existingOwners.push(owner);
				}
			}

			// Migrate each user
			for (const user of users) {
				try {
					const userPrefs = preferencesMap.get(user.discordId) || [];

					// Create consolidated mod preferences from all user preferences
					const modPreferences: ModPreferences = {
						bannedUsers: [],
						mutedUsers: [],
						kickedUsers: [],
						deafenedUsers: [],
						renamedUsers: [],
						preferredChannelName: undefined,
						preferredUserLimit: undefined,
						preferredLocked: undefined,
						lastUpdated: new Date(),
					};

					// Initialize new fields
					const avatarHistory: Record<string, unknown>[] = [];
					const statusHistory: Record<string, unknown>[] = [];
					const relationships: Record<string, unknown>[] = [];

					// Consolidate all preferences into one mod preferences object
					for (const pref of userPrefs) {
						// Merge arrays (avoid duplicates)
						if (pref.bannedUsers) {
							modPreferences.bannedUsers = [
								...new Set([
									...modPreferences.bannedUsers,
									...(pref.bannedUsers as string[]),
								]),
							];
						}
						if (pref.mutedUsers) {
							modPreferences.mutedUsers = [
								...new Set([
									...modPreferences.mutedUsers,
									...(pref.mutedUsers as string[]),
								]),
							];
						}
						if (pref.kickedUsers) {
							modPreferences.kickedUsers = [
								...new Set([
									...modPreferences.kickedUsers,
									...(pref.kickedUsers as string[]),
								]),
							];
						}
						if (pref.deafenedUsers) {
							modPreferences.deafenedUsers = [
								...new Set([
									...modPreferences.deafenedUsers,
									...(pref.deafenedUsers as string[]),
								]),
							];
						}
						if (pref.renamedUsers) {
							// Remove channelId from renamed users and merge
							const renamedUsersWithoutChannel = (
								pref.renamedUsers as Record<string, unknown>[]
							).map((ru: Record<string, unknown>) => ({
								userId: ru.userId as string,
								originalNickname: ru.originalNickname as string | null,
								scopedNickname: ru.scopedNickname as string,
								renamedAt: ru.renamedAt as Date,
							}));
							modPreferences.renamedUsers = [
								...modPreferences.renamedUsers,
								...renamedUsersWithoutChannel,
							];
						}

						// Use the most recent preferences for channel settings
						if (pref.preferredChannelName) {
							modPreferences.preferredChannelName =
								pref.preferredChannelName as string;
						}
						if (pref.preferredUserLimit !== undefined) {
							modPreferences.preferredUserLimit =
								pref.preferredUserLimit as number;
						}
						if (pref.preferredLocked !== undefined) {
							modPreferences.preferredLocked = pref.preferredLocked as boolean;
						}
						if (pref.lastUpdated) {
							modPreferences.lastUpdated = pref.lastUpdated as Date;
						}

						migratedPreferences++;
					}

					// Update user document with mod preferences and new fields
					await this.db.collection("users").updateOne(
						{ _id: user._id },
						{
							$set: {
								modPreferences,
								avatarHistory,
								statusHistory,
								relationships,
								status: undefined,
								updatedAt: new Date(),
							},
						},
					);

					migratedUsers++;

					if (migratedUsers % 100 === 0) {
						console.log(
							`📊 Migrated ${migratedUsers}/${users.length} users...`,
						);
					}
				} catch (error) {
					errors.push(`Failed to migrate user ${user.discordId}: ${error}`);
				}
			}

			console.log(
				`✅ Migration completed: ${migratedUsers} users, ${migratedPreferences} preferences`,
			);

			return {
				success: errors.length === 0,
				migratedUsers,
				migratedPreferences,
				errors,
			};
		} catch (error) {
			console.error("🔸 Migration failed:", error);
			errors.push(`Migration failed: ${error}`);
			return {
				success: false,
				migratedUsers,
				migratedPreferences,
				errors,
			};
		}
	}

	/**
	 * Clean up old collections after successful migration
	 */
	async cleanupOldCollections(): Promise<{
		success: boolean;
		errors: string[];
	}> {
		const errors: string[] = [];

		try {
			if (!this.db) {
				throw new Error("Database not initialized");
			}

			console.log("🧹 Cleaning up old collections...");

			// Drop old collections
			await this.db
				.collection("userPreferences")
				.drop()
				.catch(() => {
					console.log(
						"ℹ️ userPreferences collection already dropped or doesn't exist",
					);
				});

			await this.db
				.collection("voiceChannelOwners")
				.drop()
				.catch(() => {
					console.log(
						"ℹ️ voiceChannelOwners collection already dropped or doesn't exist",
					);
				});

			console.log("✅ Old collections cleaned up successfully");
			return { success: true, errors };
		} catch (error) {
			console.error("🔸 Cleanup failed:", error);
			errors.push(`Cleanup failed: ${error}`);
			return { success: false, errors };
		}
	}

	/**
	 * Check if migration is needed
	 */
	async isMigrationNeeded(): Promise<boolean> {
		try {
			if (!this.db) {
				throw new Error("Database not initialized");
			}

			// Check if old collections exist
			const collections = await this.db.listCollections().toArray();
			const hasOldCollections = collections.some(
				(c) => c.name === "userPreferences" || c.name === "voiceChannelOwners",
			);

			// Check if any users have modPreferences field
			const usersWithPreferences = await this.db
				.collection("users")
				.countDocuments({
					modPreferences: { $exists: true },
				});

			return hasOldCollections || usersWithPreferences === 0;
		} catch (error) {
			console.error("🔸 Error checking migration status:", error);
			return true; // Assume migration is needed if we can't check
		}
	}

	/**
	 * Get migration status
	 */
	async getMigrationStatus(): Promise<{
		needsMigration: boolean;
		oldCollectionsExist: boolean;
		usersWithPreferences: number;
		totalUsers: number;
	}> {
		try {
			if (!this.db) {
				throw new Error("Database not initialized");
			}

			const collections = await this.db.listCollections().toArray();
			const oldCollectionsExist = collections.some(
				(c) => c.name === "userPreferences" || c.name === "voiceChannelOwners",
			);

			const usersWithPreferences = await this.db
				.collection("users")
				.countDocuments({
					modPreferences: { $exists: true },
				});

			const totalUsers = await this.db.collection("users").countDocuments();

			return {
				needsMigration: oldCollectionsExist || usersWithPreferences === 0,
				oldCollectionsExist,
				usersWithPreferences,
				totalUsers,
			};
		} catch (error) {
			console.error("🔸 Error getting migration status:", error);
			return {
				needsMigration: true,
				oldCollectionsExist: true,
				usersWithPreferences: 0,
				totalUsers: 0,
			};
		}
	}
}
