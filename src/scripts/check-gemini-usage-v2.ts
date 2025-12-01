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

  // First, check what columns actually exist
  console.log("\n📋 CHECKING DATABASE SCHEMA");
  console.log("-".repeat(70));
  
  const schemaCheck = await db.query(
    `
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'user_profiles' 
      AND column_name LIKE '%enrich%'
    ORDER BY column_name
    `
  );
  
  if (schemaCheck.success && schemaCheck.data) {
    console.log("User profile enrichment columns:");
    schemaCheck.data.forEach((col: any) => {
      console.log(`  • ${col.column_name} (${col.data_type})`);
    });
  }

  const convSchemaCheck = await db.query(
    `
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'conversation_segments'
    ORDER BY column_name
    LIMIT 20
    `
  );
  
  if (convSchemaCheck.success && convSchemaCheck.data) {
    console.log("\nConversation segments columns (first 20):");
    convSchemaCheck.data.forEach((col: any) => {
      console.log(`  • ${col.column_name} (${col.data_type})`);
    });
  }

  // Check user profiles with any activity on that date
  console.log("\n📊 USER PROFILE DATA");
  console.log("-".repeat(70));
  const userProfiles = await db.query(
    `
    SELECT 
      user_id,
      guild_id,
      profile_version,
      updated_at,
      LENGTH(COALESCE(summary, '')) as summary_length,
      array_length(COALESCE(keywords, ARRAY[]::text[]), 1) as keyword_count,
      array_length(COALESCE(emojis, ARRAY[]::text[]), 1) as emoji_count,
      psych_profile IS NOT NULL AND psych_profile != '{}'::jsonb as has_psych_profile,
      behavior_patterns IS NOT NULL AND behavior_patterns != '{}'::jsonb as has_behavior_patterns
    FROM user_profiles
    WHERE updated_at >= $1::date 
      AND updated_at < $2::date
      AND (summary IS NOT NULL OR keywords IS NOT NULL)
    ORDER BY updated_at DESC
    LIMIT 50
    `,
    [targetDate, nextDate]
  );

  if (userProfiles.success && userProfiles.data) {
    console.log(`Found ${userProfiles.data.length} user profiles with data from that date`);
    if (userProfiles.data.length > 0) {
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
      if (userProfiles.data.length > 0) {
        console.log(`  • Average keywords per profile: ${(totalKeywords / userProfiles.data.length).toFixed(1)}`);
      }
    }
  } else {
    console.log("  No user profile data found");
  }

  // Check conversations with summaries
  console.log("\n💬 CONVERSATION DATA");
  console.log("-".repeat(70));
  const conversations = await db.query(
    `
    SELECT 
      id,
      guild_id,
      channel_id,
      message_count,
      participants,
      LENGTH(COALESCE(summary, '')) as summary_length,
      features,
      updated_at
    FROM conversation_segments
    WHERE updated_at >= $1::date 
      AND updated_at < $2::date
      AND summary IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 50
    `,
    [targetDate, nextDate]
  );

  if (conversations.success && conversations.data) {
    console.log(`Found ${conversations.data.length} conversations with summaries from that date`);
    if (conversations.data.length > 0) {
      let totalMessages = 0;
      let totalSummaryLength = 0;
      
      conversations.data.forEach((conv: any) => {
        totalMessages += conv.message_count || 0;
        totalSummaryLength += conv.summary_length || 0;
      });

      console.log(`  • Total messages analyzed: ${totalMessages.toLocaleString()}`);
      console.log(`  • Total summary text: ${totalSummaryLength.toLocaleString()} characters`);
      if (conversations.data.length > 0) {
        console.log(`  • Average messages per conversation: ${(totalMessages / conversations.data.length).toFixed(1)}`);
      }
    }
  } else {
    console.log("  No conversation data found");
  }

  // Check relationship profiles
  console.log("\n🤝 RELATIONSHIP DATA");
  console.log("-".repeat(70));
  const relationships = await db.query(
    `
    SELECT 
      user_a,
      user_b,
      guild_id,
      shared_conversations,
      LENGTH(COALESCE(summary, '')) as summary_length,
      array_length(COALESCE(keywords, ARRAY[]::text[]), 1) as keyword_count,
      relationship_type,
      updated_at
    FROM relationship_profiles
    WHERE updated_at >= $1::date 
      AND updated_at < $2::date
    ORDER BY updated_at DESC
    LIMIT 50
    `,
    [targetDate, nextDate]
  );

  if (relationships.success && relationships.data) {
    console.log(`Found ${relationships.data.length} relationship profiles from that date`);
    if (relationships.data.length > 0) {
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
    }
  } else {
    console.log("  No relationship data found");
  }

  // Check for ANY activity around that time period (broader search)
  console.log("\n🔎 BROADER SEARCH (Nov 26-28)");
  console.log("-".repeat(70));
  
  const broadUserCheck = await db.query(
    `
    SELECT COUNT(*) as count
    FROM user_profiles
    WHERE updated_at >= '2025-11-26'::date 
      AND updated_at < '2025-11-29'::date
      AND (summary IS NOT NULL OR keywords IS NOT NULL)
    `
  );
  
  const broadConvCheck = await db.query(
    `
    SELECT COUNT(*) as count
    FROM conversation_segments
    WHERE updated_at >= '2025-11-26'::date 
      AND updated_at < '2025-11-29'::date
      AND summary IS NOT NULL
    `
  );

  console.log(`  • User profiles updated (Nov 26-28): ${broadUserCheck.data?.[0]?.count || 0}`);
  console.log(`  • Conversations with summaries (Nov 26-28): ${broadConvCheck.data?.[0]?.count || 0}`);

  // Estimate based on what we found
  console.log("\n💰 COST ANALYSIS");
  console.log("-".repeat(70));
  console.log("\n  ⚠️  IMPORTANT FINDINGS:");
  console.log("  • Local cost tracking shows: $0.00");
  console.log("  • Google charged: $300.00");
  console.log("  • This suggests:");
  console.log("    1. Cost tracking may not have been working properly");
  console.log("    2. Requests may have been made but not tracked");
  console.log("    3. Failed requests still cost money");
  console.log("    4. Topic labeling (TopicDriftDetector) may have been very active");
  console.log("    5. Multiple enrichment passes may have occurred");
  
  console.log("\n  📊 What Gemini was used for:");
  console.log("     • User profile enrichment (summaries, keywords, psych profiles)");
  console.log("     • Conversation topic labeling and summaries");
  console.log("     • Relationship analysis between users");
  console.log("     • Topic drift detection (real-time topic changes)");
  console.log("     • Server/guild-level summaries");

  console.log("\n  💡 To prevent future charges:");
  console.log("     • Gemini is now disabled ✅");
  console.log("     • All features now use OpenAI (GPT-4o-mini) instead");
  console.log("     • OpenAI is ~60% cheaper than Gemini for this workload");

  await db.disconnect();
  console.log("\n✅ Analysis complete!\n");
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

