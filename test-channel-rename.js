#!/usr/bin/env node

/**
 * Channel Rename Performance Test
 * Specifically tests channel.setName() performance and alternatives
 */

import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './src/config/index.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// Test configuration
const TEST_CONFIG = {
    GUILD_ID: process.env.TEST_GUILD_ID || 'your-guild-id',
    CHANNEL_ID: process.env.TEST_CHANNEL_ID || 'your-channel-id',
};

// Test different approaches to channel renaming
async function testChannelRenameApproaches(channel) {
    console.log('🔍 Testing different channel rename approaches...\n');
    
    const testName = `Test ${Date.now()}`;
    const originalName = channel.name;
    
    // Approach 1: Direct channel.setName()
    console.log('📝 Approach 1: Direct channel.setName()');
    try {
        const start = Date.now();
        await Promise.race([
            channel.setName(testName),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 30000)
            )
        ]);
        const duration = Date.now() - start;
        console.log(`✅ Success in ${duration}ms`);
        
        // Restore original name
        await channel.setName(originalName);
    } catch (error) {
        console.log(`❌ Failed: ${error.message}`);
    }
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Approach 2: Using REST API directly
    console.log('\n📝 Approach 2: Direct REST API call');
    try {
        const start = Date.now();
        await Promise.race([
            client.rest.patch(`/channels/${channel.id}`, {
                body: { name: testName }
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 30000)
            )
        ]);
        const duration = Date.now() - start;
        console.log(`✅ Success in ${duration}ms`);
        
        // Restore original name
        await client.rest.patch(`/channels/${channel.id}`, {
            body: { name: originalName }
        });
    } catch (error) {
        console.log(`❌ Failed: ${error.message}`);
    }
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Approach 3: Check channel permissions first
    console.log('\n📝 Approach 3: Check permissions first');
    try {
        const start = Date.now();
        
        // Check if bot has permission to manage channels
        const botMember = await channel.guild.members.fetch(client.user.id);
        const permissions = botMember.permissionsIn(channel);
        
        if (!permissions.has('ManageChannels')) {
            throw new Error('Bot lacks ManageChannels permission');
        }
        
        await Promise.race([
            channel.setName(testName),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 30000)
            )
        ]);
        const duration = Date.now() - start;
        console.log(`✅ Success in ${duration}ms`);
        
        // Restore original name
        await channel.setName(originalName);
    } catch (error) {
        console.log(`❌ Failed: ${error.message}`);
    }
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Approach 4: Test with different channel types
    console.log('\n📝 Approach 4: Test channel type and properties');
    try {
        const start = Date.now();
        
        console.log(`Channel type: ${channel.type}`);
        console.log(`Channel position: ${channel.position}`);
        console.log(`Channel parent: ${channel.parent?.name || 'None'}`);
        console.log(`Channel permissions: ${channel.permissionOverwrites.cache.size} overwrites`);
        
        await Promise.race([
            channel.setName(testName),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), 30000)
            )
        ]);
        const duration = Date.now() - start;
        console.log(`✅ Success in ${duration}ms`);
        
        // Restore original name
        await channel.setName(originalName);
    } catch (error) {
        console.log(`❌ Failed: ${error.message}`);
    }
}

// Test network connectivity and Discord API status
async function testNetworkAndAPI() {
    console.log('🌐 Testing network connectivity and Discord API...\n');
    
    // Test basic connectivity
    try {
        const start = Date.now();
        const response = await fetch('https://discord.com/api/v10/gateway');
        const duration = Date.now() - start;
        console.log(`✅ Discord API reachable in ${duration}ms (Status: ${response.status})`);
    } catch (error) {
        console.log(`❌ Discord API unreachable: ${error.message}`);
    }
    
    // Test bot's connection status
    console.log(`\n🤖 Bot connection status:`);
    console.log(`- Ready: ${client.isReady()}`);
    console.log(`- Uptime: ${client.uptime}ms`);
    console.log(`- Ping: ${client.ws.ping}ms`);
    console.log(`- Guilds: ${client.guilds.cache.size}`);
}

// Main test function
async function runChannelRenameTests() {
    console.log('🚀 Starting Channel Rename Performance Tests...\n');
    
    try {
        // Login to Discord
        console.log('🔹 Logging into Discord...');
        await client.login(config.botToken);
        console.log('✅ Logged in successfully\n');
        
        // Wait for ready
        await new Promise(resolve => client.once('ready', resolve));
        console.log('✅ Bot is ready\n');
        
        // Test network and API
        await testNetworkAndAPI();
        
        // Get test channel
        const guild = client.guilds.cache.get(TEST_CONFIG.GUILD_ID);
        if (!guild) {
            throw new Error(`Guild ${TEST_CONFIG.GUILD_ID} not found`);
        }
        
        const channel = guild.channels.cache.get(TEST_CONFIG.CHANNEL_ID);
        if (!channel) {
            throw new Error(`Channel ${TEST_CONFIG.CHANNEL_ID} not found`);
        }
        
        console.log(`\n✅ Found guild: ${guild.name}`);
        console.log(`✅ Found channel: ${channel.name} (${channel.type})\n`);
        
        // Run channel rename tests
        await testChannelRenameApproaches(channel);
        
        console.log('\n✅ Channel rename tests completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        client.destroy();
        process.exit(0);
    }
}

// Run tests
runChannelRenameTests().catch(console.error);
