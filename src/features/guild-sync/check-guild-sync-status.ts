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

console.log('🔹 Checking Guild Sync Status...');
console.log('🔹 Target Guild ID:', GUILD_ID);

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
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
    console.log('🔹 Discord Guild Stats:');
    console.log(`   Member count: ${guild.memberCount}`);
    console.log(`   Channel count: ${guild.channels.cache.size}`);
    console.log(`   Role count: ${guild.roles.cache.size}`);

    // Check database state
    console.log('\n🔹 Checking SurrealDB state...');
    
    try {
      // Check guilds
      const guildResult = await db.query('SELECT * FROM guilds WHERE id = $guild_id', { guild_id: GUILD_ID });
      console.log('📋 Guild in database:', guildResult.length > 0 ? '✅ Found' : '🔸 Not found');

      // Check roles
      const roleResult = await db.query('SELECT count() FROM roles WHERE guild_id = $guild_id', { guild_id: GUILD_ID });
      console.log(`📋 Roles in database: ${roleResult[0]?.count || 0}`);

      // Check channels
      const channelResult = await db.query('SELECT count() FROM channels WHERE guild_id = $guild_id', { guild_id: GUILD_ID });
      console.log(`📋 Channels in database: ${channelResult[0]?.count || 0}`);

      // Check members
      const memberResult = await db.query('SELECT count() FROM members WHERE guild_id = $guild_id', { guild_id: GUILD_ID });
      console.log(`📋 Members in database: ${memberResult[0]?.count || 0}`);

      // Check sync metadata
      const syncResult = await db.query('SELECT * FROM sync_metadata WHERE guild_id = $guild_id', { guild_id: GUILD_ID });
      if (syncResult.length > 0) {
        console.log('📋 Last sync:', syncResult[0].last_full_sync || 'Never');
        console.log('📋 Sync status:', syncResult[0].status || 'Unknown');
      } else {
        console.log('📋 Sync metadata: 🔸 Not found');
      }

    } catch (error) {
      console.log('🔸 Error checking database state:', error);
    }

    // Compare counts
    console.log('\n🔹 Comparison:');
    console.log(`   Discord Roles: ${guild.roles.cache.size} vs Database: ${roleResult?.[0]?.count || 0}`);
    console.log(`   Discord Channels: ${guild.channels.cache.size} vs Database: ${channelResult?.[0]?.count || 0}`);
    console.log(`   Discord Members: ${guild.memberCount} vs Database: ${memberResult?.[0]?.count || 0}`);

    // Recommendations
    console.log('\n🔹 Recommendations:');
    if (!guildResult || guildResult.length === 0) {
      console.log('   🔸 Run full guild sync: npx tsx sync-guild-data.ts');
    } else {
      console.log('   ✅ Guild data appears to be synced');
    }

  } catch (error) {
    console.error('❌ Check failed:', error);
  } finally {
    await client.destroy();
    console.log('🔹 Discord client disconnected');
    process.exit(0);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🔸 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🔸 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
