import { SurrealDBManager } from "../../../database/SurrealDBManager";
import { RelationshipNetworkManager } from "../RelationshipNetworkManager";
import {
	analyzeUserRelationships,
	compareUserRelationships,
	getGuildNetworkStats,
} from "./analyze-user-relationships";
import {
	exportGuildNetworks,
	exportNetworkStats,
	exportUserNetwork,
} from "./export-relationship-networks";
import { generateRelationshipNetworks } from "./generate-relationship-networks";

/**
 * Comprehensive demonstration script for the Relationship Network system
 *
 * This script demonstrates all the capabilities of the relationship network system:
 * 1. Database connection and setup
 * 2. Generating relationship networks for a guild
 * 3. Analyzing individual user relationships
 * 4. Comparing users' relationship networks
 * 5. Exporting data in various formats
 * 6. Getting guild-wide statistics
 */

interface DemoConfig {
	guildId: string;
	testUserIds: string[];
	demoMode: boolean; // If true, uses mock data instead of real database
}

async function runComprehensiveDemo(config: DemoConfig): Promise<void> {
	console.log("🔹 Starting Comprehensive Relationship Network Demo");
	console.log("=".repeat(60));
	console.log(`🏰 Guild ID: ${config.guildId}`);
	console.log(`👥 Test Users: ${config.testUserIds.join(", ")}`);
	console.log(
		`🎭 Demo Mode: ${config.demoMode ? "ON (Mock Data)" : "OFF (Real Data)"}`,
	);
	console.log("=".repeat(60));

	const db = new SurrealDBManager();
	const relationshipManager = new RelationshipNetworkManager(db);

	try {
		// Step 1: Database Connection
		console.log("\n🔹 Step 1: Database Connection");
		console.log("-".repeat(30));

		if (!config.demoMode) {
			await db.connect();
			console.log("🔹 Connected to database");
		} else {
			console.log("🔹 Demo mode: Skipping database connection");
		}

		// Step 2: Generate Relationship Networks
		console.log("\n🔹 Step 2: Generate Relationship Networks");
		console.log("-".repeat(30));

		if (!config.demoMode) {
			console.log("🔹 Generating relationship networks for all members...");
			const generationStats = await generateRelationshipNetworks(
				config.guildId,
			);
			console.log(
				`🔹 Generation completed: ${generationStats.successful_updates}/${generationStats.total_members} successful`,
			);
		} else {
			console.log("🔹 Demo mode: Simulating network generation");
			console.log("🔹 Would generate networks for all members in guild");
		}

		// Step 3: Analyze Individual Users
		console.log("\n🔹 Step 3: Analyze Individual Users");
		console.log("-".repeat(30));

		for (const userId of config.testUserIds) {
			console.log(`\n🔹 Analyzing user: ${userId}`);

			if (!config.demoMode) {
				try {
					await analyzeUserRelationships(userId, config.guildId, 10);
				} catch (error) {
					console.log(`🔸 Failed to analyze ${userId}: ${error}`);
				}
			} else {
				console.log("🔹 Demo mode: Would analyze user relationships");
				console.log(`   - User: ${userId}`);
				console.log("   - Top relationships: [Mock data]");
				console.log("   - Network stats: [Mock data]");
			}
		}

		// Step 4: Compare Users
		console.log("\n🔹 Step 4: Compare Users");
		console.log("-".repeat(30));

		if (config.testUserIds.length >= 2) {
			const user1 = config.testUserIds[0];
			const user2 = config.testUserIds[1];

			console.log(`🔹 Comparing ${user1} and ${user2}`);

			if (!config.demoMode) {
				try {
					await compareUserRelationships(user1, user2, config.guildId);
				} catch (error) {
					console.log(`🔸 Failed to compare users: ${error}`);
				}
			} else {
				console.log("🔹 Demo mode: Would compare user networks");
				console.log(`   - User 1: ${user1}`);
				console.log(`   - User 2: ${user2}`);
				console.log("   - Comparison: [Mock data]");
			}
		}

		// Step 5: Guild Statistics
		console.log("\n🔹 Step 5: Guild Statistics");
		console.log("-".repeat(30));

		if (!config.demoMode) {
			try {
				await getGuildNetworkStats(config.guildId);
			} catch (error) {
				console.log(`🔸 Failed to get guild stats: ${error}`);
			}
		} else {
			console.log("🔹 Demo mode: Would get guild statistics");
			console.log("   - Total members: [Mock data]");
			console.log("   - Members with networks: [Mock data]");
			console.log("   - Average affinity: [Mock data]");
		}

		// Step 6: Export Data
		console.log("\n🔹 Step 6: Export Data");
		console.log("-".repeat(30));

		if (!config.demoMode) {
			try {
				console.log("🔹 Exporting guild networks to JSON...");
				await exportGuildNetworks(config.guildId, {
					format: "json",
					includeMetadata: true,
					includeInteractions: true,
					limit: 50,
				});

				console.log("🔹 Exporting guild networks to CSV...");
				await exportGuildNetworks(config.guildId, {
					format: "csv",
					includeMetadata: true,
					includeInteractions: true,
					filterMinScore: 5,
				});

				if (config.testUserIds.length > 0) {
					console.log(
						`🔹 Exporting user network for ${config.testUserIds[0]}...`,
					);
					await exportUserNetwork(config.testUserIds[0], config.guildId, {
						format: "json",
						includeMetadata: true,
						includeInteractions: true,
					});
				}

				console.log("🔹 Exporting network statistics...");
				await exportNetworkStats(config.guildId);
			} catch (error) {
				console.log(`🔸 Failed to export data: ${error}`);
			}
		} else {
			console.log("🔹 Demo mode: Would export data");
			console.log("   - Guild networks (JSON): [Mock file]");
			console.log("   - Guild networks (CSV): [Mock file]");
			console.log("   - User networks: [Mock file]");
			console.log("   - Network statistics: [Mock file]");
		}

		// Step 7: Configuration Display
		console.log("\n🔹 Step 7: Configuration Display");
		console.log("-".repeat(30));

		console.log("🔹 Current Relationship Network Configuration:");
		console.log(`   - Weights:`, relationshipManager.getWeights());
		console.log(`   - Options:`, relationshipManager.getOptions());

		console.log("\n🔹 Demo Complete!");
		console.log("=".repeat(60));
		console.log("🔹 All relationship network features have been demonstrated");
		console.log("🔹 Check the 'exports' directory for generated files");
	} catch (error) {
		console.error("🔸 Demo failed:", error);
		throw error;
	} finally {
		if (!config.demoMode) {
			await db.disconnect();
			console.log("🔹 Disconnected from database");
		}
	}
}

