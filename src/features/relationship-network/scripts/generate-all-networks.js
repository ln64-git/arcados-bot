import { PostgreSQLManager } from "./dist/features/database/PostgreSQLManager.js";
import { RelationshipNetworkManager } from "./dist/features/relationship-network/NetworkManager.js";

async function generateAllRelationshipNetworks() {
  const db = new PostgreSQLManager();

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect to database");
      return;
    }

    const guildId = "1254694808228986912";

    // Get all non-bot members
    console.log("\n🔹 Fetching all members...");
    const membersResult = await db.getMembersByGuild(guildId);
    if (!membersResult.success || !membersResult.data) {
      console.error("🔸 Failed to get members");
      return;
    }

    const members = membersResult.data.filter((m) => !m.bot);
    console.log(`✅ Found ${members.length} non-bot members`);

    const networkManager = new RelationshipNetworkManager(db);

    let successCount = 0;
    let failCount = 0;
    const startTime = Date.now();

    console.log("\n🔹 Generating relationship networks...\n");

    for (const member of members) {
      try {
        const updateResult = await networkManager.updateMemberRelationships(
          member.user_id,
          guildId
        );

        if (updateResult.success) {
          successCount++;
          if (successCount % 10 === 0) {
            console.log(`✅ Processed ${successCount}/${members.length} users...`);
          }
        } else {
          failCount++;
          console.warn(
            `🔸 Failed to update ${member.user_id}: ${updateResult.error}`
          );
        }
      } catch (error) {
        failCount++;
        console.warn(
          `🔸 Error updating ${member.user_id}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    const duration = Date.now() - startTime;

    console.log("\n" + "=".repeat(60));
    console.log("✅ Generation Complete!");
    console.log("=".repeat(60));
    console.log(`Total users: ${members.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failCount}`);
    console.log(`Total time: ${(duration / 1000).toFixed(1)}s`);
    console.log(`Average per user: ${(duration / members.length).toFixed(0)}ms`);

    // Verify the data
    console.log("\n🔹 Verifying results...");
    const verifyResult = await db.query(
      `
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN relationship_network IS NOT NULL AND jsonb_array_length(relationship_network) > 0 THEN 1 END) as users_with_relationships
      FROM members 
      WHERE guild_id = $1 AND bot = false
      `,
      [guildId]
    );

    if (verifyResult.success && verifyResult.data) {
      const stats = verifyResult.data[0];
      const coverage = (
        (stats.users_with_relationships / stats.total_users) *
        100
      ).toFixed(1);
      console.log(`   Total users: ${stats.total_users}`);
      console.log(`   Users with relationships: ${stats.users_with_relationships}`);
      console.log(`   Coverage: ${coverage}%`);
    }

    // Show some sample data
    console.log("\n🔹 Sample relationship data:");
    const sampleResult = await db.query(
      `
      SELECT 
        m.user_id,
        m.display_name,
        jsonb_array_length(m.relationship_network) as network_size
      FROM members m
      WHERE m.guild_id = $1 
        AND m.bot = false 
        AND m.relationship_network IS NOT NULL 
        AND jsonb_array_length(m.relationship_network) > 0
      ORDER BY jsonb_array_length(m.relationship_network) DESC
      LIMIT 10
      `,
      [guildId]
    );

    if (sampleResult.success && sampleResult.data) {
      sampleResult.data.forEach((user, index) => {
        console.log(
          `   ${index + 1}. ${user.display_name}: ${user.network_size} relationships`
        );
      });
    }

  } catch (error) {
    console.error("🔸 Generation failed:", error);
  } finally {
    await db.disconnect();
    console.log("\n✅ Database disconnected");
  }
}

// Run the generation
generateAllRelationshipNetworks().catch(console.error);