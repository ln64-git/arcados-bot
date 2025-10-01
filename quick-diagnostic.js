#!/usr/bin/env node

/**
 * Quick Discord API Diagnostic
 * Tests basic Discord API performance without requiring specific channel IDs
 */

import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './src/config/index.ts';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

async function runQuickDiagnostic() {
    console.log('🔍 Quick Discord API Diagnostic');
    console.log('================================\n');
    
    try {
        // Login to Discord
        console.log('🔹 Logging into Discord...');
        await client.login(config.botToken);
        console.log('✅ Logged in successfully\n');
        
        // Wait for ready
        await new Promise(resolve => client.once('ready', resolve));
        console.log('✅ Bot is ready\n');
        
        // Basic connection info
        console.log('📊 Connection Information:');
        console.log(`  - Bot: ${client.user.tag}`);
        console.log(`  - Ping: ${client.ws.ping}ms`);
        console.log(`  - Uptime: ${client.uptime}ms`);
        console.log(`  - Guilds: ${client.guilds.cache.size}`);
        console.log(`  - Channels: ${client.channels.cache.size}`);
        console.log('');
        
        // Test basic API calls
        console.log('🔍 Testing basic API calls...');
        
        // Test 1: Fetch guilds
        const guildStart = Date.now();
        await client.guilds.fetch();
        const guildDuration = Date.now() - guildStart;
        console.log(`✅ Guild fetch: ${guildDuration}ms`);
        
        // Test 2: Test network connectivity
        const networkStart = Date.now();
        try {
            const response = await fetch('https://discord.com/api/v10/gateway');
            const networkDuration = Date.now() - networkStart;
            console.log(`✅ Discord API reachable: ${networkDuration}ms (Status: ${response.status})`);
        } catch (error) {
            console.log(`❌ Discord API unreachable: ${error.message}`);
        }
        
        // Test 3: Find voice channels
        console.log('\n🔍 Available voice channels:');
        const voiceChannels = client.channels.cache.filter(channel => channel.isVoiceBased());
        
        if (voiceChannels.size === 0) {
            console.log('❌ No voice channels found');
        } else {
            voiceChannels.forEach(channel => {
                console.log(`  - ${channel.name} (${channel.id}) in ${channel.guild.name}`);
            });
        }
        
        // Test 4: Check bot permissions in voice channels
        if (voiceChannels.size > 0) {
            console.log('\n🔍 Bot permissions in voice channels:');
            for (const [channelId, channel] of voiceChannels) {
                try {
                    const botMember = await channel.guild.members.fetch(client.user.id);
                    const permissions = botMember.permissionsIn(channel);
                    
                    console.log(`  - ${channel.name}:`);
                    console.log(`    - Manage Channels: ${permissions.has('ManageChannels')}`);
                    console.log(`    - Manage Roles: ${permissions.has('ManageRoles')}`);
                    console.log(`    - Administrator: ${permissions.has('Administrator')}`);
                } catch (error) {
                    console.log(`  - ${channel.name}: Error checking permissions - ${error.message}`);
                }
            }
        }
        
        console.log('\n✅ Quick diagnostic completed!');
        console.log('\n📋 Next steps:');
        console.log('  1. If ping is >500ms, you may have network issues');
        console.log('  2. If Discord API is unreachable, check your internet connection');
        console.log('  3. If no voice channels found, the bot may not be in any servers');
        console.log('  4. If bot lacks ManageChannels permission, that explains the rename issues');
        
    } catch (error) {
        console.error('❌ Diagnostic failed:', error);
    } finally {
        client.destroy();
        process.exit(0);
    }
}

// Run diagnostic
runQuickDiagnostic().catch(console.error);
