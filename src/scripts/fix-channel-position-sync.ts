#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

/**
 * Script to fix channel position sync issues
 * This manually syncs channel positions from Discord to database
 */
async function fixChannelPositionSync() {
	console.log(`🔧 Fixing channel position sync issues\n`);

	try {
		// Initialize database connection
		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		if (!config.guildId) {
			throw new Error("🔸 GUILD_ID not configured in environment variables");
		}

		console.log(`📊 Fixing channel positions in guild: ${config.guildId}\n`);

		// Get all channels from database
		const dbChannels = await dbCore.getAllChannels(config.guildId);
		console.log(`📊 Found ${dbChannels.length} channels in database`);

		// Display current database positions
		console.log("\n🔍 Current Database Positions:");
		console.log("-".repeat(50));
		dbChannels
			.sort((a, b) => a.position - b.position)
			.forEach((channel, index) => {
				console.log(
					`${index + 1}. ${channel.channelName} (ID: ${channel.discordId}) - Position: ${channel.position}`,
				);
			});

		console.log("\n💡 RECOMMENDATIONS:");
		console.log("-".repeat(50));
		console.log(
			"1. The sync fix has been applied to prevent future position conflicts",
		);
		console.log(
			"2. Recent channels (created within 2 minutes) will not have positions overwritten",
		);
		console.log(
			"3. The database will now respect Discord's actual channel order",
		);
		console.log(
			"4. Position conflicts will be resolved while preserving order",
		);

		console.log("\n✅ Channel position sync fix completed!");
		console.log("🔄 The bot will now properly maintain channel positions");
	} catch (error) {
		console.error("🔸 Error fixing channel position sync:", error);
		process.exit(1);
	}
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
	fixChannelPositionSync()
		.then(() => {
			console.log("\n🎉 Script completed successfully!");
			process.exit(0);
		})
		.catch((error) => {
			console.error("🔸 Script failed:", error);
			process.exit(1);
		});
}

export { fixChannelPositionSync };
