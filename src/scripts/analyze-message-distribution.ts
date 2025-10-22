import { SurrealDBManager } from '../database/SurrealDBManager.js';
import dotenv from 'dotenv';

dotenv.config();

const TARGET_USER_ID = '99195129516007424';

console.log('🔍 Deep Analysis: Why Only 19 Messages for Target User?');
console.log('🔹 Target User ID:', TARGET_USER_ID);

async function main() {
  try {
    // Connect to SurrealDB
    console.log('🔹 Connecting to SurrealDB...');
    const db = new SurrealDBManager();
    await db.connect();
    console.log('✅ Connected to SurrealDB');

    // Get all messages from database
    console.log('🔹 Fetching messages from database...');
    const messages = await db.getMessages();
    console.log(`✅ Found ${messages.length} total messages in database`);

    if (messages.length === 0) {
      console.log('❌ No messages found in database');
      return;
    }

    // Analyze target user messages
    const targetUserMessages = messages.filter(msg => msg.author_id === TARGET_USER_ID);
    console.log(`\n🎯 TARGET USER ANALYSIS:`);
    console.log(`   Total messages: ${targetUserMessages.length}`);
    console.log(`   Percentage of all messages: ${((targetUserMessages.length / messages.length) * 100).toFixed(1)}%`);

    // Analyze by channel
    console.log(`\n📊 MESSAGE DISTRIBUTION BY CHANNEL:`);
    const channelStats = {};
    messages.forEach(msg => {
      if (!channelStats[msg.channel_id]) {
        channelStats[msg.channel_id] = { total: 0, targetUser: 0 };
      }
      channelStats[msg.channel_id].total++;
      if (msg.author_id === TARGET_USER_ID) {
        channelStats[msg.channel_id].targetUser++;
      }
    });

    const sortedChannels = Object.entries(channelStats)
      .sort(([,a], [,b]) => b.total - a.total);

    for (const [channelId, stats] of sortedChannels) {
      const percentage = ((stats.targetUser / stats.total) * 100).toFixed(1);
      console.log(`   Channel ${channelId}:`);
      console.log(`     Total messages: ${stats.total}`);
      console.log(`     Target user messages: ${stats.targetUser} (${percentage}%)`);
    }

    // Analyze by date/time
    console.log(`\n📅 TEMPORAL ANALYSIS:`);
    const targetMessagesByDate = {};
    targetUserMessages.forEach(msg => {
      const date = new Date(msg.created_at).toDateString();
      targetMessagesByDate[date] = (targetMessagesByDate[date] || 0) + 1;
    });

    console.log(`   Target user messages by date:`);
    Object.entries(targetMessagesByDate)
      .sort(([a], [b]) => new Date(a) - new Date(b))
      .forEach(([date, count]) => {
        console.log(`     ${date}: ${count} messages`);
      });

    // Check message content patterns
    console.log(`\n📝 CONTENT ANALYSIS:`);
    const targetUserContent = targetUserMessages.map(msg => msg.content);
    const avgLength = targetUserContent.reduce((sum, content) => sum + content.length, 0) / targetUserContent.length;
    console.log(`   Average message length: ${avgLength.toFixed(1)} characters`);
    
    const shortMessages = targetUserContent.filter(content => content.length < 10);
    const longMessages = targetUserContent.filter(content => content.length > 100);
    console.log(`   Short messages (<10 chars): ${shortMessages.length}`);
    console.log(`   Long messages (>100 chars): ${longMessages.length}`);

    // Sample target user messages
    console.log(`\n💬 SAMPLE TARGET USER MESSAGES:`);
    targetUserMessages.slice(0, 5).forEach((msg, i) => {
      console.log(`   ${i + 1}. Channel: ${msg.channel_id}`);
      console.log(`      Content: "${msg.content}"`);
      console.log(`      Date: ${new Date(msg.created_at).toLocaleString()}`);
      console.log('');
    });

    // Analyze all users for comparison
    console.log(`\n👥 ALL USERS COMPARISON:`);
    const userStats = {};
    messages.forEach(msg => {
      if (!userStats[msg.author_id]) {
        userStats[msg.author_id] = { count: 0, channels: new Set() };
      }
      userStats[msg.author_id].count++;
      userStats[msg.author_id].channels.add(msg.channel_id);
    });

    const sortedUsers = Object.entries(userStats)
      .sort(([,a], [,b]) => b.count - a.count);

    for (const [userId, stats] of sortedUsers) {
      const isTarget = userId === TARGET_USER_ID;
      const marker = isTarget ? '🎯' : '  ';
      console.log(`${marker} User ${userId}: ${stats.count} messages, ${stats.channels.size} channels`);
    }

    // Check for potential sync issues
    console.log(`\n🔍 POTENTIAL SYNC ISSUES:`);
    
    // Check if messages are from recent dates only
    const allDates = messages.map(msg => new Date(msg.created_at));
    const oldestMessage = new Date(Math.min(...allDates));
    const newestMessage = new Date(Math.max(...allDates));
    const dateRange = (newestMessage - oldestMessage) / (1000 * 60 * 60 * 24); // days
    
    console.log(`   Date range: ${oldestMessage.toDateString()} to ${newestMessage.toDateString()}`);
    console.log(`   Time span: ${dateRange.toFixed(1)} days`);
    
    if (dateRange < 7) {
      console.log(`   ⚠️  WARNING: Very short time span - sync might be incomplete`);
    }

    // Check for bot messages that might have been filtered
    const botMessages = messages.filter(msg => {
      // Check if content looks like bot messages
      const content = msg.content.toLowerCase();
      return content.includes('bot') || 
             content.includes('!') || 
             content.includes('command') ||
             content.length < 3;
    });
    
    console.log(`   Potential bot messages: ${botMessages.length}`);
    
    // Check message ID patterns
    console.log(`\n🔍 MESSAGE ID ANALYSIS:`);
    const messageIds = messages.map(msg => msg.id);
    const idPatterns = {};
    messageIds.forEach(id => {
      const pattern = String(id).split(':')[0]; // Get the prefix
      idPatterns[pattern] = (idPatterns[pattern] || 0) + 1;
    });
    
    console.log(`   Message ID patterns:`);
    Object.entries(idPatterns).forEach(([pattern, count]) => {
      console.log(`     ${pattern}: ${count} messages`);
    });

  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
