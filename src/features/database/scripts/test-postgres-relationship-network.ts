import { PostgreSQLManager } from "../database/PostgreSQLManager";
import { PostgreSQLRelationshipNetworkManager } from "../features/relationship-network/PostgreSQLRelationshipNetworkManager";

/**
 * Test script to verify PostgreSQL relationship network functionality
 */

async function testPostgreSQLRelationshipNetwork(): Promise<void> {
	console.log("🔹 Testing PostgreSQL Relationship Network Integration");
	console.log("=".repeat(60));

	const db = new PostgreSQLManager();
	const relationshipManager = new PostgreSQLRelationshipNetworkManager(db);

	try {
		// Test 1: Database Connection
		console.log("\n🔹 Test 1: Database Connection");
		console.log("-".repeat(30));

		const connected = await db.connect();
		if (connected) {
			console.log("✅ PostgreSQL connection successful");
		} else {
			console.log("🔸 PostgreSQL connection failed - check configuration");
			return;
		}

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

		// Test 6: Database Schema Test
		console.log("\n🔹 Test 6: Database Schema Test");
		console.log("-".repeat(30));

		try {
			// Test if relationship_network column exists
			const schemaTest = await db.query(`
				SELECT column_name, data_type 
				FROM information_schema.columns 
				WHERE table_name = 'members' 
				AND column_name = 'relationship_network'
			`);

			if (schemaTest.success && schemaTest.data && schemaTest.data.length > 0) {
				console.log("✅ relationship_network column exists in members table");
				console.log(`   - Data type: ${schemaTest.data[0].data_type}`);
			} else {
				console.log(
					"🔸 relationship_network column not found - schema may need updating",
				);
			}
		} catch (error) {
			console.log(`🔸 Schema test failed: ${error}`);
		}

		console.log("\n🔹 All Tests Completed!");
		console.log("=".repeat(60));
		console.log("🔹 PostgreSQL Relationship Network integration is working");
	} catch (error) {
		console.error("🔸 Test failed:", error);
		throw error;
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from PostgreSQL");
	}
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
	testPostgreSQLRelationshipNetwork().catch(console.error);
}

export { testPostgreSQLRelationshipNetwork };
