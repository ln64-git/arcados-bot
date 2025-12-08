/**
 * Simple test to debug vector query parameter passing
 */

import { PostgreSQLManager } from "../../../../database/PostgreSQLManager.js";
import { EmbeddingService } from "../EmbeddingService.js";

async function main() {
  console.log("🔍 Testing Vector Query Parameter Passing\n");

  const db = new PostgreSQLManager();
  const connected = await db.connect();

  if (!connected) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  const guildId = process.env.GUILD_ID || "1254694808228986912";

  try {
    // Test 1: Count embeddings
    console.log("📊 Test 1: Counting embeddings...");
    const countResult = await db.query(
      `SELECT COUNT(*) as count FROM conversation_segments WHERE guild_id = $1 AND embedding IS NOT NULL`,
      [guildId]
    );
    console.log(`   Found ${countResult.data?.[0]?.count || 0} embeddings\n`);

    // Test 2: Generate a test embedding
    console.log("🔎 Test 2: Generating test embedding...");
    const embeddingService = EmbeddingService.getInstance();
    const queryEmbedding = await embeddingService.generateEmbedding("converted server");
    console.log(`   Embedding dimensions: ${queryEmbedding.length}`);
    console.log(`   First 5 values: [${queryEmbedding.slice(0, 5).join(", ")}...]`);

    // Test 3: Try different parameter formats
    console.log("\n🧪 Test 3: Testing different parameter formats...\n");

    // Format 1: Raw array (will fail)
    console.log("   Format 1: Raw array");
    try {
      const result1 = await db.query(
        `SELECT id, LEFT(summary, 50) as summary, (embedding <=> $1::vector) as distance
         FROM conversation_segments
         WHERE guild_id = $2 AND embedding IS NOT NULL
         ORDER BY (embedding <=> $1::vector) ASC
         LIMIT 3`,
        [queryEmbedding, guildId]
      );
      console.log(`      ✓ Success: ${result1.data?.length || 0} rows`);
      if (result1.data && result1.data.length > 0) {
        console.log(`      Distance: ${result1.data[0].distance}`);
      }
    } catch (error: any) {
      console.log(`      ✗ Error: ${error.message}`);
    }

    // Format 2: Array (with pgvector package registered)
    console.log("\n   Format 2: Raw array (pgvector registered)");
    try {
      console.log(`      Array length: ${queryEmbedding.length} dimensions`);
      console.log(`      First 5 values: [${queryEmbedding.slice(0, 5).join(", ")}...]`);
      console.log(`      Guild ID param: "${guildId}" (type: ${typeof guildId})`);

      const result2 = await db.query(
        `SELECT id, LEFT(summary, 50) as summary, (embedding <=> $1::vector) as distance
         FROM conversation_segments
         WHERE guild_id = $2 AND embedding IS NOT NULL
         ORDER BY (embedding <=> $1::vector) ASC
         LIMIT 3`,
        [queryEmbedding, guildId]
      );
      console.log(`      ✓ Success: ${result2.data?.length || 0} rows`);
      if (result2.success && result2.data) {
        if (result2.data.length === 0) {
          // Debug: Check if rows exist without vector distance
          const debugResult = await db.query(
            `SELECT id, guild_id, LEFT(summary, 50) as summary
             FROM conversation_segments
             WHERE guild_id = $1 AND embedding IS NOT NULL
             LIMIT 3`,
            [guildId]
          );
          console.log(`      Debug - Rows without distance: ${debugResult.data?.length || 0}`);
          if (debugResult.data && debugResult.data.length > 0) {
            console.log(`      Debug - Sample guild_id from DB: "${debugResult.data[0].guild_id}"`);
            console.log(`      Debug - Param guild_id: "${guildId}"`);
            console.log(`      Debug - Match: ${debugResult.data[0].guild_id === guildId}`);
          }
        } else {
          result2.data.forEach((row: any, i: number) => {
            console.log(`      ${i + 1}. [distance: ${row.distance.toFixed(4)}] ${row.summary}`);
          });
        }
      }
    } catch (error: any) {
      console.log(`      ✗ Error: ${error.message}`);
    }

    // Format 3: JSON.stringify (will fail)
    console.log("\n   Format 3: JSON.stringify");
    try {
      const result3 = await db.query(
        `SELECT id, LEFT(summary, 50) as summary, (embedding <=> $1::vector) as distance
         FROM conversation_segments
         WHERE guild_id = $2 AND embedding IS NOT NULL
         ORDER BY (embedding <=> $1::vector) ASC
         LIMIT 3`,
        [JSON.stringify(queryEmbedding), guildId]
      );
      console.log(`      ✓ Success: ${result3.data?.length || 0} rows`);
      if (result3.data && result3.data.length > 0) {
        console.log(`      Distance: ${result3.data[0].distance}`);
      }
    } catch (error: any) {
      console.log(`      ✗ Error: ${error.message}`);
    }

    console.log("\n🔹 Test complete!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

main();
