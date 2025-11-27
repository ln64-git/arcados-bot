/**
 * Quick check for a specific message ID in the database
 */

import { PostgreSQLManager } from "../PostgreSQLManager";
import { config } from "../../config";

const MESSAGE_ID = "1443628188629602525";

const db = new PostgreSQLManager();

async function main() {
  console.log(`🔍 Checking message ID: ${MESSAGE_ID}\n`);
  console.log("=".repeat(80));

  // Connect to database
  const connected = await db.connect();
  if (!connected) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  // Check database
  console.log("\n📊 DATABASE CHECK");
  console.log("─".repeat(80));
  const dbResult = await db.query(
    `
    SELECT 
      id, 
      guild_id, 
      channel_id, 
      author_id, 
      content, 
      created_at,
      edited_at,
      active,
      embedding IS NOT NULL as has_embedding,
      referenced_message_id
    FROM messages 
    WHERE id = $1
    `,
    [MESSAGE_ID]
  );

  if (dbResult.success && dbResult.data && dbResult.data.length > 0) {
    const msg = dbResult.data[0];
    console.log("✅ Message EXISTS in database");
    console.log(`   ID: ${msg.id}`);
    console.log(`   Guild: ${msg.guild_id}`);
    console.log(`   Channel: ${msg.channel_id}`);
    console.log(`   Author: ${msg.author_id}`);
    console.log(`   Created: ${msg.created_at}`);
    if (msg.edited_at) {
      console.log(`   Edited: ${msg.edited_at}`);
    }
    console.log(`   Active: ${msg.active ? 'Yes' : 'No'}`);
    console.log(`   Has Embedding: ${msg.has_embedding ? '✅' : '❌'}`);
    if (msg.referenced_message_id) {
      console.log(`   Referenced Message: ${msg.referenced_message_id}`);
    }
    console.log(`   Content: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
  } else {
    console.log("❌ Message NOT FOUND in database");
    console.log("\n⚠️  SYNC ISSUE: This message was not synced to the database!");
    console.log("   This suggests a problem with the Discord sync logic.");
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Check complete\n");

  await db.disconnect();
}

main().catch(console.error);

