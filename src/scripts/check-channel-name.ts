#!/usr/bin/env tsx

import { config } from "../config/index.js";
import { getDatabase } from "../features/database-manager/DatabaseConnection.js";

async function checkChannelName() {
	try {
		console.log("🔍 Checking Channel Name and Filtering");
		console.log("=".repeat(50));

		const channelId = "1254696036988092437";

		console.log(`\n📋 CHANNEL: ${channelId}`);
		console.log("-".repeat(20));

		// Test the isAFKChannel function
		function isAFKChannel(channel: { name?: string }): boolean {
			return channel?.name?.toLowerCase().includes("afk") || false;
		}

		// Test with various possible channel names
		const testNames = [
			"VC Logs",
			"vc logs",
			"VC Logs AFK",
			"vc-logs",
			"Voice Chat Logs",
			"voice logs",
			"AFK Channel",
			"afk",
			"General",
			"general",
		];

		console.log(`\n🔍 TESTING CHANNEL NAME FILTERING:`);
		console.log("-".repeat(40));

		for (const name of testNames) {
			const isFiltered = isAFKChannel({ name });
			console.log(`📺 "${name}": ${isFiltered ? "🔸 FILTERED" : "✅ ALLOWED"}`);
		}

		console.log(`\n💡 DIAGNOSIS:`);
		console.log("-".repeat(20));
		console.log("🔹 If channel name contains 'afk', it's filtered out");
		console.log(
			"🔹 If channel name doesn't contain 'afk', there's another issue",
		);
		console.log("🔹 Check if the channel actually exists in Discord");
		console.log(
			"🔹 Verify RealtimeTracker is running and listening to voice events",
		);

		console.log(`\n🔧 SOLUTION:`);
		console.log("-".repeat(20));
		console.log(
			"🔹 If channel is filtered by name, rename it to not contain 'afk'",
		);
		console.log(
			"🔹 If channel doesn't exist, create it or use correct channel ID",
		);
		console.log("🔹 If RealtimeTracker isn't working, restart the bot");
	} catch (error) {
		console.error("🔸 Error checking channel name:", error);
	} finally {
		process.exit(0);
	}
}

checkChannelName().catch((error) => {
	console.error("🔸 Fatal error:", error);
	process.exit(1);
});
