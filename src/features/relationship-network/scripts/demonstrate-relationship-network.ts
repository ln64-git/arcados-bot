import { Client } from "discord.js";
import { SurrealDBManager } from "../../../database/SurrealDBManager";
import { RelationshipNetworkManager } from "../RelationshipNetworkManager";

/**
 * Example script demonstrating the Relationship Network system
 *
 * This script shows how to:
 * 1. Initialize the relationship network manager
 * 2. Calculate affinity scores between users
 * 3. Build and retrieve relationship networks
 * 4. Update member relationships in the database
 */
async function demonstrateRelationshipNetwork() {
	console.log("🔹 Starting Relationship Network demonstration...");

	// Initialize database and client (you would normally do this in your main bot)
	const client = new Client({ intents: [] });
	const db = new SurrealDBManager();

	// Connect to database
	await db.connect();

	// Initialize relationship network manager
	const relationshipManager = new RelationshipNetworkManager(db);

	// Example guild and user IDs (replace with real values for testing)
	const guildId = "your-guild-id";
	const userId = "your-user-id";

	try {
		// 1. Get top relationships for a user (with on-demand computation)
		console.log(`🔹 Getting top relationships for user ${userId}...`);
		const relationshipsResult = await relationshipManager.getTopRelationships(
			userId,
			guildId,
			10, // Top 10 relationships
		);

		if (relationshipsResult.success && relationshipsResult.data) {
			console.log(`🔹 Found ${relationshipsResult.data.length} relationships:`);
			relationshipsResult.data.forEach((rel, index) => {
				console.log(
					`   ${index + 1}. User ${rel.user_id}: ${rel.affinity_score} points (${rel.interaction_count} interactions)`,
				);
			});
		} else {
			console.log(
				`🔸 Failed to get relationships: ${relationshipsResult.error}`,
			);
		}

		// 2. Calculate affinity score between two specific users
		const otherUserId = "another-user-id";
		console.log(
			`🔹 Calculating affinity between ${userId} and ${otherUserId}...`,
		);

		try {
			const affinityResult = await relationshipManager.calculateAffinityScore(
				userId,
				otherUserId,
				guildId,
			);

			console.log(`🔹 Affinity score: ${affinityResult.score}`);
			console.log(`🔹 Interaction breakdown:`);
			console.log(
				`   - Same channel: ${affinityResult.interaction_summary.breakdown.same_channel}`,
			);
			console.log(
				`   - Mentions: ${affinityResult.interaction_summary.breakdown.mentions}`,
			);
			console.log(
				`   - Replies: ${affinityResult.interaction_summary.breakdown.replies}`,
			);
			console.log(
				`   - Total points: ${affinityResult.interaction_summary.total_points}`,
			);
		} catch (error) {
			console.log(`🔸 Failed to calculate affinity: ${error}`);
		}

		// 3. Manually update relationships for a user
		console.log(`🔹 Manually updating relationships for ${userId}...`);
		const updateResult = await relationshipManager.updateMemberRelationships(
			userId,
			guildId,
		);

		if (updateResult.success) {
			console.log("🔹 Successfully updated member relationships");
		} else {
			console.log(`🔸 Failed to update relationships: ${updateResult.error}`);
		}

		// 4. Show current configuration
		console.log("🔹 Current configuration:");
		console.log(`   - Weights:`, relationshipManager.getWeights());
		console.log(`   - Options:`, relationshipManager.getOptions());
	} catch (error) {
		console.error("🔸 Error in demonstration:", error);
	} finally {
		// Cleanup
		await db.disconnect();
		client.destroy();
		console.log("🔹 Demonstration complete");
	}
}

// Export for use in other scripts
export { demonstrateRelationshipNetwork };

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	demonstrateRelationshipNetwork().catch(console.error);
}
