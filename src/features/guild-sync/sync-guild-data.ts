import { Client, GatewayIntentBits, GuildMember, ChannelType } from 'discord.js';
import { SurrealDBManager } from '../../database/SurrealDBManager.js';
import { discordGuildToSurreal, discordChannelToSurreal, discordMemberToSurreal } from '../../database/schema.js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const GUILD_ID = process.env.GUILD_ID!;
const DISCORD_TOKEN = process.env.BOT_TOKEN!;

if (!GUILD_ID || !DISCORD_TOKEN) {
  console.error('❌ Missing required environment variables');
  console.error('Required: GUILD_ID, BOT_TOKEN');
  process.exit(1);
}

console.log('🔹 Starting Discord Guild Data Sync...');
console.log('🔹 Target Guild ID:', GUILD_ID);

interface SyncStats {
  guild: boolean;
  channels: { total: number; synced: number; failed: number };
  members: { total: number; synced: number; failed: number };
  roles: { total: number; synced: number; failed: number };
  startTime: Date;
  endTime?: Date;
}

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const stats: SyncStats = {
    guild: false,
    channels: { total: 0, synced: 0, failed: 0 },
    members: { total: 0, synced: 0, failed: 0 },
    roles: { total: 0, synced: 0, failed: 0 },
    startTime: new Date(),
  };

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
    await new Promise(resolve => setTimeout(resolve, 3000));

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      throw new Error(`Guild ${GUILD_ID} not found`);
    }

    console.log('✅ Found guild:', guild.name);
    console.log('🔹 Member count:', guild.memberCount);
    console.log('🔹 Channel count:', guild.channels.cache.size);
    console.log('🔹 Role count:', guild.roles.cache.size);

    // 1. Sync Guild Information
    console.log('\n🔹 Step 1: Syncing guild information...');
    try {
      const guildData = discordGuildToSurreal(guild);
      const result = await db.upsertGuild(guildData);
      if (result.success) {
        console.log('✅ Guild information synced successfully');
        stats.guild = true;
      } else {
        console.log('🔸 Failed to sync guild:', result.error);
      }
    } catch (error) {
      console.log('🔸 Error syncing guild:', error);
    }

    // 2. Sync Roles
    console.log('\n🔹 Step 2: Syncing roles...');
    stats.roles.total = guild.roles.cache.size;
    
    for (const [roleId, role] of guild.roles.cache) {
      try {
        // Skip @everyone role
        if (roleId === guild.id) continue;

        const roleData = {
          id: `roles:${guild.id}:${role.id}`,
          guild_id: guild.id,
          name: role.name,
          color: role.color,
          position: role.position,
          permissions: role.permissions.bitfield.toString(),
          mentionable: role.mentionable,
          hoist: role.hoist,
          created_at: role.createdAt,
          updated_at: new Date(),
          active: true,
        };

        const result = await db.upsertRole(roleData);
        if (result.success) {
          stats.roles.synced++;
          console.log(`   ✅ Synced role: ${role.name}`);
        } else {
          stats.roles.failed++;
          console.log(`   🔸 Failed to sync role ${role.name}:`, result.error);
        }
      } catch (error) {
        stats.roles.failed++;
        console.log(`   🔸 Error syncing role ${role.name}:`, error);
      }
    }

    // 3. Sync Channels
    console.log('\n🔹 Step 3: Syncing channels...');
    const channels = guild.channels.cache.filter(channel => 
      channel.type !== ChannelType.GuildForum && 
      channel.type !== ChannelType.GuildStageVoice
    );
    stats.channels.total = channels.size;

    for (const [channelId, channel] of channels) {
      try {
        const channelData = discordChannelToSurreal(channel, guild.id);
        const result = await db.upsertChannel(channelData);
        if (result.success) {
          stats.channels.synced++;
          console.log(`   ✅ Synced channel: ${channel.name} (${channel.type})`);
        } else {
          stats.channels.failed++;
          console.log(`   🔸 Failed to sync channel ${channel.name}:`, result.error);
        }
      } catch (error) {
        stats.channels.failed++;
        console.log(`   🔸 Error syncing channel ${channel.name}:`, error);
      }
    }

    // 4. Sync Members
    console.log('\n🔹 Step 4: Syncing members...');
    console.log('   🔹 Fetching all members (this may take a while)...');
    
    // Fetch all members
    await guild.members.fetch();
    const members = guild.members.cache;
    stats.members.total = members.size;

    console.log(`   🔹 Found ${members.size} members to sync`);

    let memberCount = 0;
    for (const [memberId, member] of members) {
      memberCount++;
      try {
        // Skip bots
        if (member.user.bot) {
          console.log(`   ⏭️  Skipping bot: ${member.user.username} (${memberCount}/${members.size})`);
          continue;
        }

        const memberData = discordMemberToSurreal(member);
        const result = await db.upsertMember(memberData);
        if (result.success) {
          stats.members.synced++;
          console.log(`   ✅ Synced member: ${member.user.username} (${memberCount}/${members.size})`);
        } else {
          stats.members.failed++;
          console.log(`   🔸 Failed to sync member ${member.user.username}:`, result.error);
        }
      } catch (error) {
        stats.members.failed++;
        console.log(`   🔸 Error syncing member ${member.user.username}:`, error);
      }

      // Small delay to avoid rate limits
      if (memberCount % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Update sync metadata
    console.log('\n🔹 Step 5: Updating sync metadata...');
    try {
      const syncData = {
        id: `sync_metadata:${guild.id}:guild`,
        guild_id: guild.id,
        entity_type: 'guild',
        last_full_sync: new Date(),
        last_check: new Date(),
        entity_count: 1,
        status: 'completed',
        created_at: new Date(),
        updated_at: new Date(),
      };
      await db.upsertSyncMetadata(syncData);
      console.log('✅ Sync metadata updated');
    } catch (error) {
      console.log('🔸 Error updating sync metadata:', error);
    }

    stats.endTime = new Date();
    const duration = stats.endTime.getTime() - stats.startTime.getTime();

    // Final Summary
    console.log('\n🎉 GUILD SYNC COMPLETE!');
    console.log('📊 Summary:');
    console.log(`   ✅ Guild: ${stats.guild ? 'Synced' : 'Failed'}`);
    console.log(`   ✅ Roles: ${stats.roles.synced}/${stats.roles.total} synced (${stats.roles.failed} failed)`);
    console.log(`   ✅ Channels: ${stats.channels.synced}/${stats.channels.total} synced (${stats.channels.failed} failed)`);
    console.log(`   ✅ Members: ${stats.members.synced}/${stats.members.total} synced (${stats.members.failed} failed)`);
    console.log(`   ⏱️  Duration: ${Math.round(duration / 1000)}s`);

    // Check database state
    console.log('\n🔹 Verifying database state...');
    try {
      const guildCount = await db.query('SELECT count() FROM guilds');
      const channelCount = await db.query('SELECT count() FROM channels');
      const memberCount = await db.query('SELECT count() FROM members');
      const roleCount = await db.query('SELECT count() FROM roles');
      
      console.log('📋 Database counts:');
      console.log(`   Guilds: ${guildCount}`);
      console.log(`   Channels: ${channelCount}`);
      console.log(`   Members: ${memberCount}`);
      console.log(`   Roles: ${roleCount}`);
    } catch (error) {
      console.log('🔸 Error checking database state:', error);
    }

  } catch (error) {
    console.error('❌ Sync failed:', error);
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