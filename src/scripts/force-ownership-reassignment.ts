#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { DiscordDataCache } from "../features/cache-management/DiscordDataCache.js";
import { DatabaseCore } from "../features/database-manager/DatabaseCore.js";

async function forceOwnershipReassignment() {
	try {
		console.log("🔍 Force Ownership Reassignment");
		console.log("=".repeat(40));

		const dbCore = new DatabaseCore();
		await dbCore.initialize();

		const cache = new DiscordDataCache();

		// Test channel ID
		const channelId = "1423358562683326647";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(30));

		// Check current ownership
		const owner = await cache.getChannelOwner(channelId);
		console.log(`👤 Current owner: ${owner ? owner.userId : "None"}`);

		if (!owner) {
			console.log("🔸 No owner found - channel is already orphaned");
			return;
		}

		// Remove ownership to force reassignment
		console.log(`\n🗑️  REMOVING OWNERSHIP:`);
		console.log(`👤 Removing owner: ${owner.userId}`);
		await cache.removeChannelOwner(channelId);
		console.log("✅ Ownership removed");

		// Verify removal
		const newOwner = await cache.getChannelOwner(channelId);
		console.log(`\n✅ VERIFICATION:`);
		console.log(`👤 New owner: ${newOwner ? newOwner.userId : "None"}`);

		if (!newOwner) {
			console.log(`\n🎯 OWNERSHIP SUCCESSFULLY REMOVED`);
			console.log(`💡 The bot should now detect this as an orphaned channel`);
			console.log(
				`💡 Next time someone joins/leaves, ownership will be reassigned`,
			);
			console.log(
				`💡 The bot will assign ownership to the longest-standing user`,
			);
		} else {
			console.log(`\n🔸 Ownership still exists - removal failed`);
		}

		console.log(`\n📋 NEXT STEPS:`);
		console.log("-".repeat(20));
		console.log("🔹 Restart the bot to apply all fixes");
		console.log(
			"🔹 Have someone join/leave the channel to trigger reassignment",
		);
		console.log("🔹 The bot should now show the correct owner");
	} catch (error) {
		console.error("🔸 Error forcing ownership reassignment:", error);
	} finally {
		process.exit(0);
	}
}

forceOwnershipReassignment().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
