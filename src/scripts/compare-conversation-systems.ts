#!/usr/bin/env npx tsx

/**
 * Compares old stored conversation segments with new optimized detection
 * Shows improvements in conversation grouping and fragmentation reduction
 */

import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { ConversationManager } from "../features/relationship-network/ConversationManager";
import { config } from "../config";

interface Conversation {
  id: string;
  messageCount: number;
  participantCount: number;
  durationMinutes: number;
  startTime: Date;
  endTime: Date;
  participants: string[];
  messages: Array<{
    content: string;
    author: string;
    timestamp: Date;
  }>;
}

async function getStoredConversations(
  db: PostgreSQLManager,
  channelId: string,
  hoursWindow: number
): Promise<Conversation[]> {
  const result = await db.query(
    `SELECT
      cs.id,
      cs.participants,
      cs.message_ids,
      cs.start_time,
      cs.end_time,
      cs.message_count,
      cs.status
     FROM conversation_segments cs
     WHERE cs.channel_id = $1
       AND cs.start_time > NOW() - INTERVAL '${hoursWindow} hours'
     ORDER BY cs.start_time ASC`,
    [channelId]
  );

  if (!result.success || !result.data) {
    return [];
  }

  const conversations: Conversation[] = [];

  for (const seg of result.data) {
    // Get participant usernames
    const participantResult = await db.query(
      `SELECT username FROM users WHERE id = ANY($1::text[])`,
      [seg.participants]
    );

    const participants = participantResult.success && participantResult.data
      ? participantResult.data.map((u: any) => u.username)
      : [];

    // Get messages
    const messagesResult = await db.query(
      `SELECT m.content, m.created_at, u.username
       FROM messages m
       JOIN users u ON u.id = m.author_id
       WHERE m.id = ANY($1::text[])
       ORDER BY m.created_at ASC`,
      [seg.message_ids]
    );

    const messages = messagesResult.success && messagesResult.data
      ? messagesResult.data.map((m: any) => ({
          content: m.content || "(no content)",
          author: m.username,
          timestamp: m.created_at,
        }))
      : [];

    const durationMinutes =
      (seg.end_time.getTime() - seg.start_time.getTime()) / 1000 / 60;

    conversations.push({
      id: seg.id,
      messageCount: seg.message_count,
      participantCount: participants.length,
      durationMinutes,
      startTime: seg.start_time,
      endTime: seg.end_time,
      participants,
      messages,
    });
  }

  return conversations;
}

function displayConversation(conv: Conversation, index: number) {
  console.log(`\n${index + 1}. [${conv.startTime.toLocaleTimeString()}] ${conv.durationMinutes.toFixed(1)}min`);
  console.log(`   ${conv.messageCount} msgs | ${conv.participantCount} users: ${conv.participants.join(", ")}`);

  // Show first 3 and last 1 message
  const displayMessages = [
    ...conv.messages.slice(0, 3),
    ...(conv.messages.length > 4 ? [{ content: `... (${conv.messages.length - 4} more messages)`, author: "", timestamp: new Date() }] : []),
    ...(conv.messages.length > 3 ? conv.messages.slice(-1) : []),
  ];

  for (const msg of displayMessages) {
    if (msg.author) {
      const preview = msg.content.length > 60 ? msg.content.slice(0, 60) + "..." : msg.content;
      console.log(`   • ${msg.author}: ${preview}`);
    } else {
      console.log(`   ${msg.content}`);
    }
  }
}

function analyzeFragmentation(conversations: Conversation[]): {
  potentialFragments: number;
  avgGapMinutes: number;
  largestGap: number;
} {
  let potentialFragments = 0;
  const gaps: number[] = [];

  for (let i = 0; i < conversations.length - 1; i++) {
    const curr = conversations[i];
    const next = conversations[i + 1];

    const gapMinutes = (next.startTime.getTime() - curr.endTime.getTime()) / 1000 / 60;
    gaps.push(gapMinutes);

    // Check if same participants
    const currSet = new Set(curr.participants);
    const nextSet = new Set(next.participants);
    const overlap = Array.from(currSet).filter(p => nextSet.has(p)).length;
    const overlapPercent = overlap / Math.min(currSet.size, nextSet.size);

    // Potential fragment if < 10min gap and > 50% participant overlap
    if (gapMinutes < 10 && overlapPercent > 0.5) {
      potentialFragments++;
    }
  }

  return {
    potentialFragments,
    avgGapMinutes: gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
    largestGap: gaps.length > 0 ? Math.max(...gaps) : 0,
  };
}

