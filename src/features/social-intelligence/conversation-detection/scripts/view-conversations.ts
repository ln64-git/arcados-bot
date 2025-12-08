#!/usr/bin/env bun
/**
 * View Conversations Script
 *
 * Displays all messages from the past 24 hours grouped by conversation,
 * showing how the conversation detection algorithm clusters messages.
 */

import { PostgreSQLManager } from "../../../../database/PostgreSQLManager";
import { config } from "../../../../config/index.js";

interface Message {
  id: string;
  content: string;
  author_id: string;
  username: string;
  channel_name: string;
  created_at: Date;
  conversation_id: string | null;
  is_streaming: boolean;
}

interface Conversation {
  id: string;
  type: "streaming" | "finalized";
  channel_name: string;
  participant_count: number;
  message_count: number;
  start_time: Date;
  end_time: Date;
  duration_minutes: number;
  keywords: any[];
  summary: string | null;
  status: string;
}

const db = new PostgreSQLManager();

async function main() {
  console.log("🔍 Viewing conversations from the past 24 hours\n");
  console.log("=".repeat(80));

  const connected = await db.connect();
  if (!connected) {
    console.error("❌ Failed to connect to database");
    console.error("💡 Make sure POSTGRES_URL is set in your .env file");
    process.exit(1);
  }

  const guildId = config.guildId;
  if (!guildId) {
    console.error("❌ No guild ID configured");
    console.error("💡 Set GUILD_ID in your .env file");
    await db.disconnect();
    process.exit(1);
  }

  // Get all messages from past 24 hours with conversation mappings
  const messagesResult = await db.query(
    `
    WITH message_conversations AS (
      -- Match messages to streaming conversations
      SELECT 
        m.id,
        sc.id as conversation_id,
        true as is_streaming
      FROM messages m
      JOIN streaming_conversations sc ON sc.guild_id = m.guild_id
      WHERE m.id = ANY(sc.message_ids)
        AND m.guild_id = $1
        AND m.created_at > NOW() - INTERVAL '24 hours'
      
      UNION ALL
      
      -- Match messages to finalized conversations
      SELECT 
        m.id,
        cs.id as conversation_id,
        false as is_streaming
      FROM messages m
      JOIN conversation_segments cs ON cs.guild_id = m.guild_id
      WHERE m.id = ANY(cs.message_ids)
        AND m.guild_id = $1
        AND m.created_at > NOW() - INTERVAL '24 hours'
    )
    SELECT 
      m.id,
      m.content,
      m.author_id,
      COALESCE(mem.username, m.author_id) as username,
      COALESCE(c.name, m.channel_id) as channel_name,
      m.created_at,
      mc.conversation_id,
      COALESCE(mc.is_streaming, false) as is_streaming
    FROM messages m
    LEFT JOIN message_conversations mc ON m.id = mc.id
    LEFT JOIN channels c ON m.channel_id = c.id
    LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
    WHERE m.guild_id = $1
      AND m.created_at > NOW() - INTERVAL '24 hours'
      AND m.active = true
      AND COALESCE(mem.bot, false) = false
      AND COALESCE(c.name, '') NOT IN ('vc-logs', 'mod-logs', 'server-logs', 'audit-logs')
    ORDER BY m.created_at ASC
    `,
    [guildId]
  );

  // Get all conversations from past 24 hours
  const conversationsResult = await db.query(
    `
    -- Streaming conversations
    SELECT 
      sc.id,
      'streaming' as type,
      COALESCE(c.name, sc.channel_id) as channel_name,
      array_length(sc.participants, 1) as participant_count,
      sc.message_count,
      sc.start_time,
      sc.last_activity as end_time,
      EXTRACT(EPOCH FROM (sc.last_activity - sc.start_time))/60 as duration_minutes,
      COALESCE(sc.preliminary_keywords, '[]'::jsonb) as keywords,
      NULL::text as summary,
      sc.status
    FROM streaming_conversations sc
    LEFT JOIN channels c ON sc.channel_id = c.id
    WHERE sc.guild_id = $1
      AND sc.start_time > NOW() - INTERVAL '24 hours'
    
    UNION ALL
    
    -- Finalized conversations
    SELECT 
      cs.id,
      'finalized' as type,
      COALESCE(c.name, cs.channel_id) as channel_name,
      array_length(cs.participants, 1) as participant_count,
      cs.message_count,
      cs.start_time,
      cs.end_time,
      EXTRACT(EPOCH FROM (cs.end_time - cs.start_time))/60 as duration_minutes,
      COALESCE(
        (cs.features->'keywords')::jsonb,
        '[]'::jsonb
      ) as keywords,
      cs.summary,
      cs.status
    FROM conversation_segments cs
    LEFT JOIN channels c ON cs.channel_id = c.id
    WHERE cs.guild_id = $1
      AND cs.start_time > NOW() - INTERVAL '24 hours'
    
    ORDER BY start_time ASC
    `,
    [guildId]
  );

  if (!messagesResult.success || !conversationsResult.success) {
    console.error("❌ Failed to fetch data");
    await db.disconnect();
    process.exit(1);
  }

  const messages: Message[] = messagesResult.data || [];
  const conversations: Conversation[] = conversationsResult.data || [];

  // Create conversation number mapping
  const convIdToNumber = new Map<string, number>();
  conversations.forEach((conv, idx) => {
    convIdToNumber.set(conv.id, idx + 1);
  });

  console.log(`\n📊 SUMMARY`);
  console.log("=".repeat(80));
  console.log(`Total Messages: ${messages.length}`);
  console.log(`Total Conversations: ${conversations.length}`);
  console.log(
    `  - Streaming (active): ${
      conversations.filter((c) => c.type === "streaming").length
    }`
  );
  console.log(
    `  - Finalized: ${
      conversations.filter((c) => c.type === "finalized").length
    }`
  );
  console.log(
    `Unmapped Messages: ${messages.filter((m) => !m.conversation_id).length}`
  );

  // Print all messages grouped by conversation
  console.log(`\n\n📝 MESSAGE LOG (Past 24 Hours)`);
  console.log("=".repeat(80));
  console.log(
    `Format: [ConvNum] - HH:MM:SS @username (#channel): message content\n`
  );

  for (const msg of messages) {
    const convNum = msg.conversation_id
      ? convIdToNumber.get(msg.conversation_id)
      : null;
    const convLabel = convNum ? `${convNum}`.padStart(2) : "-";
    const streamingFlag = msg.is_streaming ? "🔴" : "";
    const time = msg.created_at.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    // Truncate long messages
    const content =
      msg.content.length > 100
        ? msg.content.substring(0, 97) + "..."
        : msg.content;

    console.log(
      `[${convLabel}]${streamingFlag} - ${time} @${msg.username.padEnd(15)} (#${
        msg.channel_name
      }): ${content}`
    );
  }

  // Print conversation details
  console.log(`\n\n💬 CONVERSATION DETAILS`);
  console.log("=".repeat(80));

  if (conversations.length === 0) {
    console.log("No conversations detected in the past 24 hours");
  } else {
    for (const conv of conversations) {
      const convNum = convIdToNumber.get(conv.id);
      const typeLabel =
        conv.type === "streaming" ? "🔴 STREAMING" : "🔹 FINALIZED";
      const duration = Math.round(conv.duration_minutes);

      console.log(`\n[${convNum}] ${typeLabel} - #${conv.channel_name}`);
      console.log(`${"─".repeat(80)}`);
      console.log(`  Messages: ${conv.message_count}`);
      console.log(`  Participants: ${conv.participant_count}`);
      console.log(`  Duration: ${duration} minutes`);
      console.log(
        `  Started: ${conv.start_time.toLocaleString("en-US", {
          hour12: false,
        })}`
      );
      console.log(
        `  Ended: ${conv.end_time.toLocaleString("en-US", { hour12: false })}`
      );
      console.log(`  Status: ${conv.status}`);

      // Keywords
      if (conv.keywords && Array.isArray(conv.keywords)) {
        const keywordList = conv.keywords
          .slice(0, 10)
          .map((k: any) => {
            const score = k.score ? ` (${(k.score * 100).toFixed(0)}%)` : "";
            return `${k.word}${score}`;
          })
          .join(", ");

        if (keywordList) {
          console.log(`  Keywords: ${keywordList}`);
        } else {
          console.log(`  Keywords: (none extracted yet)`);
        }
      } else {
        console.log(`  Keywords: (none extracted yet)`);
      }

      // Summary
      if (conv.summary) {
        console.log(`  Summary: ${conv.summary}`);
      } else {
        console.log(`  Summary: (not generated yet)`);
      }
    }
  }

  // Statistics breakdown
  console.log(`\n\n📈 ANALYSIS STATISTICS`);
  console.log("=".repeat(80));

  const withKeywords = conversations.filter(
    (c) => c.keywords && Array.isArray(c.keywords) && c.keywords.length > 0
  ).length;
  const withSummaries = conversations.filter((c) => c.summary).length;

  console.log(
    `Conversations with Keywords: ${withKeywords}/${conversations.length}`
  );
  console.log(
    `Conversations with Summaries: ${withSummaries}/${conversations.length}`
  );

  // Channel breakdown
  const byChannel = new Map<string, number>();
  for (const conv of conversations) {
    byChannel.set(
      conv.channel_name,
      (byChannel.get(conv.channel_name) || 0) + 1
    );
  }

  if (byChannel.size > 0) {
    console.log(`\nConversations by Channel:`);
    const sorted = Array.from(byChannel.entries()).sort((a, b) => b[1] - a[1]);
    for (const [channel, count] of sorted) {
      console.log(`  #${channel}: ${count}`);
    }
  }

  // Duration analysis
  const durations = conversations
    .map((c) => Number(c.duration_minutes))
    .filter((d) => !isNaN(d) && isFinite(d));
  if (durations.length > 0) {
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);

    console.log(`\nConversation Duration:`);
    console.log(`  Average: ${Math.round(avgDuration)} minutes`);
    console.log(`  Shortest: ${Math.round(minDuration)} minutes`);
    console.log(`  Longest: ${Math.round(maxDuration)} minutes`);
  }

  // Message size analysis
  const messageSizes = conversations.map((c) => c.message_count);
  if (messageSizes.length > 0) {
    const avgSize =
      messageSizes.reduce((a, b) => a + b, 0) / messageSizes.length;
    const maxSize = Math.max(...messageSizes);
    const minSize = Math.min(...messageSizes);

    console.log(`\nMessages per Conversation:`);
    console.log(`  Average: ${Math.round(avgSize)} messages`);
    console.log(`  Smallest: ${minSize} messages`);
    console.log(`  Largest: ${maxSize} messages`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("🔹 Analysis complete\n");

  await db.disconnect();
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
