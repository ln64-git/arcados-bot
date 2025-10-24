#!/usr/bin/env npx tsx

import {
	getUserSummary,
	formatUserSummary,
	formatUserSummaryJSON,
} from "./get-user-summary.js";

async function main() {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.log("🔹 User Summary Command");
		console.log("=".repeat(40));
		console.log("");
		console.log("Usage:");
		console.log("  npm run user:summary <user-id> <guild-id> [--json]");
		console.log("");
		console.log("Arguments:");
		console.log("  user-id    Discord user ID to get summary for");
		console.log("  guild-id   Discord guild/server ID");
		console.log("  --json     Optional: Output in JSON format");
		console.log("");
		console.log("Examples:");
		console.log(
			"  npm run user:summary 354823920010002432 1254694808228986912",
		);
		console.log(
			"  npm run user:summary 354823920010002432 1254694808228986912 --json",
		);
		console.log("");
		console.log("Alternative usage:");
		console.log(
			"  bun src/scripts/get-user-summary.ts <user-id> <guild-id> [--json]",
		);
		console.log(
			"  npx tsx src/scripts/get-user-summary.ts <user-id> <guild-id> [--json]",
		);
		process.exit(1);
	}

	const userId = args[0];
	const guildId = args[1];
	const jsonOutput = args.includes("--json");

	try {
		console.log(`🔹 Getting user summary for ${userId} in guild ${guildId}...`);
		const summary = await getUserSummary(userId, guildId);

		if (jsonOutput) {
			formatUserSummaryJSON(summary);
		} else {
			formatUserSummary(summary);
		}

		console.log("\n✅ User summary retrieved successfully!");
	} catch (error) {
		console.error("🔸 Command failed:", error);
		process.exit(1);
	}
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
