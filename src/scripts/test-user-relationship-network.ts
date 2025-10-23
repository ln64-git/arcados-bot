import { PostgreSQLManager } from "../database/PostgreSQLManager";
import { PostgreSQLRelationshipNetworkManager } from "../features/relationship-network/PostgreSQLRelationshipNetworkManager";

/**
 * Test script to build relationship network for a specific user
 */

async function testUserRelationshipNetwork(userId: string): Promise<void> {
	console.log(`🔹 Building relationship network for user ${userId}`);
	console.log("=".repeat(60));

	const db = new PostgreSQLManager();
	const relationshipManager = new PostgreSQLRelationshipNetworkManager(db);

	try {
		// Connect to database
		const connected = await db.connect();
		if (!connected) {
			console.log("🔸 Failed to connect to PostgreSQL database");
			return;
		}

		console.log("🔹 Connected to PostgreSQL database");

		// First, find which guild(s) this user belongs to
		console.log(`\n🔹 Finding guilds for user ${userId}...`);
		const guildQuery = await db.query(`
			SELECT DISTINCT guild_id, username, display_name 
			FROM members 
			WHERE user_id = $1 AND active = true
		`, [userId]);

		if (!guildQuery.success || !guildQuery.data || guildQuery.data.length === 0) {
			console.log(`🔸 User ${userId} not found in any guilds`);
			return;
		}

		console.log(`✅ Found user in ${guildQuery.data.length} guild(s):`);
		guildQuery.data.forEach((member: any) => {
			console.log(`   - Guild: ${member.guild_id} (${member.display_name || member.username})`);
		});

		// Test with the first guild
		const guildId = guildQuery.data[0].guild_id;
		console.log(`\n🔹 Testing with guild ${guildId}...`);

		// Get guild member count
		const memberCountResult = await db.getMembersByGuild(guildId);
		if (memberCountResult.success) {
			console.log(`🔹 Guild has ${memberCountResult.data?.length || 0} members`);
		}

		// Build relationship network
		console.log(`\n🔹 Building relationship network...`);
		const startTime = Date.now();
		
		const relationships = await relationshipManager.buildRelationshipNetwork(userId, guildId);
		
		const duration = Date.now() - startTime;
		console.log(`✅ Relationship network built in ${duration}ms`);

		// Display results
		console.log(`\n🔹 Relationship Network Results:`);
		console.log(`   - Total relationships: ${relationships.length}`);
		
		if (relationships.length > 0) {
			console.log(`\n🔹 Top 10 Relationships:`);
			relationships.slice(0, 10).forEach((rel, index) => {
				const interactionInfo = rel.interaction_count ? ` (${rel.interaction_count} interactions)` : "";
				const lastInteraction = rel.last_interaction 
					? ` - Last: ${rel.last_interaction.toISOString().split('T')[0]}` 
					: "";
				
				console.log(`   ${index + 1}. ${rel.user_id}: ${rel.affinity_score}${interactionInfo}${lastInteraction}`);
			});
		} else {
			console.log(`   - No relationships found (user may not have interacted with others)`);
		}

		// Update the database with the computed relationships
		console.log(`\n🔹 Updating database with computed relationships...`);
		const updateResult = await relationshipManager.updateMemberRelationships(userId, guildId);
		
		if (updateResult.success) {
			console.log(`✅ Successfully updated relationship network in database`);
		} else {
			console.log(`🔸 Failed to update database: ${updateResult.error}`);
		}

		// Test retrieving the relationships
		console.log(`\n🔹 Testing retrieval of stored relationships...`);
		const retrieveResult = await relationshipManager.getTopRelationships(userId, guildId, 5);
		
		if (retrieveResult.success && retrieveResult.data) {
			console.log(`✅ Successfully retrieved ${retrieveResult.data.length} relationships from database`);
		} else {
			console.log(`🔸 Failed to retrieve relationships: ${retrieveResult.error}`);
		}

		console.log(`\n🔹 Test completed successfully!`);
		console.log("=".repeat(60));

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
	const userId = process.argv[2] || "354823920010002432";
	testUserRelationshipNetwork(userId).catch(console.error);
}

export { testUserRelationshipNetwork };
