#!/usr/bin/env tsx

import { preferenceWatcher } from "../utils/preferenceWatcher";

// Handle graceful shutdown
process.on("SIGINT", async () => {
	console.log("\n🛑 Stopping preference watcher...");
	await preferenceWatcher.stopWatching();
	process.exit(0);
});

// Start the watcher
console.log("🔍 Starting User Preferences Watcher");
console.log(
	"📊 Watching for real-time changes in userPreferences collection\n",
);

await preferenceWatcher.startWatching();