/**
 * Run a quick demo with mock data (no database required)
 */
async function runQuickDemo(): Promise<void> {
	console.log("🔹 Running Quick Demo (No Database Required)");
	console.log("=".repeat(50));

	const mockConfig: DemoConfig = {
		guildId: "123456789012345678",
		testUserIds: ["987654321098765432", "111111111111111111"],
		demoMode: true,
	};

	await runComprehensiveDemo(mockConfig);
}

/**
 * Run a full demo with real database data
 */
async function runFullDemo(
	guildId: string,
	testUserIds: string[],
): Promise<void> {
	console.log("🔹 Running Full Demo (Real Database Data)");
	console.log("=".repeat(50));

	const config: DemoConfig = {
		guildId,
		testUserIds,
		demoMode: false,
	};

	await runComprehensiveDemo(config);
}

// Export functions for use in other scripts
export { runComprehensiveDemo, runQuickDemo, runFullDemo };

// CLI interface
async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.log("Usage:");
		console.log("  npm run demo-quick");
		console.log("  npm run demo-full <guild-id> <user-id1> [user-id2] ...");
		console.log("");
		console.log("Examples:");
		console.log("  npm run demo-quick");
		console.log(
			"  npm run demo-full 123456789012345678 987654321098765432 111111111111111111",
		);
		process.exit(1);
	}

	const command = args[0];

	try {
		switch (command) {
			case "quick": {
				await runQuickDemo();
				break;
			}

			case "full": {
				if (args.length < 3) {
					console.log(
						"🔸 Missing required arguments: <guild-id> <user-id1> [user-id2] ...",
					);
					process.exit(1);
				}
				const guildId = args[1];
				const testUserIds = args.slice(2);
				await runFullDemo(guildId, testUserIds);
				break;
			}

			default:
				console.log("🔸 Unknown command:", command);
				console.log("Available commands: quick, full");
				process.exit(1);
		}
	} catch (error) {
		console.error("🔸 Demo failed:", error);
		process.exit(1);
	}
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
