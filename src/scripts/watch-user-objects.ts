#!/usr/bin/env tsx

import { getDatabase } from "../features/database-manager/DatabaseConnection";
import type { User } from "../types/database";

export interface UserWatcherOptions {
	pollInterval?: number; // Polling interval in milliseconds (default: 2000)
	userId?: string; // Watch specific user by Discord ID
	guildId?: string; // Watch users from specific guild
	showHistory?: boolean; // Show avatar/username history changes
	verbose?: boolean; // Show detailed information
}

export class UserObjectWatcher {
	private lastSeenIds = new Set<string>();
	private lastSeenData = new Map<string, Record<string, unknown>>(); // Store last seen data for comparison
	private isWatching = false;
	private pollInterval: number;
	private userId?: string;
	private guildId?: string;
	private showHistory: boolean;
	private verbose: boolean;

	constructor(options: UserWatcherOptions = {}) {
		this.pollInterval = options.pollInterval || 2000;
		this.userId = options.userId;
		this.guildId = options.guildId;
		this.showHistory = options.showHistory || false;
		this.verbose = options.verbose || false;
	}

	async startWatching(): Promise<void> {
		if (this.isWatching) {
			console.log("⚠️  Already watching users!");
			return;
		}

		console.log("👀 Starting to watch user objects (polling mode)...");
		console.log("Press Ctrl+C to stop watching\n");

		const db = await getDatabase();
		const collection = db.collection("users");

		// Build query filter
		const filter: Record<string, string> = {};
		if (this.userId) {
			filter.discordId = this.userId;
		}
		if (this.guildId) {
			filter.guildId = this.guildId;
		}

		// Show initial count and populate lastSeenIds
		const initialDocs = await collection.find(filter).toArray();
		console.log(
			`📊 Currently ${initialDocs.length} users in database${this.userId ? ` (filtered by user: ${this.userId})` : ""}${this.guildId ? ` (filtered by guild: ${this.guildId})` : ""}`,
		);

		// Add all existing document IDs to lastSeenIds and store their data
		for (const doc of initialDocs) {
			const docId = doc._id.toString();
			this.lastSeenIds.add(docId);
			this.lastSeenData.set(docId, this.serializeUserData(doc));
		}

		console.log("🔍 Monitoring for changes...\n");

		this.isWatching = true;
		this.startPolling();
	}

	private async startPolling(): Promise<void> {
		const db = await getDatabase();
		const collection = db.collection("users");

		const poll = async (): Promise<void> => {
			if (!this.isWatching) return;

			try {
				// Build query filter
				const filter: Record<string, string> = {};
				if (this.userId) {
					filter.discordId = this.userId;
				}
				if (this.guildId) {
					filter.guildId = this.guildId;
				}

				// Get all documents
				const docs = await collection.find(filter).toArray();
				const currentIds = new Set(docs.map((doc) => doc._id.toString()));

				// Check for new documents
				for (const doc of docs) {
					const docId = doc._id.toString();
					if (!this.lastSeenIds.has(docId)) {
						this.handleNewUser(doc);
						this.lastSeenIds.add(docId);
						this.lastSeenData.set(docId, this.serializeUserData(doc));
					}
				}

				// Check for updated documents
				for (const doc of docs) {
					const docId = doc._id.toString();
					if (this.lastSeenIds.has(docId)) {
						const currentData = this.serializeUserData(doc);
						const lastData = this.lastSeenData.get(docId);

						if (JSON.stringify(currentData) !== JSON.stringify(lastData)) {
							this.handleUpdatedUser(doc, lastData, currentData);
							this.lastSeenData.set(docId, currentData);
						}
					}
				}

				// Check for deleted documents
				for (const docId of this.lastSeenIds) {
					if (!currentIds.has(docId)) {
						this.handleDeletedUser(docId);
						this.lastSeenIds.delete(docId);
						this.lastSeenData.delete(docId);
					}
				}
			} catch (error) {
				console.error("🔸 Polling error:", error);
			}

			// Schedule next poll
			setTimeout(poll, this.pollInterval);
		};

		// Start polling
		poll();
	}

