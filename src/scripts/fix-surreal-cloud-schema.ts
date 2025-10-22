import { Surreal } from 'surrealdb';
import dotenv from 'dotenv';

dotenv.config();

console.log('🔧 Fixing SurrealDB Cloud - Creating Proper Table Schema...');

async function main() {
  try {
    // Connect to SurrealDB Cloud
    console.log('🔹 Connecting to SurrealDB Cloud...');
    const db = new Surreal();
    
    const url = process.env.SURREAL_URL || 'wss://your-project.surrealdb.com/rpc';
    const namespace = process.env.SURREAL_NAMESPACE || 'your_namespace';
    const database = process.env.SURREAL_DATABASE || 'your_database';
    
    console.log(`🔹 Connecting to: ${url}`);
    console.log(`🔹 Namespace: ${namespace}`);
    console.log(`🔹 Database: ${database}`);
    
    await db.connect(url);
    console.log('✅ Connected to SurrealDB Cloud');

    // Authenticate
    if (process.env.SURREAL_USERNAME && process.env.SURREAL_PASSWORD) {
      console.log('🔹 Authenticating with username/password...');
      await db.signin({
        username: process.env.SURREAL_USERNAME,
        password: process.env.SURREAL_PASSWORD,
      });
      console.log('✅ Authenticated');
    } else if (process.env.SURREAL_TOKEN) {
      console.log('🔹 Authenticating with token...');
      await db.authenticate(process.env.SURREAL_TOKEN);
      console.log('✅ Authenticated');
    } else {
      console.log('⚠️  No authentication provided');
    }

    // Use namespace and database
    await db.use(namespace, database);
    console.log('✅ Using namespace and database');
    
    // Verify we're in the right namespace/database
    console.log('🔹 Verifying namespace/database context...');
    try {
      const context = await db.query('INFO FOR DB');
      console.log('📋 Database context:', JSON.stringify(context, null, 2));
    } catch (error) {
      console.log('⚠️  Could not verify context:', error.message);
    }

    // Check current state
    console.log('🔹 Checking current database state...');
    try {
      const currentCount = await db.query('SELECT count() FROM messages');
      console.log('📊 Current count result:', JSON.stringify(currentCount, null, 2));
      
      if (Array.isArray(currentCount) && currentCount.length > 0) {
        const firstResult = currentCount[0];
        if (Array.isArray(firstResult)) {
          console.log(`📊 Found ${firstResult.length} individual count records (problematic)`);
        } else {
          console.log('📊 Found proper count result');
        }
      }
    } catch (error) {
      console.log('📊 No messages table exists yet');
    }

    // Remove existing messages table if it exists
    console.log('🔹 Removing existing messages table...');
    try {
      await db.query('REMOVE TABLE messages');
      console.log('✅ Removed existing messages table');
    } catch (error) {
      console.log('⚠️  Could not remove messages table (may not exist):', error.message);
    }

    // Create proper messages table with schema
    console.log('🔹 Creating proper messages table schema...');
    try {
      await db.query(`
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
      console.log('✅ Created proper messages table schema');
    } catch (error) {
      console.log('❌ Failed to create table schema:', error.message);
      return;
    }

    // Verify the table was created
    console.log('🔹 Verifying table creation...');
    try {
      const tableInfo = await db.query('INFO FOR TABLE messages');
      console.log('📋 Table info:', JSON.stringify(tableInfo, null, 2));
    } catch (error) {
      console.log('❌ Could not get table info:', error.message);
    }

    // Test inserting a sample message
    console.log('🔹 Testing message insertion...');
    try {
      const testMessage = {
        guild_id: '1254694808228986912',
        channel_id: 'test_channel',
        author_id: 'test_user',
        content: 'Test message for schema verification',
        created_at: new Date(),
        updated_at: new Date(),
        active: true,
        timestamp: new Date(),
        attachments: [],
        embeds: []
      };

      await db.query(`
        INSERT INTO messages (
          guild_id, channel_id, author_id, content, 
          created_at, updated_at, active, timestamp, 
          attachments, embeds
        ) VALUES (
          $guild_id, $channel_id, $author_id, $content,
          $created_at, $updated_at, $active, $timestamp,
          $attachments, $embeds
        )
      `, testMessage);
      
      console.log('✅ Test message inserted successfully');
      
      // Verify the count is now correct
      const testCount = await db.query('SELECT count() FROM messages');
      console.log('📊 Test count result:', JSON.stringify(testCount, null, 2));
      
      if (Array.isArray(testCount) && testCount.length === 1) {
        const count = testCount[0];
        if (typeof count === 'object' && 'count' in count) {
          console.log(`✅ SUCCESS: Proper count result - ${count.count} messages`);
        }
      }
      
    } catch (error) {
      console.log('❌ Test message insertion failed:', error.message);
    }

    console.log('\n🎉 SurrealDB Cloud is now ready for proper message storage!');
    console.log('🚀 You can now run the Discord sync to populate the properly structured table.');

  } catch (error) {
    console.error('❌ SurrealDB Cloud fix failed:', error.message);
  } finally {
    try {
      await db.close();
    } catch (error) {
      console.log('⚠️  Error closing connection:', error.message);
    }
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