async function main() {
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("          CONVERSATION SYSTEM COMPARISON");
  console.log("══════════════════════════════════════════════════════════════════\n");

  const db = new PostgreSQLManager();
  const connected = await db.connect();

  if (!connected) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  const guildId = config.guildId || process.env.TEST_GUILD_ID;
  if (!guildId) {
    console.error("❌ No GUILD_ID configured");
    process.exit(1);
  }

  const testChannelId = process.env.TEST_CHANNEL_ID || "1254695279311978526";

  // Get channel info
  const channelResult = await db.query(
    `SELECT id, name FROM channels WHERE id = $1`,
    [testChannelId]
  );

  if (!channelResult.success || !channelResult.data?.[0]) {
    console.error("❌ Channel not found");
    process.exit(1);
  }

  const channel = channelResult.data[0];
  console.log(`📍 Channel: #${channel.name}\n`);

  const hoursWindow = 24;

  // Get stored conversations
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 STORED CONVERSATIONS (Database)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const storedConvs = await getStoredConversations(db, testChannelId, hoursWindow);

  if (storedConvs.length === 0) {
    console.log("\n⚠️  No stored conversations found in last 24 hours");
  } else {
    console.log(`\nFound ${storedConvs.length} stored conversation segments:`);
    storedConvs.slice(0, 10).forEach((conv, i) => displayConversation(conv, i));

    if (storedConvs.length > 10) {
      console.log(`\n... and ${storedConvs.length - 10} more conversations`);
    }

    const storedAnalysis = analyzeFragmentation(storedConvs);
    console.log(`\n📊 Fragmentation Analysis:`);
    console.log(`   Potential fragments: ${storedAnalysis.potentialFragments}`);
    console.log(`   Average gap: ${storedAnalysis.avgGapMinutes.toFixed(1)} minutes`);
    console.log(`   Largest gap: ${storedAnalysis.largestGap.toFixed(1)} minutes`);
  }

  // Run optimized detection
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✨ OPTIMIZED DETECTION (New System)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const conversationManager = new ConversationManager(db);
  const startTime = Date.now();

  const optimizedResult = await conversationManager.detectConversationsOptimized(
    testChannelId,
    guildId,
    hoursWindow,
    2
  );

  const duration = Date.now() - startTime;

  if (!optimizedResult.success || !optimizedResult.data) {
    console.error("\n❌ Optimized detection failed:", optimizedResult.error);
  } else {
    const optimizedConvs = optimizedResult.data;

    console.log(`\nDetected ${optimizedConvs.length} conversations in ${duration}ms:`);

    // Convert to same format for display
    const displayConvs: Conversation[] = [];
    for (const conv of optimizedConvs.slice(0, 10)) {
      // Get messages for this conversation
      const messagesResult = await db.query(
        `SELECT m.content, m.created_at, u.username
         FROM messages m
         JOIN users u ON u.id = m.author_id
         WHERE m.id = ANY($1::text[])
         ORDER BY m.created_at ASC`,
        [conv.message_ids]
      );

      const messages = messagesResult.success && messagesResult.data
        ? messagesResult.data.map((m: any) => ({
            content: m.content || "(no content)",
            author: m.username,
            timestamp: m.created_at,
          }))
        : [];

      // Get participant usernames
      const participantResult = await db.query(
        `SELECT username FROM users WHERE id = ANY($1::text[])`,
        [conv.participant_ids]
      );

      const participants = participantResult.success && participantResult.data
        ? participantResult.data.map((u: any) => u.username)
        : [];

      displayConvs.push({
        id: conv.conversation_id || "temp",
        messageCount: conv.message_count,
        participantCount: conv.participant_count,
        durationMinutes: conv.duration_minutes,
        startTime: conv.start_time,
        endTime: conv.end_time,
        participants,
        messages,
      });
    }

    displayConvs.forEach((conv, i) => displayConversation(conv, i));

    if (optimizedConvs.length > 10) {
      console.log(`\n... and ${optimizedConvs.length - 10} more conversations`);
    }

    const optimizedAnalysis = analyzeFragmentation(displayConvs);
    console.log(`\n📊 Fragmentation Analysis:`);
    console.log(`   Potential fragments: ${optimizedAnalysis.potentialFragments}`);
    console.log(`   Average gap: ${optimizedAnalysis.avgGapMinutes.toFixed(1)} minutes`);
    console.log(`   Largest gap: ${optimizedAnalysis.largestGap.toFixed(1)} minutes`);
  }

  // Comparison
  if (storedConvs.length > 0 && optimizedResult.success && optimizedResult.data) {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📈 COMPARISON");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const storedTotal = storedConvs.reduce((sum, c) => sum + c.messageCount, 0);
    const optimizedTotal = optimizedResult.data.reduce((sum: number, c: any) => sum + c.message_count, 0);

    const storedAnalysis = analyzeFragmentation(storedConvs);
    const optimizedDisplayConvs = (await Promise.all(
      optimizedResult.data.slice(0, 10).map(async (conv: any) => {
        const participantResult = await db.query(
          `SELECT username FROM users WHERE id = ANY($1::text[])`,
          [conv.participant_ids]
        );
        const participants = participantResult.success && participantResult.data
          ? participantResult.data.map((u: any) => u.username)
          : [];

        return {
          id: conv.conversation_id || "temp",
          messageCount: conv.message_count,
          participantCount: conv.participant_count,
          durationMinutes: conv.duration_minutes,
          startTime: conv.start_time,
          endTime: conv.end_time,
          participants,
          messages: [],
        };
      })
    ));
    const optimizedAnalysis = analyzeFragmentation(optimizedDisplayConvs);

    console.log(`Stored System:`);
    console.log(`  • Conversations: ${storedConvs.length}`);
    console.log(`  • Total messages: ${storedTotal}`);
    console.log(`  • Avg messages/conv: ${(storedTotal / storedConvs.length).toFixed(1)}`);
    console.log(`  • Potential fragments: ${storedAnalysis.potentialFragments}`);

    console.log(`\nOptimized System:`);
    console.log(`  • Conversations: ${optimizedResult.data.length}`);
    console.log(`  • Total messages: ${optimizedTotal}`);
    console.log(`  • Avg messages/conv: ${(optimizedTotal / optimizedResult.data.length).toFixed(1)}`);
    console.log(`  • Potential fragments: ${optimizedAnalysis.potentialFragments}`);

    const fragmentReduction = storedAnalysis.potentialFragments - optimizedAnalysis.potentialFragments;
    const convReduction = storedConvs.length - optimizedResult.data.length;

    console.log(`\nImprovements:`);
    if (convReduction > 0) {
      console.log(`  ✅ ${convReduction} fewer conversation segments (${((convReduction / storedConvs.length) * 100).toFixed(1)}% reduction)`);
    } else if (convReduction < 0) {
      console.log(`  ℹ️  ${Math.abs(convReduction)} more segments (more granular detection)`);
    }

    if (fragmentReduction > 0) {
      console.log(`  ✅ ${fragmentReduction} fewer potential fragments`);
    } else if (fragmentReduction === 0) {
      console.log(`  ✅ Same fragmentation level (already optimal)`);
    }

    const avgMsgImprovement = (optimizedTotal / optimizedResult.data.length) - (storedTotal / storedConvs.length);
    if (avgMsgImprovement > 0) {
      console.log(`  ✅ ${avgMsgImprovement.toFixed(1)} more messages per conversation on average`);
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════════\n");

  await db.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("❌ Analysis failed:", error);
  process.exit(1);
});
