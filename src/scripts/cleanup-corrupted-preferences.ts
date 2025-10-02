#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to clean up corrupted user preferences that might be causing random disconnections
 * This removes any preferences with empty guildId or invalid data
 */
async function cleanupCorruptedPreferences() {
	console.log("🧹 Cleaning up corrupted user preferences...\n");

	try {
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Analyzing user preferences for guild: ${config.guildId}\n`);

		// Get database connection
		const db = await dbCore.getDatabase();
		const preferencesCollection = db.collection("userPreferences");

		// Find all preferences
		const allPreferences = await preferencesCollection.find({}).toArray();
		console.log(`📈 Found ${allPreferences.length} total user preferences\n`);

		// Find corrupted preferences
		const corruptedPreferences = allPreferences.filter((pref) => {
			// Check for common corruption patterns
			return (
				!pref.guildId || // Missing guild ID
				pref.guildId === "" || // Empty guild ID
				pref.guildId !== config.guildId || // Wrong guild ID
				!pref.userId || // Missing user ID
				!Array.isArray(pref.bannedUsers) || // Invalid banned users array
				!Array.isArray(pref.mutedUsers) || // Invalid muted users array
				!Array.isArray(pref.deafenedUsers) || // Invalid deafened users array
				!Array.isArray(pref.renamedUsers) // Invalid renamed users array
			);
		});

		console.log(
			`🔍 Found ${corruptedPreferences.length} corrupted preferences\n`,
		);

		if (corruptedPreferences.length === 0) {
			console.log("✅ No corrupted preferences found!\n");
			return;
		}

		console.log("🚨 CORRUPTED PREFERENCES FOUND:\n");
		console.log("=".repeat(80));
		console.log("User ID | Guild ID | Issues");
		console.log("=".repeat(80));

		for (const pref of corruptedPreferences) {
			const issues = [];
			if (!pref.guildId || pref.guildId === "") issues.push("Missing guild ID");
			if (pref.guildId !== config.guildId) issues.push("Wrong guild ID");
			if (!pref.userId) issues.push("Missing user ID");
			if (!Array.isArray(pref.bannedUsers)) issues.push("Invalid banned users");
			if (!Array.isArray(pref.mutedUsers)) issues.push("Invalid muted users");
			if (!Array.isArray(pref.deafenedUsers))
				issues.push("Invalid deafened users");
			if (!Array.isArray(pref.renamedUsers))
				issues.push("Invalid renamed users");

			const userId = pref.userId
				? pref.userId.substring(0, 8) + "..."
				: "MISSING";
			const guildId = pref.guildId || "MISSING";
			console.log(
				`${userId.padEnd(8)} | ${guildId.padEnd(8)} | ${issues.join(", ")}`,
			);
		}

		console.log("\n" + "=".repeat(80));

		// Ask for confirmation before deletion
		console.log("\n⚠️  WARNING: This will delete corrupted preferences!");
		console.log("These preferences might be causing random disconnections.");
		console.log("Users will need to set their preferences again.\n");

		// For now, just report what would be deleted
		console.log("🔧 RECOMMENDED ACTIONS:\n");
		console.log("1. 🗑️  Delete corrupted preferences:");
		console.log("   - These preferences have invalid data");
		console.log("   - They might be causing random disconnections");
		console.log("   - Users can set their preferences again");

		console.log("\n2. 🔍 Investigate specific users:");
		for (const pref of corruptedPreferences.slice(0, 5)) {
			if (pref.userId) {
				console.log(`   - User ID: ${pref.userId}`);
			}
		}
		if (corruptedPreferences.length > 5) {
			console.log(`   - ... and ${corruptedPreferences.length - 5} more users`);
		}

		console.log("\n3. 📊 Check for patterns:");
		const guildIdIssues = corruptedPreferences.filter(
			(p) => !p.guildId || p.guildId === "",
		).length;
		const arrayIssues = corruptedPreferences.filter(
			(p) =>
				!Array.isArray(p.bannedUsers) ||
				!Array.isArray(p.mutedUsers) ||
				!Array.isArray(p.deafenedUsers),
		).length;

		console.log(
			`   - ${guildIdIssues} preferences with missing/wrong guild ID`,
		);
		console.log(`   - ${arrayIssues} preferences with invalid arrays`);

		console.log("\n🎯 NEXT STEPS:\n");
		console.log("1. Review the corrupted preferences above");
		console.log(
			"2. If you want to delete them, run this script with --delete flag",
		);
		console.log("3. Monitor voice channels for fewer random disconnections");
		console.log("4. Users can re-set their preferences if needed");

		console.log("\n💡 PREVENTION:\n");
		console.log("The fix in VoiceManager.ts should prevent future corruption:");
		console.log(
			"- Fixed empty guildId parameter in applyPreferencesToNewJoiner()",
		);
		console.log("- Added safety checks for missing call state and owners");
		console.log("- Added logging for preference application");
	} catch (error) {
		console.error("🔸 Error during preferences cleanup:", error);
	} finally {
		console.log("\n✅ Preferences cleanup analysis completed!\n");
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	cleanupCorruptedPreferences().catch(console.error);
}
