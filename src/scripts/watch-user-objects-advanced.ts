#!/usr/bin/env tsx

import { getDatabase } from "../features/database-manager/DatabaseConnection";
import type { User } from "../types/database";

export interface UserWatcherOptions {
	pollInterval?: number; // Polling interval in milliseconds (default: 2000)
	userId?: string; // Watch specific user by Discord ID
	guildId?: string; // Watch users from specific guild
	showHistory?: boolean; // Show avatar/username history changes
	verbose?: boolean; // Show detailed information
	watchMode?: "all" | "new" | "updates" | "deletes"; // What to watch for
	filterFields?: string[]; // Only show changes to these fields
	excludeFields?: string[]; // Exclude these fields from change detection
}

export class AdvancedUserObjectWatcher {
	private lastSeenIds = new Set<string>();
	private lastSeenData = new Map<string, Record<string, unknown>>(); // Store last seen data for comparison
	private isWatching = false;
	private pollInterval: number;
	private userId?: string;
	private guildId?: string;
	private showHistory: boolean;
	private verbose: boolean;
	private watchMode: "all" | "new" | "updates" | "deletes";
	private filterFields?: string[];
	private excludeFields?: string[];

	constructor(options: UserWatcherOptions = {}) {
		this.pollInterval = options.pollInterval || 2000;
		this.userId = options.userId;
		this.guildId = options.guildId;
		this.showHistory = options.showHistory || false;
		this.verbose = options.verbose || false;
		this.watchMode = options.watchMode || "all";
		this.filterFields = options.filterFields;
		this.excludeFields = options.excludeFields;
	}

	async startWatching(): Promise<void> {
		if (this.isWatching) {
			console.log("⚠️  Already watching users!");
			return;
		}

		console.log("👀 Starting Advanced User Objects Watcher (polling mode)...");
		console.log(`📋 Watch Mode: ${this.watchMode}`);
		console.log(`⏱️  Poll Interval: ${this.pollInterval}ms`);
		if (this.userId) console.log(`👤 Watching User: ${this.userId}`);
		if (this.guildId) console.log(`🏰 Watching Guild: ${this.guildId}`);
		if (this.filterFields)
			console.log(`🔍 Filter Fields: ${this.filterFields.join(", ")}`);
		if (this.excludeFields)
			console.log(`🚫 Exclude Fields: ${this.excludeFields.join(", ")}`);
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
				if (this.watchMode === "all" || this.watchMode === "new") {
					for (const doc of docs) {
						const docId = doc._id.toString();
						if (!this.lastSeenIds.has(docId)) {
							this.handleNewUser(doc);
							this.lastSeenIds.add(docId);
							this.lastSeenData.set(docId, this.serializeUserData(doc));
						}
					}
				}

				// Check for updated documents
				if (this.watchMode === "all" || this.watchMode === "updates") {
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
				}

				// Check for deleted documents
				if (this.watchMode === "all" || this.watchMode === "deletes") {
					for (const docId of this.lastSeenIds) {
						if (!currentIds.has(docId)) {
							this.handleDeletedUser(docId);
							this.lastSeenIds.delete(docId);
							this.lastSeenData.delete(docId);
						}
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
			// Skip if field is excluded
			if (this.excludeFields?.includes(field)) {
				continue;
			}

			// Skip if field is not in filter
			if (this.filterFields && !this.filterFields.includes(field)) {
				continue;
			}

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
			// Skip if field is excluded
			if (this.excludeFields?.includes(field)) {
				continue;
			}

			// Skip if field is not in filter
			if (this.filterFields && !this.filterFields.includes(field)) {
				continue;
			}

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
				const fullFieldName = `modPreferences.${field}`;

				// Skip if field is excluded
				if (this.excludeFields?.includes(fullFieldName)) {
					continue;
				}

				// Skip if field is not in filter
				if (this.filterFields && !this.filterFields.includes(fullFieldName)) {
					continue;
				}

				if (oldPrefs[field] !== newPrefs[field]) {
					changes.push(
						`${fullFieldName}: "${String(oldPrefs[field])}" → "${String(newPrefs[field])}"`,
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
				const fullFieldName = `modPreferences.${list}`;

				// Skip if field is excluded
				if (this.excludeFields?.includes(fullFieldName)) {
					continue;
				}

				// Skip if field is not in filter
				if (this.filterFields && !this.filterFields.includes(fullFieldName)) {
					continue;
				}

				const oldList = oldPrefs[list] || [];
				const newList = newPrefs[list] || [];
				if (JSON.stringify(oldList) !== JSON.stringify(newList)) {
					changes.push(
						`${fullFieldName}: ${oldList.length} → ${newList.length} items`,
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

// Parse command line arguments
const args = process.argv.slice(2);
const options: UserWatcherOptions = {};

for (let i = 0; i < args.length; i++) {
	const arg = args[i];

	switch (arg) {
		case "--user":
		case "-u":
			options.userId = args[++i];
			break;
		case "--guild":
		case "-g":
			options.guildId = args[++i];
			break;
		case "--interval":
		case "-i":
			options.pollInterval = Number.parseInt(args[++i]);
			break;
		case "--verbose":
		case "-v":
			options.verbose = true;
			break;
		case "--history":
		case "-h":
			options.showHistory = true;
			break;
		case "--mode":
		case "-m":
			{
				const mode = args[++i];
				if (["all", "new", "updates", "deletes"].includes(mode)) {
					options.watchMode = mode as "all" | "new" | "updates" | "deletes";
				}
			}
			break;
		case "--filter":
		case "-f":
			options.filterFields = args[++i].split(",");
			break;
		case "--exclude":
		case "-e":
			options.excludeFields = args[++i].split(",");
			break;
		case "--help":
			console.log(`
Usage: tsx watch-user-objects-advanced.ts [options]

Options:
  -u, --user <id>        Watch specific user by Discord ID
  -g, --guild <id>       Watch users from specific guild
  -i, --interval <ms>    Polling interval in milliseconds (default: 2000)
  -v, --verbose          Show detailed information
  -h, --history          Show avatar/username history changes
  -m, --mode <mode>      Watch mode: all, new, updates, deletes (default: all)
  -f, --filter <fields>  Only show changes to these fields (comma-separated)
  -e, --exclude <fields> Exclude these fields from change detection (comma-separated)
  --help                 Show this help message

Examples:
  tsx watch-user-objects-advanced.ts
  tsx watch-user-objects-advanced.ts --user 123456789 --verbose
  tsx watch-user-objects-advanced.ts --guild 987654321 --mode updates
  tsx watch-user-objects-advanced.ts --filter username,displayName --interval 1000
			`);
			process.exit(0);
	}
}

// Export a singleton instance
export const advancedUserObjectWatcher = new AdvancedUserObjectWatcher(options);

// Handle graceful shutdown
process.on("SIGINT", async () => {
	console.log("\n🛑 Stopping user watcher...");
	advancedUserObjectWatcher.stopWatching();
	process.exit(0);
});

// Start the watcher
console.log("🔍 Starting Advanced User Objects Watcher (Polling Mode)");
console.log("📊 Watching for changes in users collection\n");

await advancedUserObjectWatcher.startWatching();
