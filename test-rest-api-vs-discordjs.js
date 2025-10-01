#!/usr/bin/env node

/**
 * REST API vs discord.js Performance Test
 * Compares channel.setName() vs REST API performance
 */

import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './src/config/index.ts';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

async function compareRenameMethods() {
    console.log('🔍 REST API vs discord.js Performance Comparison');
    console.log('================================================\n');
    
    try {
        // Login to Discord
        console.log('🔹 Logging into Discord...');
        await client.login(config.botToken);
        console.log('✅ Logged in successfully\n');
        
        // Wait for ready
        await new Promise(resolve => client.once('ready', resolve));
        console.log('✅ Bot is ready\n');
        
        // Find any voice channel for testing
        const voiceChannels = client.channels.cache.filter(channel => channel.isVoiceBased());
        
        if (voiceChannels.size === 0) {
            throw new Error('No voice channels found for testing');
        }
        
        const channel = voiceChannels.first();
        
        console.log(`🎯 Testing with channel: ${channel.name} (${channel.id})\n`);
        
        const originalName = channel.name;
        const testResults = {
            discordjs: [],
            restApi: []
        };
        
        // Test discord.js method
        console.log('📝 Testing discord.js channel.setName() method...');
        for (let i = 1; i <= 3; i++) {
            const testName = `DiscordJS-Test-${i}-${Date.now()}`;
            console.log(`  Test ${i}: Setting name to "${testName}"`);
            
            try {
                const start = Date.now();
                await Promise.race([
                    channel.setName(testName),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), 20000)
                    )
                ]);
                const duration = Date.now() - start;
                testResults.discordjs.push(duration);
                console.log(`    ✅ Success in ${duration}ms`);
            } catch (error) {
                console.log(`    ❌ Failed: ${error.message}`);
                testResults.discordjs.push(null);
            }
            
            // Wait between tests
            if (i < 3) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Restore original name
        console.log('  Restoring original name...');
        try {
            await channel.setName(originalName);
            console.log('  ✅ Original name restored');
        } catch (error) {
            console.log(`  ❌ Failed to restore: ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Test REST API method
        console.log('\n📝 Testing REST API method...');
        for (let i = 1; i <= 3; i++) {
            const testName = `REST-Test-${i}-${Date.now()}`;
            console.log(`  Test ${i}: Setting name to "${testName}"`);
            
            try {
                const start = Date.now();
                await Promise.race([
                    client.rest.patch(`/channels/${channel.id}`, {
                        body: { name: testName }
                    }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), 20000)
                    )
                ]);
                const duration = Date.now() - start;
                testResults.restApi.push(duration);
                console.log(`    ✅ Success in ${duration}ms`);
            } catch (error) {
                console.log(`    ❌ Failed: ${error.message}`);
                testResults.restApi.push(null);
            }
            
            // Wait between tests
            if (i < 3) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Restore original name
        console.log('  Restoring original name...');
        try {
            await client.rest.patch(`/channels/${channel.id}`, {
                body: { name: originalName }
            });
            console.log('  ✅ Original name restored');
        } catch (error) {
            console.log(`  ❌ Failed to restore: ${error.message}`);
        }
        
        // Print comparison results
        console.log('\n📊 Performance Comparison Results:');
        console.log('==================================');
        
        const discordjsResults = testResults.discordjs.filter(r => r !== null);
        const restApiResults = testResults.restApi.filter(r => r !== null);
        
        if (discordjsResults.length > 0) {
            const avgDiscordJS = discordjsResults.reduce((a, b) => a + b, 0) / discordjsResults.length;
            const minDiscordJS = Math.min(...discordjsResults);
            const maxDiscordJS = Math.max(...discordjsResults);
            
            console.log(`discord.js channel.setName():`);
            console.log(`  - Successful calls: ${discordjsResults.length}/3`);
            console.log(`  - Average time: ${avgDiscordJS.toFixed(2)}ms`);
            console.log(`  - Min time: ${minDiscordJS}ms`);
            console.log(`  - Max time: ${maxDiscordJS}ms`);
            console.log(`  - All times: [${discordjsResults.join(', ')}]ms`);
        } else {
            console.log(`discord.js channel.setName(): No successful calls`);
        }
        
        if (restApiResults.length > 0) {
            const avgRestAPI = restApiResults.reduce((a, b) => a + b, 0) / restApiResults.length;
            const minRestAPI = Math.min(...restApiResults);
            const maxRestAPI = Math.max(...restApiResults);
            
            console.log(`\nREST API PATCH /channels/{id}:`);
            console.log(`  - Successful calls: ${restApiResults.length}/3`);
            console.log(`  - Average time: ${avgRestAPI.toFixed(2)}ms`);
            console.log(`  - Min time: ${minRestAPI}ms`);
            console.log(`  - Max time: ${maxRestAPI}ms`);
            console.log(`  - All times: [${restApiResults.join(', ')}]ms`);
        } else {
            console.log(`\nREST API PATCH /channels/{id}: No successful calls`);
        }
        
        // Conclusion
        console.log('\n🎯 Conclusion:');
        if (discordjsResults.length > 0 && restApiResults.length > 0) {
            const avgDiscordJS = discordjsResults.reduce((a, b) => a + b, 0) / discordjsResults.length;
            const avgRestAPI = restApiResults.reduce((a, b) => a + b, 0) / restApiResults.length;
            
            if (avgRestAPI < avgDiscordJS) {
                const improvement = ((avgDiscordJS - avgRestAPI) / avgDiscordJS * 100).toFixed(1);
                console.log(`✅ REST API is ${improvement}% faster than discord.js`);
                console.log(`✅ Recommendation: Use REST API for channel renaming`);
            } else {
                const slowdown = ((avgRestAPI - avgDiscordJS) / avgDiscordJS * 100).toFixed(1);
                console.log(`⚠️  REST API is ${slowdown}% slower than discord.js`);
                console.log(`⚠️  Recommendation: Stick with discord.js method`);
            }
        } else {
            console.log(`❌ Insufficient data to make comparison`);
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        client.destroy();
        process.exit(0);
    }
}

// Run comparison
compareRenameMethods().catch(console.error);