	private handleNewUser(doc: User & { _id: unknown }): void {
		const timestamp = new Date().toLocaleTimeString();
		console.log(`[${timestamp}] ➕ NEW USER CREATED`);
		this.displayUser(doc, "new");
		console.log("");
	}

	private handleUpdatedUser(
		doc: User & { _id: unknown },
		oldData: Record<string, unknown>,
		newData: Record<string, unknown>,
	): void {
		const timestamp = new Date().toLocaleTimeString();
		console.log(`[${timestamp}] 🔄 USER UPDATED`);

		// Find what changed
		const changes = this.findChanges(oldData, newData);
		if (changes.length > 0) {
			console.log(`   Changes: ${changes.join(", ")}`);
		}

		this.displayUser(doc, "updated");
		console.log("");
	}

	private handleDeletedUser(docId: string): void {
		const timestamp = new Date().toLocaleTimeString();
		console.log(`[${timestamp}] 🗑️  USER DELETED`);
		console.log(`   Document ID: ${docId}`);
		console.log("");
	}

	private displayUser(
		doc: User & { _id: unknown },
		type: "new" | "updated",
	): void {
		console.log(`   Discord ID: ${doc.discordId}`);
		console.log(`   Username: ${doc.username}`);
		console.log(`   Display Name: ${doc.displayName}`);
		console.log(`   Discriminator: ${doc.discriminator}`);
		console.log(`   Bot: ${doc.bot ? "Yes" : "No"}`);
		console.log(`   Joined: ${doc.joinedAt.toLocaleString()}`);
		console.log(`   Last Seen: ${doc.lastSeen.toLocaleString()}`);

		if (doc.status) {
			console.log(`   Status: "${doc.status}"`);
		}

		if (doc.roles && doc.roles.length > 0) {
			console.log(`   Roles: ${doc.roles.length} roles`);
		}

		if (doc.avatar) {
			console.log(`   Avatar: ${doc.avatar}`);
		}

		// Show metadata if verbose
		if (this.verbose) {
			if (doc.emoji) console.log(`   Emoji: ${doc.emoji}`);
			if (doc.title) console.log(`   Title: ${doc.title}`);
			if (doc.summary) console.log(`   Summary: ${doc.summary}`);
			if (doc.keywords && doc.keywords.length > 0) {
				console.log(`   Keywords: ${doc.keywords.join(", ")}`);
			}
			if (doc.notes && doc.notes.length > 0) {
				console.log(`   Notes: ${doc.notes.length} notes`);
			}
		}

		// Show moderation preferences
		if (doc.modPreferences) {
			const prefs = doc.modPreferences;
			console.log("   Mod Preferences:");
			console.log(
				`     Preferred Channel: ${prefs.preferredChannelName ? `"${prefs.preferredChannelName}"` : "Not set"}`,
			);
			console.log(
				`     Preferred Limit: ${prefs.preferredUserLimit || "Not set"}`,
			);
			console.log(
				`     Preferred Locked: ${prefs.preferredLocked !== undefined ? (prefs.preferredLocked ? "Yes" : "No") : "Not set"}`,
			);
			console.log(
				`     Preferred Hidden: ${prefs.preferredHidden !== undefined ? (prefs.preferredHidden ? "Yes" : "No") : "Not set"}`,
			);
			if (prefs.bannedUsers && prefs.bannedUsers.length > 0) {
				console.log(`     Banned Users: ${prefs.bannedUsers.length}`);
			}
			if (prefs.mutedUsers && prefs.mutedUsers.length > 0) {
				console.log(`     Muted Users: ${prefs.mutedUsers.length}`);
			}
			if (prefs.kickedUsers && prefs.kickedUsers.length > 0) {
				console.log(`     Kicked Users: ${prefs.kickedUsers.length}`);
			}
			if (prefs.deafenedUsers && prefs.deafenedUsers.length > 0) {
				console.log(`     Deafened Users: ${prefs.deafenedUsers.length}`);
			}
			if (prefs.renamedUsers && prefs.renamedUsers.length > 0) {
				console.log(`     Renamed Users: ${prefs.renamedUsers.length}`);
			}
		}

		// Show history if requested
		if (this.showHistory) {
			if (doc.avatarHistory && doc.avatarHistory.length > 0) {
				console.log(`   Avatar History: ${doc.avatarHistory.length} avatars`);
			}
			if (doc.usernameHistory && doc.usernameHistory.length > 0) {
				console.log(
					`   Username History: ${doc.usernameHistory.length} usernames`,
				);
			}
			if (doc.displayNameHistory && doc.displayNameHistory.length > 0) {
				console.log(
					`   Display Name History: ${doc.displayNameHistory.length} names`,
				);
			}
			if (doc.statusHistory && doc.statusHistory.length > 0) {
				console.log(`   Status History: ${doc.statusHistory.length} statuses`);
			}
		}

		console.log(`   Created: ${doc.createdAt.toLocaleString()}`);
		console.log(`   Updated: ${doc.updatedAt.toLocaleString()}`);
	}

