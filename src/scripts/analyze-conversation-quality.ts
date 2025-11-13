#!/usr/bin/env npx tsx

/**
 * Analyzes conversation detection quality by examining:
 * - Conversation coherence (same topic, participants)
 * - Fragmentation issues (split conversations)
 * - Merging accuracy (properly combined segments)
 * - Time gaps and participant overlap
 */

import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { ConversationManager } from "../features/relationship-network/ConversationManager";
import { config } from "../config";

interface ConversationAnalysis {
  segmentId: string;
  channelName: string;
  messageCount: number;
  participantCount: number;
  durationMinutes: number;
  startTime: Date;
  endTime: Date;
  participants: string[];
  avgTimeGap: number;
  maxTimeGap: number;
  hasReplies: boolean;
  hasMentions: boolean;
  topicKeywords: string[];
}

async function analyzeConversation(
  db: PostgreSQLManager,
  segmentId: string
): Promise<ConversationAnalysis | null> {
  // Get segment details
  const segmentResult = await db.query(
    `SELECT
      cs.segment_id,
      cs.channel_id,
      c.name as channel_name,
      cs.message_ids,
      cs.participant_ids,
      cs.start_time,
      cs.end_time,
      cs.message_count,
      cs.participant_count
     FROM conversation_segments cs
     JOIN channels c ON c.id = cs.channel_id
     WHERE cs.segment_id = $1`,
    [segmentId]
  );

  if (!segmentResult.success || !segmentResult.data?.[0]) {
    return null;
  }

  const segment = segmentResult.data[0];

  // Get message details
  const messagesResult = await db.query(
    `SELECT
      m.id,
      m.content,
      m.author_id,
      m.created_at,
      m.reference_message_id,
      u.username
     FROM messages m
     JOIN users u ON u.id = m.author_id
     WHERE m.id = ANY($1::text[])
     ORDER BY m.created_at ASC`,
    [segment.message_ids]
  );

  if (!messagesResult.success || !messagesResult.data) {
    return null;
  }

  const messages = messagesResult.data;

  // Calculate time gaps
  const timeGaps: number[] = [];
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    const gap = (curr.created_at.getTime() - prev.created_at.getTime()) / 1000 / 60; // minutes
    timeGaps.push(gap);
  }

  const avgTimeGap = timeGaps.length > 0
    ? timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length
    : 0;
  const maxTimeGap = timeGaps.length > 0 ? Math.max(...timeGaps) : 0;

  // Check for replies and mentions
  const hasReplies = messages.some(m => m.reference_message_id);
  const hasMentions = messages.some(m => m.content?.includes("<@"));

  // Extract keywords (simple word frequency)
  const words = messages
    .map(m => m.content || "")
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4 && !w.startsWith("http"));

  const wordFreq = new Map<string, number>();
  for (const word of words) {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  }

  const topicKeywords = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  // Get participant usernames
  const participantResult = await db.query(
    `SELECT username FROM users WHERE id = ANY($1::text[])`,
    [segment.participant_ids]
  );

  const participants = participantResult.success && participantResult.data
    ? participantResult.data.map((u: any) => u.username)
    : [];

  const durationMinutes =
    (segment.end_time.getTime() - segment.start_time.getTime()) / 1000 / 60;

  return {
    segmentId: segment.segment_id,
    channelName: segment.channel_name,
    messageCount: segment.message_count,
    participantCount: segment.participant_count,
    durationMinutes,
    startTime: segment.start_time,
    endTime: segment.end_time,
    participants,
    avgTimeGap,
    maxTimeGap,
    hasReplies,
    hasMentions,
    topicKeywords,
  };
}

