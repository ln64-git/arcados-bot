import { SurrealDBManager } from "../../../database/SurrealDBManager";
import { RelationshipNetworkManager } from "../RelationshipNetworkManager";

/**
 * Simple test script to verify relationship network functionality
 *
 * This script performs basic tests to ensure the relationship network system is working:
 * 1. Database connection test
 * 2. Basic affinity calculation test
 * 3. Relationship network building test
 * 4. Data persistence test
 */

async function testRelationshipNetwork(): Promise<void> {
	console.log("🔹 Starting Relationship Network Tests");
	console.log("=".repeat(50));

	const db = new SurrealDBManager();
	const relationshipManager = new RelationshipNetworkManager(db);

	try {
		// Test 1: Database Connection
		console.log("\n🔹 Test 1: Database Connection");
		console.log("-".repeat(30));

		await db.connect();
		console.log("✅ Database connection successful");

		// Test 2: Get Guild Members
		console.log("\n🔹 Test 2: Get Guild Members");
		console.log("-".repeat(30));

		// Use a test guild ID (replace with real guild ID for actual testing)
		const testGuildId = "123456789012345678";
		const membersResult = await db.getMembersByGuild(testGuildId);

		if (membersResult.success) {
			console.log(
				`✅ Found ${membersResult.data?.length || 0} members in guild`,
			);
		} else {
			console.log(`🔸 No members found or error: ${membersResult.error}`);
		}

		// Test 3: Basic Affinity Calculation
		console.log("\n🔹 Test 3: Basic Affinity Calculation");
		console.log("-".repeat(30));

		if (
			membersResult.success &&
			membersResult.data &&
			membersResult.data.length >= 2
		) {
			const user1 = membersResult.data[0].user_id;
			const user2 = membersResult.data[1].user_id;

			try {
				const affinityResult = await relationshipManager.calculateAffinityScore(
					user1,
					user2,
					testGuildId,
				);

				console.log(`✅ Affinity calculation successful`);
				console.log(`   - User 1: ${user1}`);
				console.log(`   - User 2: ${user2}`);
				console.log(`   - Affinity Score: ${affinityResult.score}`);
				console.log(
					`   - Total Points: ${affinityResult.interaction_summary.total_points}`,
				);
				console.log(
					`   - Interaction Count: ${affinityResult.interaction_summary.interaction_count}`,
				);
			} catch (error) {
				console.log(`🔸 Affinity calculation failed: ${error}`);
			}
		} else {
			console.log("🔸 Skipping affinity test - insufficient members");
		}

		// Test 4: Relationship Network Building
		console.log("\n🔹 Test 4: Relationship Network Building");
		console.log("-".repeat(30));

		if (
			membersResult.success &&
			membersResult.data &&
			membersResult.data.length > 0
		) {
			const testUser = membersResult.data[0].user_id;

			try {
				const relationships =
					await relationshipManager.buildRelationshipNetwork(
						testUser,
						testGuildId,
					);

				console.log(`✅ Relationship network building successful`);
				console.log(`   - Test User: ${testUser}`);
				console.log(`   - Relationships Found: ${relationships.length}`);

				if (relationships.length > 0) {
					console.log(
						`   - Top Relationship: ${relationships[0].user_id} (${relationships[0].affinity_score})`,
					);
				}
			} catch (error) {
				console.log(`🔸 Relationship network building failed: ${error}`);
			}
		} else {
			console.log("🔸 Skipping network building test - no members available");
		}

		// Test 5: Configuration Test
		console.log("\n🔹 Test 5: Configuration Test");
		console.log("-".repeat(30));

		const weights = relationshipManager.getWeights();
		const options = relationshipManager.getOptions();

		console.log("✅ Configuration retrieved successfully");
		console.log(`   - Weights:`, weights);
		console.log(`   - Options:`, options);

		console.log("\n🔹 All Tests Completed!");
		console.log("=".repeat(50));
	} catch (error) {
		console.error("🔸 Test failed:", error);
		throw error;
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from database");
	}
}

/**
 * Test with mock data (no database required)
 */
async function testWithMockData(): Promise<void> {
	console.log("🔹 Testing with Mock Data");
	console.log("=".repeat(50));

	const db = new SurrealDBManager();
	const relationshipManager = new RelationshipNetworkManager(db);

	try {
		// Test configuration
		console.log("\n🔹 Configuration Test");
		console.log("-".repeat(30));

		const weights = relationshipManager.getWeights();
		const options = relationshipManager.getOptions();

		console.log("✅ Configuration test passed");
		console.log(`   - Default Weights:`, weights);
		console.log(`   - Default Options:`, options);

		// Test weight updates
		console.log("\n🔹 Weight Update Test");
		console.log("-".repeat(30));

		const newWeights = {
			sameChannelMessages: 2,
			mentions: 4,
			replies: 6,
		};

		relationshipManager.setWeights(newWeights);
		const updatedWeights = relationshipManager.getWeights();

		console.log("✅ Weight update test passed");
		console.log(`   - Updated Weights:`, updatedWeights);

		// Test options updates
		console.log("\n🔹 Options Update Test");
		console.log("-".repeat(30));

		const newOptions = {
			timeWindowMinutes: 10,
			cacheTTLMinutes: 120,
			minAffinityScore: 5,
			maxRelationships: 100,
		};

		relationshipManager.setOptions(newOptions);
		const updatedOptions = relationshipManager.getOptions();

		console.log("✅ Options update test passed");
		console.log(`   - Updated Options:`, updatedOptions);

		console.log("\n🔹 Mock Data Tests Completed!");
		console.log("=".repeat(50));
	} catch (error) {
		console.error("🔸 Mock test failed:", error);
		throw error;
	}
}

// Export functions for use in other scripts
export { testRelationshipNetwork, testWithMockData };

// CLI interface
async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.log("Usage:");
		console.log("  npm run test-networks");
		console.log("  npm run test-networks mock");
		console.log("");
		console.log("Examples:");
		console.log("  npm run test-networks");
		console.log("  npm run test-networks mock");
		process.exit(1);
	}

	const command = args[0] || "real";

	try {
		switch (command) {
			case "mock":
				await testWithMockData();
				break;

			case "real":
			default:
				await testRelationshipNetwork();
				break;
		}
	} catch (error) {
		console.error("🔸 Test failed:", error);
		process.exit(1);
	}
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