	private serializeUserData(
		doc: Record<string, unknown>,
	): Record<string, unknown> {
		// Create a serializable copy for comparison, excluding _id and timestamps
		const { _id, createdAt, updatedAt, ...data } = doc;
		return JSON.parse(JSON.stringify(data));
	}

	private findChanges(
		oldData: Record<string, unknown>,
		newData: Record<string, unknown>,
	): string[] {
		const changes: string[] = [];

		// Check basic fields
		const fieldsToCheck = [
			"username",
			"displayName",
			"discriminator",
			"status",
			"avatar",
			"emoji",
			"title",
			"summary",
			"keywords",
			"notes",
		];

		for (const field of fieldsToCheck) {
			if (oldData[field] !== newData[field]) {
				changes.push(
					`${field}: "${String(oldData[field])}" → "${String(newData[field])}"`,
				);
			}
		}

		// Check arrays
		const arrayFields = [
			"roles",
			"usernameHistory",
			"displayNameHistory",
			"statusHistory",
		];
		for (const field of arrayFields) {
			const oldArray = oldData[field] || [];
			const newArray = newData[field] || [];
			if (JSON.stringify(oldArray) !== JSON.stringify(newArray)) {
				changes.push(`${field}: ${oldArray.length} → ${newArray.length} items`);
			}
		}

		// Check moderation preferences
		if (oldData.modPreferences || newData.modPreferences) {
			const oldPrefs = oldData.modPreferences || {};
			const newPrefs = newData.modPreferences || {};

			const prefFields = [
				"preferredChannelName",
				"preferredUserLimit",
				"preferredLocked",
				"preferredHidden",
			];

			for (const field of prefFields) {
				if (oldPrefs[field] !== newPrefs[field]) {
					changes.push(
						`modPreferences.${field}: "${String(oldPrefs[field])}" → "${String(newPrefs[field])}"`,
					);
				}
			}

			// Check moderation lists
			const modLists = [
				"bannedUsers",
				"mutedUsers",
				"kickedUsers",
				"deafenedUsers",
				"renamedUsers",
			];
			for (const list of modLists) {
				const oldList = oldPrefs[list] || [];
				const newList = newPrefs[list] || [];
				if (JSON.stringify(oldList) !== JSON.stringify(newList)) {
					changes.push(
						`modPreferences.${list}: ${oldList.length} → ${newList.length} items`,
					);
				}
			}
		}

		return changes;
	}

	stopWatching(): void {
		this.isWatching = false;
		console.log("👋 Stopped watching users");
	}
}

// Export a singleton instance
export const userObjectWatcher = new UserObjectWatcher();

// Handle graceful shutdown
process.on("SIGINT", async () => {
	console.log("\n🛑 Stopping user watcher...");
	userObjectWatcher.stopWatching();
	process.exit(0);
});

// Start the watcher
console.log("🔍 Starting User Objects Watcher (Polling Mode)");
console.log("📊 Watching for changes in users collection (polling every 2s)\n");

await userObjectWatcher.startWatching();
