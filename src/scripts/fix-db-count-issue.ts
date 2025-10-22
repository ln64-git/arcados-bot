import { SurrealDBManager } from '../database/SurrealDBManager.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('🔧 Fixing Database Structure - Consolidating Individual Records...');

async function main() {
  try {
    const db = new SurrealDBManager();
    await db.connect();
    console.log('✅ Connected to SurrealDB');

    // First, let's see what we're dealing with
    console.log('🔹 Analyzing current structure...');
    
    try {
      const countResult = await db.db.query('SELECT count() FROM messages');
      console.log(`📊 Current count result has ${countResult.length} items`);
      
      if (Array.isArray(countResult) && countResult.length > 0) {
        const firstResult = countResult[0];
        if (Array.isArray(firstResult)) {
          console.log(`📊 Found ${firstResult.length} individual count records`);
          console.log('📊 This confirms messages are stored as individual records');
        }
      }
    } catch (error) {
      console.log('❌ Count analysis failed:', error.message);
    }

    // Get all current messages
    console.log('🔹 Retrieving all current messages...');
    const currentMessages = await db.getMessages();
    console.log(`📊 Found ${currentMessages.length} messages via getMessages()`);

    if (currentMessages.length === 0) {
      console.log('❌ No messages found - database is empty');
      return;
    }

    // Clear the current structure
    console.log('🔹 Clearing current message structure...');
    try {
      await db.db.query('REMOVE TABLE messages');
      console.log('✅ Removed messages table');
    } catch (error) {
      console.log('⚠️  Could not remove messages table:', error.message);
    }

    // Recreate the messages table with proper structure
    console.log('🔹 Creating proper messages table structure...');
    try {
      await db.db.query(`
        DEFINE TABLE messages SCHEMAFULL;
        DEFINE FIELD guild_id ON messages TYPE string;
        DEFINE FIELD channel_id ON messages TYPE string;
        DEFINE FIELD author_id ON messages TYPE string;
        DEFINE FIELD content ON messages TYPE string;
        DEFINE FIELD created_at ON messages TYPE datetime;
        DEFINE FIELD updated_at ON messages TYPE datetime;
        DEFINE FIELD active ON messages TYPE bool DEFAULT true;
        DEFINE FIELD timestamp ON messages TYPE datetime;
        DEFINE FIELD attachments ON messages TYPE array DEFAULT [];
        DEFINE FIELD embeds ON messages TYPE array DEFAULT [];
      `);
      console.log('✅ Created proper messages table structure');
    } catch (error) {
      console.log('❌ Failed to create table structure:', error.message);
    }

    // Re-insert all messages with proper structure
    console.log('🔹 Re-inserting messages with proper structure...');
    let insertedCount = 0;
    
    for (const message of currentMessages) {
      try {
        await db.db.query(`
          INSERT INTO messages (
            guild_id, channel_id, author_id, content, 
            created_at, updated_at, active, timestamp, 
            attachments, embeds
          ) VALUES (
            $guild_id, $channel_id, $author_id, $content,
            $created_at, $updated_at, $active, $timestamp,
            $attachments, $embeds
          )
        `, {
          guild_id: message.guild_id,
          channel_id: message.channel_id,
          author_id: message.author_id,
          content: message.content,
          created_at: message.created_at,
          updated_at: message.updated_at,
          active: message.active,
          timestamp: message.timestamp || message.created_at,
          attachments: message.attachments || [],
          embeds: message.embeds || []
        });
        insertedCount++;
      } catch (error) {
        console.log(`⚠️  Failed to insert message ${message.id}:`, error.message);
      }
    }

    console.log(`✅ Re-inserted ${insertedCount} messages`);

    // Verify the fix
    console.log('🔹 Verifying the fix...');
    try {
      const newCountResult = await db.db.query('SELECT count() FROM messages');
      console.log('📊 New count result:', JSON.stringify(newCountResult, null, 2));
      
      if (Array.isArray(newCountResult) && newCountResult.length === 1) {
        const count = newCountResult[0];
        if (typeof count === 'object' && 'count' in count) {
          console.log(`✅ SUCCESS: Proper count result - ${count.count} messages`);
        } else {
          console.log('📊 Count result:', count);
        }
      } else {
        console.log('⚠️  Count result still has multiple items:', newCountResult.length);
      }
    } catch (error) {
      console.log('❌ Verification failed:', error.message);
    }

    // Test getMessages()
    console.log('🔹 Testing getMessages() after fix...');
    try {
      const messages = await db.getMessages();
      console.log(`✅ getMessages() returned ${messages.length} messages`);
    } catch (error) {
      console.log('❌ getMessages() failed:', error.message);
    }

  } catch (error) {
    console.error('❌ Fix failed:', error.message);
  } finally {
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
