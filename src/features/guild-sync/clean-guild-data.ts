import { Client, GatewayIntentBits } from 'discord.js';
import { SurrealDBManager } from '../../database/SurrealDBManager.js';
import dotenv from 'dotenv';

dotenv.config();

const GUILD_ID = process.env.GUILD_ID!;
const DISCORD_TOKEN = process.env.BOT_TOKEN!;

if (!GUILD_ID || !DISCORD_TOKEN) {
  console.error('❌ Missing required environment variables');
  console.error('Required: GUILD_ID, BOT_TOKEN');
  process.exit(1);
}

console.log('🔹 Cleaning Guild Data from SurrealDB...');
console.log('🔹 Target Guild ID:', GUILD_ID);

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
    ],
  });

  try {
    // Connect to Discord
    console.log('🔹 Connecting to Discord...');
    await client.login(DISCORD_TOKEN);
    console.log('✅ Connected to Discord');

    // Connect to SurrealDB
    console.log('🔹 Connecting to SurrealDB Cloud...');
    const db = new SurrealDBManager();
    const connected = await db.connect();
    if (!connected) {
      throw new Error('Failed to connect to SurrealDB');
    }
    console.log('✅ Connected to SurrealDB Cloud');

    // Wait for Discord client to initialize
    console.log('🔹 Waiting for Discord client to initialize...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      throw new Error(`Guild ${GUILD_ID} not found`);
    }

    console.log('✅ Found guild:', guild.name);
    console.log('⚠️  WARNING: This will delete ALL data for this guild from SurrealDB!');
    console.log('⚠️  This includes: guild info, roles, channels, members, messages, and sync metadata');
    
    // Confirmation prompt
    console.log('\n🔸 Are you sure you want to continue? (This action cannot be undone)');
    console.log('🔸 Press Ctrl+C to cancel, or wait 10 seconds to continue...');
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    console.log('🔸 Proceeding with cleanup...');

    // Delete guild data
    console.log('\n🔹 Deleting guild data...');
    
    try {
      // Delete messages
      console.log('   🔹 Deleting messages...');
      const messageResult = await db.query('DELETE FROM messages WHERE guild_id = $guild_id', { guild_id: GUILD_ID });
      console.log(`   ✅ Deleted ${messageResult.length} messages`);

      // Delete members
      console.log('   🔹 Deleting members...');
      const memberResult = await db.query('DELETE FROM members WHERE guild_id = $guild_id', { guild_id: GUILD_ID });
      console.log(`   ✅ Deleted ${memberResult.length} members`);

      // Delete channels
      console.log('   🔹 Deleting channels...');
      const channelResult = await db.query('DELETE FROM channels WHERE guild_id = $guild_id', { guild_id: GUILD_ID });
      console.log(`   ✅ Deleted ${channelResult.length} channels`);

      // Delete roles
      console.log('   🔹 Deleting roles...');
      const roleResult = await db.query('DELETE FROM roles WHERE guild_id = $guild_id', { guild_id: GUILD_ID });
      console.log(`   ✅ Deleted ${roleResult.length} roles`);

      // Delete sync metadata
      console.log('   🔹 Deleting sync metadata...');
      const syncResult = await db.query('DELETE FROM sync_metadata WHERE guild_id = $guild_id', { guild_id: GUILD_ID });
      console.log(`   ✅ Deleted ${syncResult.length} sync metadata records`);

      // Delete guild
      console.log('   🔹 Deleting guild...');
      const guildResult = await db.query('DELETE FROM guilds WHERE id = $guild_id', { guild_id: GUILD_ID });
      console.log(`   ✅ Deleted ${guildResult.length} guild records`);

      console.log('\n🎉 Guild data cleanup complete!');
      console.log('📊 Summary:');
      console.log(`   ✅ Messages deleted: ${messageResult.length}`);
      console.log(`   ✅ Members deleted: ${memberResult.length}`);
      console.log(`   ✅ Channels deleted: ${channelResult.length}`);
      console.log(`   ✅ Roles deleted: ${roleResult.length}`);
      console.log(`   ✅ Sync metadata deleted: ${syncResult.length}`);
      console.log(`   ✅ Guild records deleted: ${guildResult.length}`);

    } catch (error) {
      console.log('🔸 Error during cleanup:', error);
    }

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  } finally {
    await client.destroy();
    console.log('🔹 Discord client disconnected');
    process.exit(0);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🔸 Received SIGINT, cancelling cleanup...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🔸 Received SIGTERM, cancelling cleanup...');
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
