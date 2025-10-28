import { PostgreSQLManager } from "./dist/features/database/PostgreSQLManager.js";
import { RelationshipNetworkManager } from "./dist/features/relationship-network/NetworkManager.js";

async function generateSingleUserRelationships(userId, guildId = "1254694808228986912") {
  const db = new PostgreSQLManager();
  
  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect to database");
      return;
    }

    console.log(`🔹 Generating relationship network for user: ${userId}`);

    const networkManager = new RelationshipNetworkManager(db);
    
    const startTime = Date.now();
    const relationships = await networkManager.buildRelationshipNetwork(userId, guildId);
    const duration = Date.now() - startTime;
    
    console.log(`✅ Generated ${relationships.length} relationships in ${duration}ms`);

    // Show top 10 relationships
    console.log("\n🔹 Top 10 Relationships:");
    relationships.slice(0, 10).forEach((rel, index) => {
      console.log(`   ${index + 1}. "${rel.display_name || 'Unknown'}" - ${rel.affinity_percentage.toFixed(1)}% (${rel.raw_points?.toFixed(1) || 0} pts)`);
    });

    // Update in database
    console.log("\n🔹 Updating relationship network in database...");
    const updateResult = await networkManager.updateMemberRelationships(userId, guildId);
    
    if (updateResult.success) {
      console.log("✅ Relationship network updated successfully");
    } else {
      console.log("🔸 Failed to update:", updateResult.error);
    }

    return relationships;

  } catch (error) {
    console.error("🔸 Generation failed:", error);
    return null;
  } finally {
    await db.disconnect();
    console.log("🔹 Database disconnected");
  }
}

// Export for use in other scripts
export { generateSingleUserRelationships };

// If run directly, test with Lucas
if (import.meta.url === `file://${process.argv[1]}`) {
  const testUserId = "354823920010002432"; // Lucas
  generateSingleUserRelationships(testUserId).catch(console.error);
}

