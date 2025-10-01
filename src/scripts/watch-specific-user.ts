#!/usr/bin/env tsx

import { getDatabase } from "../features/database-manager/DatabaseConnection";
import type { User } from "../types/database";

// Get user ID from command line argument
const userId = process.argv[2];

if (!userId) {
	console.log("🔸 Usage: tsx watch-specific-user.ts <discord-user-id>");
	console.log("Example: tsx watch-specific-user.ts 123456789012345678");
	process.exit(1);
}

console.log(`👀 Watching user: ${userId}`);
console.log("Press Ctrl+C to stop watching\n");

const lastSeenData = new Map<string, string>();
let isWatching = true;

async function watchUser(): Promise<void> {
	const db = await getDatabase();
	const collection = db.collection("users");

	try {
		// Find user by Discord ID
		const user = await collection.findOne({ discordId: userId });

		if (!user) {
			console.log(`🔸 User ${userId} not found in database`);
			return;
		}

		const currentData = JSON.stringify(user);
		const lastData = lastSeenData.get(userId);

		// Check if user data has changed
		if (currentData !== lastData) {
			const timestamp = new Date().toLocaleTimeString();

			if (lastData) {
				console.log(`[${timestamp}] 🔄 USER UPDATED`);
				// Find what changed
				const oldUser = JSON.parse(lastData);
				const changes = findChanges(oldUser, user);
				if (changes.length > 0) {
					console.log(`   Changes: ${changes.join(", ")}`);
				}
			} else {
				console.log(`[${timestamp}] 👤 USER FOUND`);
			}

			// Display user information
			displayUser(user as User & { _id: unknown });
			console.log("");

			// Update last seen data
			lastSeenData.set(userId, currentData);
		}
	} catch (error) {
		console.error("🔸 Error watching user:", error);
	}

	// Schedule next check
	if (isWatching) {
		setTimeout(watchUser, 2000); // Check every 2 seconds
	}
}

function displayUser(doc: User & { _id: unknown }): void {
	console.log(`   Discord ID: ${doc.discordId}`);
	console.log(`   Username: ${doc.username}`);
	console.log(`   Display Name: ${doc.displayName}`);
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

	console.log(`   Created: ${doc.createdAt.toLocaleString()}`);
	console.log(`   Updated: ${doc.updatedAt.toLocaleString()}`);
}

function findChanges(
	oldUser: Record<string, unknown>,
	newUser: Record<string, unknown>,
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
	];

	for (const field of fieldsToCheck) {
		if (oldUser[field] !== newUser[field]) {
			changes.push(
				`${field}: "${String(oldUser[field])}" → "${String(newUser[field])}"`,
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
		const oldArray = (oldUser[field] as unknown[]) || [];
		const newArray = (newUser[field] as unknown[]) || [];
		if (JSON.stringify(oldArray) !== JSON.stringify(newArray)) {
			changes.push(`${field}: ${oldArray.length} → ${newArray.length} items`);
		}
	}

	// Check moderation preferences
	if (oldUser.modPreferences || newUser.modPreferences) {
		const oldPrefs = (oldUser.modPreferences as Record<string, unknown>) || {};
		const newPrefs = (newUser.modPreferences as Record<string, unknown>) || {};

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
			const oldList = (oldPrefs[list] as unknown[]) || [];
			const newList = (newPrefs[list] as unknown[]) || [];
			if (JSON.stringify(oldList) !== JSON.stringify(newList)) {
				changes.push(
					`modPreferences.${list}: ${oldList.length} → ${newList.length} items`,
				);
			}
		}
	}

	return changes;
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
	console.log("\n🛑 Stopping user watcher...");
	isWatching = false;
	process.exit(0);
});

// Start watching
await watchUser();
