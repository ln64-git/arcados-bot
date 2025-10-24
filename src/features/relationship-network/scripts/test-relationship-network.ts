import { SurrealDBManager } from "../database/SurrealDBManager.js";
import { RelationshipNetworkManager } from "../features/relationship-network/RelationshipNetworkManager.js";
import dotenv from "dotenv";

dotenv.config();

const TARGET_USER_ID = "99195129516007424";

console.log("🔹 Testing Relationship Network with Current Data...");
console.log("🔹 Target User ID:", TARGET_USER_ID);

async function main() {
	try {
		// Connect to SurrealDB
		console.log("🔹 Connecting to SurrealDB...");
		const db = new SurrealDBManager();
		await db.connect();
		console.log("✅ Connected to SurrealDB");

		// Get all messages from database
		console.log("🔹 Fetching messages from database...");
		const messages = await db.getMessages();
		console.log(`✅ Found ${messages.length} messages in database`);

		if (messages.length === 0) {
			console.log("❌ No messages found in database");
			return;
		}

		// Get unique users from messages
		const userIds = [...new Set(messages.map((msg) => msg.author_id))];
		console.log(`🔹 Found ${userIds.length} unique users`);

		// Check if target user exists
		const targetUserMessages = messages.filter(
			(msg) => msg.author_id === TARGET_USER_ID,
		);
		console.log(
			`🔹 Target user ${TARGET_USER_ID} has ${targetUserMessages.length} messages`,
		);

		if (targetUserMessages.length === 0) {
			console.log("❌ Target user not found in database");
			return;
		}

		// Initialize Relationship Network Manager
		console.log("🔹 Initializing Relationship Network Manager...");
		const relationshipManager = new RelationshipNetworkManager(db);
		await relationshipManager.initialize();
		console.log("✅ Relationship Network Manager initialized");

		// Calculate relationships for target user
		console.log("🔹 Calculating relationships for target user...");
		const relationships =
			await relationshipManager.getUserRelationships(TARGET_USER_ID);
		console.log(`✅ Found ${relationships.length} relationships`);

		// Display top relationships
		console.log("\n🎯 TOP RELATIONSHIPS FOR USER", TARGET_USER_ID);
		console.log("=".repeat(60));

		const topRelationships = relationships
			.sort((a, b) => b.affinityScore - a.affinityScore)
			.slice(0, 10);

		for (let i = 0; i < topRelationships.length; i++) {
			const rel = topRelationships[i];
			console.log(`${i + 1}. User: ${rel.userId}`);
			console.log(`   Affinity Score: ${rel.affinityScore.toFixed(2)}`);
			console.log(`   Interactions: ${rel.interactions}`);
			console.log(`   Channels: ${rel.channels.join(", ")}`);
			console.log(`   Last Interaction: ${rel.lastInteraction}`);
			console.log("");
		}

		// Get relationship details
		if (relationships.length > 0) {
			const topUser = relationships[0].userId;
			console.log(`🔹 Getting detailed relationship with ${topUser}...`);
			const details = await relationshipManager.getRelationshipDetails(
				TARGET_USER_ID,
				topUser,
			);

			console.log("\n📊 DETAILED RELATIONSHIP ANALYSIS");
			console.log("=".repeat(60));
			console.log(`Users: ${TARGET_USER_ID} ↔ ${topUser}`);
			console.log(`Affinity Score: ${details.affinityScore.toFixed(2)}`);
			console.log(`Total Interactions: ${details.interactions}`);
			console.log(`Shared Channels: ${details.channels.length}`);
			console.log(`Channels: ${details.channels.join(", ")}`);
			console.log(`First Interaction: ${details.firstInteraction}`);
			console.log(`Last Interaction: ${details.lastInteraction}`);
			console.log(`Interaction Types:`);
			console.log(`  - Same Channel: ${details.interactionTypes.sameChannel}`);
			console.log(`  - Mentions: ${details.interactionTypes.mentions}`);
			console.log(`  - Replies: ${details.interactionTypes.replies}`);
		}

		console.log("\n🎉 Relationship Network Test Complete!");
	} catch (error) {
		console.error("❌ Test failed:", error);
	} finally {
		process.exit(0);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
