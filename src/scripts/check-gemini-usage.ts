#!/usr/bin/env bun
/**
 * Check what data was generated using Gemini on Nov 27th
 * This shows what you actually got for your $300
 */

import { PostgreSQLManager } from "../database/PostgreSQLManager.js";

const db = new PostgreSQLManager();

async function main() {
  await db.connect();

  const targetDate = "2025-11-27";
  const nextDate = "2025-11-28";

  console.log("\n🔍 Checking Gemini-generated data from November 27th, 2025\n");
  console.log("=" .repeat(70));

  // 1. Check user profile enrichments
  console.log("\n📊 USER PROFILE ENRICHMENTS");
  console.log("-".repeat(70));
  const userProfiles = await db.query(
    `
    SELECT 
      user_id,
      guild_id,
      profile_version,
      last_enriched_at,
      last_enriched_conversation_count,
      LENGTH(summary) as summary_length,
      array_length(keywords, 1) as keyword_count,
      array_length(emojis, 1) as emoji_count,
      psych_profile IS NOT NULL as has_psych_profile,
      behavior_patterns IS NOT NULL as has_behavior_patterns
    FROM user_profiles
    WHERE last_enriched_at >= $1::date 
      AND last_enriched_at < $2::date
    ORDER BY last_enriched_at DESC
    `,
    [targetDate, nextDate]
  );

  if (userProfiles.success && userProfiles.data) {
    console.log(`Found ${userProfiles.data.length} enriched user profiles`);
    let totalKeywords = 0;
    let totalSummaryLength = 0;
    let profilesWithPsych = 0;
    
    userProfiles.data.forEach((profile: any) => {
      totalKeywords += profile.keyword_count || 0;
      totalSummaryLength += profile.summary_length || 0;
      if (profile.has_psych_profile) profilesWithPsych++;
    });

    console.log(`  • Total keywords extracted: ${totalKeywords}`);
    console.log(`  • Total summary text: ${totalSummaryLength.toLocaleString()} characters`);
    console.log(`  • Profiles with psychological data: ${profilesWithPsych}`);
    console.log(`  • Average keywords per profile: ${(totalKeywords / userProfiles.data.length).toFixed(1)}`);
  } else {
    console.log("  No user profile enrichments found");
  }

  // 2. Check conversation enrichments
  console.log("\n💬 CONVERSATION ENRICHMENTS");
  console.log("-".repeat(70));
  const conversations = await db.query(
    `
    SELECT 
      id,
      guild_id,
      channel_id,
      message_count,
      participants,
      LENGTH(summary) as summary_length,
      features->>'keywords' as keywords_json,
      enrichment_version,
      last_enriched_at,
      enrichment_confidence
    FROM conversation_segments
    WHERE last_enriched_at >= $1::date 
      AND last_enriched_at < $2::date
      AND summary IS NOT NULL
    ORDER BY last_enriched_at DESC
    `,
    [targetDate, nextDate]
  );

  if (conversations.success && conversations.data) {
    console.log(`Found ${conversations.data.length} enriched conversations`);
    let totalMessages = 0;
    let totalSummaryLength = 0;
    
    conversations.data.forEach((conv: any) => {
      totalMessages += conv.message_count || 0;
      totalSummaryLength += conv.summary_length || 0;
    });

    console.log(`  • Total messages analyzed: ${totalMessages.toLocaleString()}`);
    console.log(`  • Total summary text: ${totalSummaryLength.toLocaleString()} characters`);
    console.log(`  • Average messages per conversation: ${(totalMessages / conversations.data.length).toFixed(1)}`);
  } else {
    console.log("  No conversation enrichments found");
  }

  // 3. Check relationship enrichments
  console.log("\n🤝 RELATIONSHIP ENRICHMENTS");
  console.log("-".repeat(70));
  const relationships = await db.query(
    `
    SELECT 
      user_a,
      user_b,
      guild_id,
      shared_conversations,
      LENGTH(summary) as summary_length,
      array_length(keywords, 1) as keyword_count,
      relationship_type,
      last_enriched_at,
      enrichment_confidence
    FROM relationship_profiles
    WHERE last_enriched_at >= $1::date 
      AND last_enriched_at < $2::date
    ORDER BY last_enriched_at DESC
    `,
    [targetDate, nextDate]
  );

  if (relationships.success && relationships.data) {
    console.log(`Found ${relationships.data.length} enriched relationships`);
    let totalShared = 0;
    let totalKeywords = 0;
    let totalSummaryLength = 0;
    
    relationships.data.forEach((rel: any) => {
      totalShared += rel.shared_conversations || 0;
      totalKeywords += rel.keyword_count || 0;
      totalSummaryLength += rel.summary_length || 0;
    });

    console.log(`  • Total shared conversations analyzed: ${totalShared.toLocaleString()}`);
    console.log(`  • Total keywords extracted: ${totalKeywords}`);
    console.log(`  • Total summary text: ${totalSummaryLength.toLocaleString()} characters`);
  } else {
    console.log("  No relationship enrichments found");
  }

  // 4. Check server enrichments (if any)
  console.log("\n🏰 SERVER/GUILD ENRICHMENTS");
  console.log("-".repeat(70));
  const servers = await db.query(
    `
    SELECT 
      guild_id,
      LENGTH(summary) as summary_length,
      array_length(keywords, 1) as keyword_count,
      last_enriched_at
    FROM guild_profiles
    WHERE last_enriched_at >= $1::date 
      AND last_enriched_at < $2::date
    ORDER BY last_enriched_at DESC
    `,
    [targetDate, nextDate]
  );

  if (servers.success && servers.data) {
    console.log(`Found ${servers.data.length} enriched servers`);
    let totalKeywords = 0;
    let totalSummaryLength = 0;
    
    servers.data.forEach((server: any) => {
      totalKeywords += server.keyword_count || 0;
      totalSummaryLength += server.summary_length || 0;
    });

    console.log(`  • Total keywords extracted: ${totalKeywords}`);
    console.log(`  • Total summary text: ${totalSummaryLength.toLocaleString()} characters`);
  } else {
    console.log("  No server enrichments found (table may not exist)");
  }

  // 5. Estimate token usage based on data
  console.log("\n💰 COST BREAKDOWN ESTIMATE");
  console.log("-".repeat(70));
  
  const allSummaries = [
    ...(userProfiles.data || []).map((p: any) => p.summary_length || 0),
    ...(conversations.data || []).map((c: any) => c.summary_length || 0),
    ...(relationships.data || []).map((r: any) => r.summary_length || 0),
    ...(servers.data || []).map((s: any) => s.summary_length || 0),
  ];

  const totalChars = allSummaries.reduce((sum, len) => sum + len, 0);
  
  // Rough estimate: 1 token ≈ 4 characters
  const estimatedTokens = Math.round(totalChars / 4);
  
  // Gemini pricing: $0.00025 per 1K input, $0.001 per 1K output
  // Assume 70% input, 30% output (typical for enrichment tasks)
  const inputTokens = Math.round(estimatedTokens * 0.7);
  const outputTokens = Math.round(estimatedTokens * 0.3);
  
  const inputCost = (inputTokens / 1000) * 0.00025;
  const outputCost = (outputTokens / 1000) * 0.001;
  const estimatedTotalCost = inputCost + outputCost;

  console.log(`  • Estimated total characters processed: ${totalChars.toLocaleString()}`);
  console.log(`  • Estimated tokens: ${estimatedTokens.toLocaleString()}`);
  console.log(`    - Input tokens: ${inputTokens.toLocaleString()} (estimated)`);
  console.log(`    - Output tokens: ${outputTokens.toLocaleString()} (estimated)`);
  console.log(`  • Estimated cost: $${estimatedTotalCost.toFixed(2)}`);
  console.log(`  • Actual charge: $300.00`);
  console.log(`  • Difference: $${(300 - estimatedTotalCost).toFixed(2)}`);
  console.log(`\n  ⚠️  Note: This is a rough estimate. Actual usage may include:`);
  console.log(`     - Topic labeling (TopicDriftDetector)`);
  console.log(`     - Multiple enrichment passes`);
  console.log(`     - Failed requests that still cost money`);
  console.log(`     - Tool calling overhead`);

  // 6. Check for any enrichment activity at all
  console.log("\n📈 OVERALL STATISTICS");
  console.log("-".repeat(70));
  
  const totalEnrichments = 
    (userProfiles.data?.length || 0) +
    (conversations.data?.length || 0) +
    (relationships.data?.length || 0) +
    (servers.data?.length || 0);

  console.log(`  • Total enrichment operations: ${totalEnrichments}`);
  console.log(`  • User profiles: ${userProfiles.data?.length || 0}`);
  console.log(`  • Conversations: ${conversations.data?.length || 0}`);
  console.log(`  • Relationships: ${relationships.data?.length || 0}`);
  console.log(`  • Servers: ${servers.data?.length || 0}`);

  await db.disconnect();
  console.log("\n✅ Analysis complete!\n");
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

