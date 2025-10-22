import { SurrealDBManager } from '../database/SurrealDBManager.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('🔍 Checking Message Table Format and Structure...');

async function main() {
  try {
    const db = new SurrealDBManager();
    await db.connect();
    console.log('✅ Connected to SurrealDB');

    // Check if messages table exists and get its structure
    console.log('🔹 Checking messages table structure...');
    
    try {
      // Get table info
      const tableInfo = await db.db.query('INFO FOR TABLE messages');
      console.log('📋 Messages table info:', JSON.stringify(tableInfo, null, 2));
    } catch (error) {
      console.log('❌ Messages table does not exist:', error.message);
    }

    // Check message count
    console.log('🔹 Checking message count...');
    try {
      const countResult = await db.db.query('SELECT count() FROM messages');
      console.log('📊 Message count:', JSON.stringify(countResult, null, 2));
    } catch (error) {
      console.log('❌ Could not count messages:', error.message);
    }

    // Get sample messages to check format
    console.log('🔹 Checking message format...');
    try {
      const sampleMessages = await db.db.query('SELECT * FROM messages LIMIT 3');
      console.log('📨 Sample messages:', JSON.stringify(sampleMessages, null, 2));
      
      if (Array.isArray(sampleMessages) && sampleMessages.length > 0) {
        const firstMessage = sampleMessages[0];
        console.log('\n🔍 Message Structure Analysis:');
        console.log('=' .repeat(50));
        
        // Check required fields
        const requiredFields = ['id', 'guild_id', 'channel_id', 'author_id', 'content', 'created_at'];
        const optionalFields = ['updated_at', 'active', 'timestamp', 'attachments', 'embeds'];
        
        console.log('✅ Required fields:');
        requiredFields.forEach(field => {
          const hasField = field in firstMessage;
          const value = firstMessage[field];
          console.log(`   ${hasField ? '✅' : '❌'} ${field}: ${hasField ? (typeof value) : 'MISSING'}`);
        });
        
        console.log('\n📋 Optional fields:');
        optionalFields.forEach(field => {
          const hasField = field in firstMessage;
          const value = firstMessage[field];
          console.log(`   ${hasField ? '✅' : '⚠️ '} ${field}: ${hasField ? (typeof value) : 'NOT SET'}`);
        });
        
        // Check data types
        console.log('\n🔍 Data Type Analysis:');
        console.log(`   ID format: ${firstMessage.id}`);
        console.log(`   Guild ID: ${firstMessage.guild_id}`);
        console.log(`   Channel ID: ${firstMessage.channel_id}`);
        console.log(`   Author ID: ${firstMessage.author_id}`);
        console.log(`   Content length: ${firstMessage.content?.length || 0}`);
        console.log(`   Created at: ${firstMessage.created_at}`);
        console.log(`   Updated at: ${firstMessage.updated_at}`);
        console.log(`   Active: ${firstMessage.active}`);
      }
    } catch (error) {
      console.log('❌ Could not fetch sample messages:', error.message);
    }

    // Check for scattered tables
    console.log('🔹 Checking for scattered message tables...');
    try {
      // Try to find tables that might contain individual messages
      const scatteredPatterns = [
        'messages:1254694808228986912:*',
        'messages:*:*',
        'message:*'
      ];
      
      let scatteredFound = 0;
      for (const pattern of scatteredPatterns) {
        try {
          const result = await db.db.query(`SELECT * FROM ${pattern} LIMIT 1`);
          if (Array.isArray(result) && result.length > 0) {
            scatteredFound += result.length;
            console.log(`⚠️  Found scattered records with pattern: ${pattern}`);
          }
        } catch (error) {
          // Pattern not found, which is good
        }
      }
      
      if (scatteredFound === 0) {
        console.log('✅ No scattered message tables found');
      } else {
        console.log(`⚠️  Found ${scatteredFound} scattered message records`);
      }
    } catch (error) {
      console.log('❌ Error checking for scattered tables:', error.message);
    }

    // Test SurrealDBManager.getMessages()
    console.log('🔹 Testing SurrealDBManager.getMessages()...');
    try {
      const messages = await db.getMessages();
      console.log(`✅ getMessages() returned ${messages.length} messages`);
      
      if (messages.length > 0) {
        const firstMsg = messages[0];
        console.log('📨 First message from getMessages():');
        console.log(`   ID: ${firstMsg.id}`);
        console.log(`   Author: ${firstMsg.author_id}`);
        console.log(`   Channel: ${firstMsg.channel_id}`);
        console.log(`   Content: "${firstMsg.content?.substring(0, 50)}..."`);
        console.log(`   Created: ${firstMsg.created_at}`);
      }
    } catch (error) {
      console.log('❌ getMessages() failed:', error.message);
    }

    // Check database schema compliance
    console.log('🔹 Checking schema compliance...');
    try {
      const schemaCheck = await db.db.query(`
        SELECT 
          count() as total_messages,
          count(DISTINCT author_id) as unique_authors,
          count(DISTINCT channel_id) as unique_channels,
          min(created_at) as oldest_message,
          max(created_at) as newest_message
        FROM messages
      `);
      console.log('📊 Schema compliance check:', JSON.stringify(schemaCheck, null, 2));
    } catch (error) {
      console.log('❌ Schema compliance check failed:', error.message);
    }

  } catch (error) {
    console.error('❌ Table format check failed:', error.message);
  } finally {
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
