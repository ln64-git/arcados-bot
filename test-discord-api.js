#!/usr/bin/env node

/**
 * Discord API Performance Test
 * Tests various Discord API calls to identify performance bottlenecks
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
    TEST_ITERATIONS: 5,
    TIMEOUT_MS: 60000, // 1 minute timeout
};

// Performance tracking
const performanceResults = {
    channelSetName: [],
    channelFetch: [],
    guildFetch: [],
    memberFetch: [],
};

// Utility functions
function measureTime(fn) {
    return async (...args) => {
        const start = Date.now();
        try {
            const result = await Promise.race([
                fn(...args),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Operation timeout')), TEST_CONFIG.TIMEOUT_MS)
                )
            ]);
            const duration = Date.now() - start;
            return { result, duration, success: true };
        } catch (error) {
            const duration = Date.now() - start;
            return { error, duration, success: false };
        }
    };
}

// Test functions
async function testChannelSetName(channel, testName) {
    console.log(`🔹 Testing channel.setName() with name: "${testName}"`);
    
    const measuredSetName = measureTime(channel.setName.bind(channel));
    const { result, duration, success, error } = await measuredSetName(testName);
    
    if (success) {
        console.log(`✅ channel.setName() succeeded in ${duration}ms`);
        performanceResults.channelSetName.push(duration);
    } else {
        console.log(`❌ channel.setName() failed after ${duration}ms: ${error.message}`);
    }
    
    return { success, duration, error };
}

async function testChannelFetch(channelId) {
    console.log(`🔹 Testing channel.fetch()`);
    
    const measuredFetch = measureTime(client.channels.fetch.bind(client.channels));
    const { result, duration, success, error } = await measuredFetch(channelId);
    
    if (success) {
        console.log(`✅ channel.fetch() succeeded in ${duration}ms`);
        performanceResults.channelFetch.push(duration);
    } else {
        console.log(`❌ channel.fetch() failed after ${duration}ms: ${error.message}`);
    }
    
    return { success, duration, error };
}

async function testGuildFetch(guildId) {
    console.log(`🔹 Testing guild.fetch()`);
    
    const measuredFetch = measureTime(client.guilds.fetch.bind(client.guilds));
    const { result, duration, success, error } = await measuredFetch(guildId);
    
    if (success) {
        console.log(`✅ guild.fetch() succeeded in ${duration}ms`);
        performanceResults.guildFetch.push(duration);
    } else {
        console.log(`❌ guild.fetch() failed after ${duration}ms: ${error.message}`);
    }
    
    return { success, duration, error };
}

async function testMemberFetch(guild, userId) {
    console.log(`🔹 Testing guild.members.fetch()`);
    
    const measuredFetch = measureTime(guild.members.fetch.bind(guild.members));
    const { result, duration, success, error } = await measuredFetch(userId);
    
    if (success) {
        console.log(`✅ guild.members.fetch() succeeded in ${duration}ms`);
        performanceResults.memberFetch.push(duration);
    } else {
        console.log(`❌ guild.members.fetch() failed after ${duration}ms: ${error.message}`);
    }
    
    return { success, duration, error };
}

// Main test function
async function runPerformanceTests() {
    console.log('🚀 Starting Discord API Performance Tests...\n');
    
    try {
        // Login to Discord
        console.log('🔹 Logging into Discord...');
        await client.login(config.botToken);
        console.log('✅ Logged in successfully\n');
        
        // Wait for ready
        await new Promise(resolve => client.once('ready', resolve));
        console.log('✅ Bot is ready\n');
        
        // Get test objects
        const guild = client.guilds.cache.get(TEST_CONFIG.GUILD_ID);
        if (!guild) {
            throw new Error(`Guild ${TEST_CONFIG.GUILD_ID} not found`);
        }
        
        const channel = guild.channels.cache.get(TEST_CONFIG.CHANNEL_ID);
        if (!channel) {
            throw new Error(`Channel ${TEST_CONFIG.CHANNEL_ID} not found`);
        }
        
        console.log(`✅ Found guild: ${guild.name}`);
        console.log(`✅ Found channel: ${channel.name}\n`);
        
        // Run basic API tests
        console.log('📊 Running basic API performance tests...\n');
        
        await testChannelFetch(TEST_CONFIG.CHANNEL_ID);
        await testGuildFetch(TEST_CONFIG.GUILD_ID);
        await testMemberFetch(guild, client.user.id);
        
        console.log('\n📊 Running channel.setName() performance tests...\n');
        
        // Test channel.setName() multiple times
        for (let i = 1; i <= TEST_CONFIG.TEST_ITERATIONS; i++) {
            const testName = `Test Channel ${i} - ${Date.now()}`;
            console.log(`\n--- Test ${i}/${TEST_CONFIG.TEST_ITERATIONS} ---`);
            
            const result = await testChannelSetName(channel, testName);
            
            if (!result.success) {
                console.log(`❌ Test ${i} failed: ${result.error.message}`);
                break;
            }
            
            // Wait between tests to avoid rate limiting
            if (i < TEST_CONFIG.TEST_ITERATIONS) {
                console.log('⏳ Waiting 5 seconds before next test...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        
        // Print results
        console.log('\n📈 Performance Test Results:');
        console.log('================================');
        
        if (performanceResults.channelSetName.length > 0) {
            const avgTime = performanceResults.channelSetName.reduce((a, b) => a + b, 0) / performanceResults.channelSetName.length;
            const minTime = Math.min(...performanceResults.channelSetName);
            const maxTime = Math.max(...performanceResults.channelSetName);
            
            console.log(`channel.setName():`);
            console.log(`  - Successful calls: ${performanceResults.channelSetName.length}`);
            console.log(`  - Average time: ${avgTime.toFixed(2)}ms`);
            console.log(`  - Min time: ${minTime}ms`);
            console.log(`  - Max time: ${maxTime}ms`);
            console.log(`  - All times: [${performanceResults.channelSetName.join(', ')}]ms`);
        } else {
            console.log(`channel.setName(): No successful calls`);
        }
        
        if (performanceResults.channelFetch.length > 0) {
            const avgTime = performanceResults.channelFetch.reduce((a, b) => a + b, 0) / performanceResults.channelFetch.length;
            console.log(`channel.fetch(): Average ${avgTime.toFixed(2)}ms`);
        }
        
        if (performanceResults.guildFetch.length > 0) {
            const avgTime = performanceResults.guildFetch.reduce((a, b) => a + b, 0) / performanceResults.guildFetch.length;
            console.log(`guild.fetch(): Average ${avgTime.toFixed(2)}ms`);
        }
        
        if (performanceResults.memberFetch.length > 0) {
            const avgTime = performanceResults.memberFetch.reduce((a, b) => a + b, 0) / performanceResults.memberFetch.length;
            console.log(`guild.members.fetch(): Average ${avgTime.toFixed(2)}ms`);
        }
        
        console.log('\n✅ Performance tests completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        client.destroy();
        process.exit(0);
    }
}

// Run tests
runPerformanceTests().catch(console.error);
