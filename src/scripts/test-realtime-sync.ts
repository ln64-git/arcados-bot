import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { RelationshipNetworkManager } from "../features/relationship-network/NetworkManager";

async function testRealtimeSync() {
  const db = new PostgreSQLManager();

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect");
      return;
    }

    console.log("✅ Connected\n");

    const guildId = process.env.GUILD_ID || process.argv[2];
    if (!guildId) {
      console.error("🔸 Provide GUILD_ID as env var or argument");
      return;
    }

    console.log(`🔹 Testing guild: ${guildId}\n`);

    // Check edges
    console.log("📊 Checking relationship edges...");
    const edgesResult = await db.query(
      `SELECT COUNT(*) as count FROM relationship_edges WHERE guild_id = $1`,
      [guildId]
    );
    if (edgesResult.success && edgesResult.data) {
      console.log(`   Total edges: ${edgesResult.data[0].count}`);
    }

    // Check segments
    console.log("\n💬 Checking conversation segments...");
    const segmentsResult = await db.query(
      `SELECT COUNT(*) as count FROM conversation_segments WHERE guild_id = $1`,
      [guildId]
    );
    if (segmentsResult.success && segmentsResult.data) {
      console.log(`   Total segments: ${segmentsResult.data[0].count}`);
    }

    // Check pairs
    console.log("\n🔗 Checking relationship pairs...");
    const pairsResult = await db.query(
      `SELECT COUNT(*) as count FROM relationship_pairs WHERE guild_id = $1`,
      [guildId]
    );
    if (pairsResult.success && pairsResult.data) {
      console.log(`   Total pairs: ${pairsResult.data[0].count}`);
    }

    // Sample recent edges
    console.log("\n📈 Recent edges (last 5):");
    const recentEdges = await db.query(
      `SELECT user_a, user_b, total, last_interaction 
       FROM relationship_edges 
       WHERE guild_id = $1 
       ORDER BY last_interaction DESC 
       LIMIT 5`,
      [guildId]
    );
    if (recentEdges.success && recentEdges.data) {
      recentEdges.data.forEach((edge: any, i: number) => {
        console.log(
          `   ${i + 1}. ${edge.user_a} ↔ ${edge.user_b}: ${edge.total} interactions (${new Date(edge.last_interaction).toLocaleString()})`
        );
      });
    }

    // Sample recent segments
    console.log("\n💭 Recent conversation segments (last 3):");
    const recentSegments = await db.query(
      `SELECT id, participants, message_count, start_time, end_time 
       FROM conversation_segments 
       WHERE guild_id = $1 
       ORDER BY start_time DESC 
       LIMIT 3`,
      [guildId]
    );
    if (recentSegments.success && recentSegments.data) {
      recentSegments.data.forEach((seg: any, i: number) => {
        console.log(
          `   ${i + 1}. ${seg.participants.length} participants, ${seg.message_count} messages (${new Date(seg.start_time).toLocaleString()} - ${new Date(seg.end_time).toLocaleString()})`
        );
        console.log(`      Participants: ${seg.participants.join(", ")}`);
      });
    }

    // Check a specific user's relationships
    if (process.argv[3]) {
      const userId = process.argv[3];
      console.log(`\n👤 Relationships for user ${userId}:`);
      const relManager = new RelationshipNetworkManager(db);
      const edgesForUser = await db.getEdgesForUser(guildId, userId, 10);
      if (edgesForUser.success && edgesForUser.data) {
        edgesForUser.data.forEach((edge: any, i: number) => {
          const other = edge.user_a === userId ? edge.user_b : edge.user_a;
          console.log(
            `   ${i + 1}. ${other}: ${edge.total} total, ${edge.msg_a_to_b || 0} → ${edge.msg_b_to_a || 0} ←`
          );
        });
      }
    }

    console.log("\n✅ Test complete");
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

testRealtimeSync();

