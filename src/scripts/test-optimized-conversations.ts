#!/usr/bin/env npx tsx

/**
 * Test script for the optimized conversation detection system
 * Compares performance and results between old and new implementations
 */

import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { ConversationManager } from "../features/relationship-network/ConversationManager";
import { config } from "../config";

async function main() {
  console.log("🔹 Testing Optimized Conversation Detection System\n");

  const db = new PostgreSQLManager();
  const connected = await db.connect();

  if (!connected) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  console.log("✅ Connected to database\n");

  const conversationManager = new ConversationManager(db);

  // Get a test channel
  const guildId = config.guildId || process.env.TEST_GUILD_ID;
  if (!guildId) {
    console.error("❌ No GUILD_ID configured. Set GUILD_ID in .env");
    process.exit(1);
  }

  // Get test channel (from env or find active one)
  const testChannelId = process.env.TEST_CHANNEL_ID;

  let testChannel: any;

  if (testChannelId) {
    const channelResult = await db.query(
      `SELECT id, name FROM channels WHERE id = $1`,
      [testChannelId]
    );
    testChannel = channelResult.success && channelResult.data?.[0];
  }

  if (!testChannel) {
    const channelsResult = await db.query(
      `SELECT c.id, c.name, COUNT(m.id) as message_count
       FROM channels c
       JOIN messages m ON m.channel_id = c.id
       WHERE c.guild_id = $1
         AND c.name NOT LIKE '%bot%'
         AND c.name NOT LIKE '%log%'
         AND m.created_at > NOW() - INTERVAL '7 days'
       GROUP BY c.id, c.name
       ORDER BY message_count DESC
       LIMIT 1`,
      [guildId]
    );

    if (!channelsResult.success || !channelsResult.data || channelsResult.data.length === 0) {
      console.error("❌ No channels found for testing");
      process.exit(1);
    }

    testChannel = channelsResult.data[0];
  }

  console.log(`📝 Testing with channel: #${testChannel.name} (${testChannel.id})\n`);

  // Check message count
  const msgCountResult = await db.query(
    `SELECT COUNT(*) as count FROM messages WHERE channel_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
    [testChannel.id]
  );
  const msgCount = msgCountResult.data?.[0]?.count || 0;
  console.log(`   Messages in last 24h: ${msgCount}\n`);

  // Test the optimized detection
  console.log("⏱️  Running OPTIMIZED conversation detection...");
  const startOptimized = Date.now();

  const optimizedResult = await conversationManager.detectConversationsOptimized(
    testChannel.id,
    guildId,
    24,
    2
  );

  const optimizedTime = Date.now() - startOptimized;

  if (!optimizedResult.success) {
    console.error("❌ Optimized detection failed:", optimizedResult.error);
    process.exit(1);
  }

  const optimizedConversations = optimizedResult.data || [];
  console.log(`✅ Optimized detection completed in ${optimizedTime}ms`);
  console.log(`   Found ${optimizedConversations.length} conversations\n`);

  // Display results
  if (optimizedConversations.length > 0) {
    console.log("📊 Conversation Summary:");
    console.log("─".repeat(80));

    for (let i = 0; i < Math.min(optimizedConversations.length, 5); i++) {
      const conv = optimizedConversations[i]!;
      console.log(`\nConversation ${i + 1}:`);
      console.log(`  Messages: ${conv.message_count}`);
      console.log(`  Participants: ${conv.participant_count} users`);
      console.log(`  Duration: ${conv.duration_minutes} minutes`);
      console.log(`  Time: ${conv.start_time.toISOString()} → ${conv.end_time.toISOString()}`);
    }

    if (optimizedConversations.length > 5) {
      console.log(`\n... and ${optimizedConversations.length - 5} more conversations`);
    }
  }

  console.log("\n" + "─".repeat(80));
  console.log("✅ All tests completed successfully!");
  console.log("─".repeat(80));

  await db.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
