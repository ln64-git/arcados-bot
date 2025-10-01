#!/usr/bin/env tsx

import { pollingPreferenceWatcher } from "../utils/pollingPreferenceWatcher";

// Handle graceful shutdown
process.on("SIGINT", async () => {
	console.log("\n🛑 Stopping preference watcher...");
	pollingPreferenceWatcher.stopWatching();
	process.exit(0);
});

// Start the watcher
console.log("🔍 Starting User Preferences Watcher (Polling Mode)");
console.log(
	"📊 Watching for changes in userPreferences collection (polling every 2s)\n",
);

await pollingPreferenceWatcher.startWatching();
