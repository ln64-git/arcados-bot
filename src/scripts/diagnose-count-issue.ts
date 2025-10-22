import { SurrealDBManager } from '../database/SurrealDBManager.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('🔍 Diagnosing Database Structure Issue...');

async function main() {
  try {
    const db = new SurrealDBManager();
    await db.connect();
    console.log('✅ Connected to SurrealDB');

    // Check what's actually happening with the count query
    console.log('🔹 Checking count query behavior...');
    
    try {
      const countResult = await db.db.query('SELECT count() FROM messages');
      console.log('📊 Count result:', JSON.stringify(countResult, null, 2));
      
      if (Array.isArray(countResult) && countResult.length > 0) {
        console.log(`📊 Count result length: ${countResult.length}`);
        
        // Check if we're getting individual counts
        const firstResult = countResult[0];
        if (Array.isArray(firstResult)) {
          console.log(`📊 First result is array with ${firstResult.length} items`);
          console.log('📊 Sample count items:', firstResult.slice(0, 5));
        } else {
          console.log('📊 First result:', firstResult);
        }
      }
    } catch (error) {
      console.log('❌ Count query failed:', error.message);
    }

    // Try different count approaches
    console.log('🔹 Trying alternative count queries...');
    
    const countQueries = [
      'SELECT count() FROM messages GROUP BY ALL',
      'SELECT count() FROM messages GROUP BY author_id',
      'SELECT count() FROM messages GROUP BY channel_id',
      'SELECT count() FROM messages GROUP BY guild_id'
    ];

    for (const query of countQueries) {
      try {
        const result = await db.db.query(query);
        console.log(`📊 Query "${query}":`, JSON.stringify(result, null, 2));
      } catch (error) {
        console.log(`❌ Query "${query}" failed:`, error.message);
      }
    }

    // Check the actual table structure
    console.log('🔹 Checking table structure...');
    try {
      const tableInfo = await db.db.query('INFO FOR TABLE messages');
      console.log('📋 Table info:', JSON.stringify(tableInfo, null, 2));
    } catch (error) {
      console.log('❌ Table info failed:', error.message);
    }

    // Check if messages are stored as individual records
    console.log('🔹 Checking for individual message records...');
    try {
      // Try to get a few messages directly
      const directMessages = await db.db.query('SELECT * FROM messages LIMIT 3');
      console.log('📨 Direct messages query:', JSON.stringify(directMessages, null, 2));
      
      if (Array.isArray(directMessages) && directMessages.length > 0) {
        const firstMessage = directMessages[0];
        if (Array.isArray(firstMessage)) {
          console.log('📊 Messages are stored as individual records in array');
          console.log(`📊 Found ${firstMessage.length} individual message records`);
        } else {
          console.log('📊 Messages are stored as proper table records');
        }
      }
    } catch (error) {
      console.log('❌ Direct messages query failed:', error.message);
    }

    // Check SurrealDBManager behavior
    console.log('🔹 Testing SurrealDBManager.getMessages()...');
    try {
      const messages = await db.getMessages();
      console.log(`📊 getMessages() returned ${messages.length} messages`);
      
      if (messages.length > 0) {
        console.log('📨 Sample message structure:');
        console.log('   ID:', messages[0].id);
        console.log('   Author:', messages[0].author_id);
        console.log('   Channel:', messages[0].channel_id);
        console.log('   Content:', messages[0].content?.substring(0, 50));
      }
    } catch (error) {
      console.log('❌ getMessages() failed:', error.message);
    }

    // Check if we need to consolidate individual records
    console.log('🔹 Checking for consolidation needs...');
    try {
      // Try to find the pattern of individual records
      const individualPattern = await db.db.query('SELECT * FROM messages:* LIMIT 5');
      console.log('📊 Individual pattern query:', JSON.stringify(individualPattern, null, 2));
    } catch (error) {
      console.log('❌ Individual pattern query failed:', error.message);
    }

  } catch (error) {
    console.error('❌ Diagnosis failed:', error.message);
  } finally {
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
