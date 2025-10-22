import { SurrealDBManager } from '../database/SurrealDBManager.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('🔍 Checking Database Status...');

async function main() {
  try {
    const db = new SurrealDBManager();
    await db.connect();
    console.log('✅ Connected to SurrealDB');

    const messages = await db.getMessages();
    console.log(`📊 Total messages in database: ${messages.length}`);

    if (messages.length === 0) {
      console.log('🗑️  Database is empty - ready for fresh sync');
    } else {
      console.log('📨 Database still has messages:');
      console.log(`   - Total: ${messages.length}`);
      
      const users = [...new Set(messages.map(m => m.author_id))];
      console.log(`   - Unique users: ${users.length}`);
      
      const channels = [...new Set(messages.map(m => m.channel_id))];
      console.log(`   - Channels: ${channels.length}`);
      
      const dates = messages.map(m => new Date(m.created_at));
      const oldest = new Date(Math.min(...dates));
      const newest = new Date(Math.max(...dates));
      console.log(`   - Date range: ${oldest.toDateString()} to ${newest.toDateString()}`);
    }

  } catch (error) {
    console.error('❌ Database check failed:', error.message);
  } finally {
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