async function findFragmentation(
  db: PostgreSQLManager,
  channelId: string,
  hoursWindow: number
): Promise<{
  potentialFragments: Array<{
    segments: ConversationAnalysis[];
    reason: string;
    confidence: number;
  }>;
}> {
  // Get all segments in time window
  const segmentsResult = await db.query(
    `SELECT segment_id
     FROM conversation_segments
     WHERE channel_id = $1
       AND start_time > NOW() - INTERVAL '${hoursWindow} hours'
     ORDER BY start_time ASC`,
    [channelId]
  );

  if (!segmentsResult.success || !segmentsResult.data) {
    return { potentialFragments: [] };
  }

  const analyses: ConversationAnalysis[] = [];
  for (const seg of segmentsResult.data) {
    const analysis = await analyzeConversation(db, seg.segment_id);
    if (analysis) {
      analyses.push(analysis);
    }
  }

  // Look for fragmentation patterns
  const potentialFragments: Array<{
    segments: ConversationAnalysis[];
    reason: string;
    confidence: number;
  }> = [];

  for (let i = 0; i < analyses.length - 1; i++) {
    const curr = analyses[i];
    const next = analyses[i + 1];

    // Check if consecutive segments might be fragments
    const timeGapMinutes =
      (next.startTime.getTime() - curr.endTime.getTime()) / 1000 / 60;

    // Calculate participant overlap
    const currParticipants = new Set(curr.participants);
    const nextParticipants = new Set(next.participants);
    const overlap = Array.from(currParticipants).filter(p =>
      nextParticipants.has(p)
    ).length;
    const overlapPercent = overlap / Math.min(currParticipants.size, nextParticipants.size);

    // Calculate topic overlap (keyword similarity)
    const currKeywords = new Set(curr.topicKeywords);
    const nextKeywords = new Set(next.topicKeywords);
    const topicOverlap = Array.from(currKeywords).filter(k =>
      nextKeywords.has(k)
    ).length;
    const topicOverlapPercent = topicOverlap / Math.max(currKeywords.size, nextKeywords.size);

    // Detect fragmentation
    if (timeGapMinutes < 10 && overlapPercent > 0.6) {
      let reason = "";
      let confidence = 0;

      if (timeGapMinutes < 5 && overlapPercent > 0.8) {
        reason = `Very short gap (${timeGapMinutes.toFixed(1)}min) with high participant overlap (${(overlapPercent * 100).toFixed(0)}%)`;
        confidence = 0.9;
      } else if (topicOverlapPercent > 0.4) {
        reason = `Similar topics (${(topicOverlapPercent * 100).toFixed(0)}% keyword overlap) and ${(overlapPercent * 100).toFixed(0)}% participant overlap`;
        confidence = 0.7;
      } else {
        reason = `Moderate gap (${timeGapMinutes.toFixed(1)}min) with ${(overlapPercent * 100).toFixed(0)}% participant overlap`;
        confidence = 0.5;
      }

      if (confidence > 0.5) {
        potentialFragments.push({
          segments: [curr, next],
          reason,
          confidence,
        });
      }
    }
  }

  return { potentialFragments };
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("            CONVERSATION QUALITY ANALYSIS");
  console.log("════════════════════════════════════════════════════════════════\n");

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
  console.log(`📍 Analyzing channel: #${channel.name} (${channel.id})\n`);

  // Analyze recent segments
  const hoursWindow = 24;
  const segmentsResult = await db.query(
    `SELECT segment_id, start_time, end_time, message_count, participant_count
     FROM conversation_segments
     WHERE channel_id = $1
       AND start_time > NOW() - INTERVAL '${hoursWindow} hours'
     ORDER BY start_time DESC
     LIMIT 10`,
    [testChannelId]
  );

  if (!segmentsResult.success || !segmentsResult.data || segmentsResult.data.length === 0) {
    console.log(`⚠️  No conversation segments found in last ${hoursWindow} hours\n`);
    await db.disconnect();
    process.exit(0);
  }

  console.log(`📊 Found ${segmentsResult.data.length} conversation segments\n`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Analyze each segment
  const analyses: ConversationAnalysis[] = [];
  for (let i = 0; i < segmentsResult.data.length; i++) {
    const seg = segmentsResult.data[i];
    const analysis = await analyzeConversation(db, seg.segment_id);

    if (analysis) {
      analyses.push(analysis);

      console.log(`Conversation ${i + 1}:`);
      console.log(`  Channel: #${analysis.channelName}`);
      console.log(`  Messages: ${analysis.messageCount} | Participants: ${analysis.participantCount}`);
      console.log(`  Duration: ${analysis.durationMinutes.toFixed(1)} minutes`);
      console.log(`  Time: ${analysis.startTime.toLocaleString()} → ${analysis.endTime.toLocaleString()}`);
      console.log(`  Avg gap: ${analysis.avgTimeGap.toFixed(1)}min | Max gap: ${analysis.maxTimeGap.toFixed(1)}min`);
      console.log(`  Replies: ${analysis.hasReplies ? "✓" : "✗"} | Mentions: ${analysis.hasMentions ? "✓" : "✗"}`);
      console.log(`  Participants: ${analysis.participants.join(", ")}`);
      console.log(`  Topics: ${analysis.topicKeywords.join(", ")}`);
      console.log();
    }
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Check for fragmentation
  console.log("🔍 FRAGMENTATION ANALYSIS\n");
  const fragmentation = await findFragmentation(db, testChannelId, hoursWindow);

  if (fragmentation.potentialFragments.length === 0) {
    console.log("✅ No significant fragmentation detected!\n");
  } else {
    console.log(`⚠️  Found ${fragmentation.potentialFragments.length} potential fragmentation issues:\n`);

    for (let i = 0; i < fragmentation.potentialFragments.length; i++) {
      const frag = fragmentation.potentialFragments[i];
      console.log(`Fragment ${i + 1} (Confidence: ${(frag.confidence * 100).toFixed(0)}%):`);
      console.log(`  Reason: ${frag.reason}`);
      console.log(`  Segments:`);

      for (const seg of frag.segments) {
        console.log(`    - ${seg.startTime.toLocaleTimeString()}: ${seg.messageCount} msgs, ${seg.participants.join(", ")}`);
      }
      console.log();
    }
  }

  // Summary statistics
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("📈 SUMMARY STATISTICS\n");

  const totalMessages = analyses.reduce((sum, a) => sum + a.messageCount, 0);
  const avgMessages = totalMessages / analyses.length;
  const avgDuration = analyses.reduce((sum, a) => sum + a.durationMinutes, 0) / analyses.length;
  const avgParticipants = analyses.reduce((sum, a) => sum + a.participantCount, 0) / analyses.length;
  const avgTimeGap = analyses.reduce((sum, a) => sum + a.avgTimeGap, 0) / analyses.length;
  const maxTimeGap = Math.max(...analyses.map(a => a.maxTimeGap));
  const withReplies = analyses.filter(a => a.hasReplies).length;
  const withMentions = analyses.filter(a => a.hasMentions).length;

  console.log(`Total conversations analyzed: ${analyses.length}`);
  console.log(`Total messages: ${totalMessages}`);
  console.log(`Average messages per conversation: ${avgMessages.toFixed(1)}`);
  console.log(`Average duration: ${avgDuration.toFixed(1)} minutes`);
  console.log(`Average participants: ${avgParticipants.toFixed(1)}`);
  console.log(`Average time gap: ${avgTimeGap.toFixed(1)} minutes`);
  console.log(`Maximum time gap: ${maxTimeGap.toFixed(1)} minutes`);
  console.log(`Conversations with replies: ${withReplies}/${analyses.length} (${(withReplies/analyses.length*100).toFixed(0)}%)`);
  console.log(`Conversations with mentions: ${withMentions}/${analyses.length} (${(withMentions/analyses.length*100).toFixed(0)}%)`);

  console.log("\n════════════════════════════════════════════════════════════════\n");

  await db.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("❌ Analysis failed:", error);
  process.exit(1);
});
