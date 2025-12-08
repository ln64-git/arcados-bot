/**
 * Test script for semantic conversation search
 *
 * Tests the new RAG implementation with vector embeddings
 */

import { pgvector, PostgreSQLManager } from "../../../../database/PostgreSQLManager.js";
import { config } from "../../../../config/index.js";
import { EmbeddingService } from "../EmbeddingService.js";

async function main() {
  console.log("🔍 Testing Semantic Conversation Search\n");

  // Connect to database
  const db = new PostgreSQLManager();
  const connected = await db.connect();

  if (!connected) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  console.log("🔹 Connected to PostgreSQL\n");

  // Get guild ID from environment
  const guildId = process.env.GUILD_ID || "1254694808228986912";

  try {
    // Test 1: Check if conversations have embeddings
    console.log("📊 Test 1: Checking conversation embeddings...");
    const embeddingsCheck = await db.query(
      `SELECT
        COUNT(*) as total_conversations,
        COUNT(embedding) as conversations_with_embeddings,
        COUNT(summary) as conversations_with_summaries
      FROM conversation_segments
      WHERE guild_id = $1 AND status = 'finalized'`,
      [guildId]
    );

    if (embeddingsCheck.success && embeddingsCheck.data?.[0]) {
      const stats = embeddingsCheck.data[0];
      console.log(`   Total conversations: ${stats.total_conversations}`);
      console.log(`   With summaries: ${stats.conversations_with_summaries}`);
      console.log(`   With embeddings: ${stats.conversations_with_embeddings}`);

      const embeddingPercent =
        (stats.conversations_with_embeddings / stats.total_conversations) *
        100;
      console.log(
        `   Coverage: ${embeddingPercent.toFixed(1)}%\n`
      );
    }

    // Test 2: Perform semantic search
    console.log("🔎 Test 2: Semantic conversation search...");
    const testQueries = [
      "converted server",
      "politics discussion",
      "sexual jokes",
    ];

    for (const query of testQueries) {
      console.log(`\n   Query: "${query}"`);

      // Generate embedding
      const embeddingService = EmbeddingService.getInstance();
      const queryEmbedding = await embeddingService.generateEmbedding(query);

      // Search conversations
      // Convert to pgvector format using toSql()
      const queryVec = pgvector.toSql(queryEmbedding);
      console.log(`   Query vector format: ${queryVec.substring(0, 50)}... (length: ${queryVec.length})`);

      const result = await db.query(
        `SELECT
          id,
          summary,
          participants,
          message_count,
          start_time,
          (embedding <=> $1::vector) as distance
        FROM conversation_segments
        WHERE guild_id = $2
          AND embedding IS NOT NULL
        ORDER BY (embedding <=> $1::vector) ASC
        LIMIT 3`,
        [queryVec, guildId]
      );

      console.log(`   SQL result: ${result.success ? 'success' : 'failed'}${result.error ? ` - ${result.error}` : ''}`);
      console.log(`   Rows returned: ${result.data?.length || 0}`);
      if (result.data && result.data.length === 0) {
        // Try a simpler query without the vector operation
        const simpleTest = await db.query(
          `SELECT COUNT(*) as count FROM conversation_segments WHERE guild_id = $1 AND embedding IS NOT NULL`,
          [guildId]
        );
        console.log(`   Debug - Conversations with embeddings: ${simpleTest.data?.[0]?.count || 0}`);
      }

      if (result.success && result.data && result.data.length > 0) {
        console.log(`   Found ${result.data.length} results:`);
        result.data.forEach((conv: any, idx: number) => {
          const similarity = (1 - conv.distance).toFixed(3);
          const summary =
            conv.summary?.substring(0, 80) || "(no summary)";
          console.log(
            `     ${idx + 1}. [similarity: ${similarity}] ${summary}`
          );
        });
      } else {
        console.log("   No results found");
      }
    }

    // Test 3: Check index usage
    console.log("\n\n📈 Test 3: Checking vector index...");
    const indexCheck = await db.query(
      `SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE indexname = 'conversation_segments_embedding_idx'`
    );

    if (indexCheck.success && indexCheck.data && indexCheck.data.length > 0) {
      console.log("   🔹 Vector index exists:");
      console.log(`   ${indexCheck.data[0].indexdef}\n`);
    } else {
      console.log("   ⚠️  Vector index not found\n");
    }

    console.log("\n🔹 All tests complete!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

main();
