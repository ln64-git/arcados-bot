#!/usr/bin/env node

/**
 * Focused Channel Rename Test
 * Tests channel.setName() performance specifically
 */

import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './src/config/index.ts';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

async function testChannelRenamePerformance() {
    console.log('🔍 Focused Channel Rename Performance Test');
    console.log('==========================================\n');
    
    try {
        // Login to Discord
        console.log('🔹 Logging into Discord...');
        await client.login(config.botToken);
        console.log('✅ Logged in successfully\n');
        
        // Wait for ready
        await new Promise(resolve => client.once('ready', resolve));
        console.log('✅ Bot is ready\n');
        
        // Find a test channel (use the one that was having issues)
        const testChannelId = '1422724558401699933'; // The "sdfgfdg" channel from the diagnostic
        const channel = client.channels.cache.get(testChannelId);
        
        if (!channel) {
            throw new Error(`Test channel ${testChannelId} not found`);
        }
        
        console.log(`🎯 Testing with channel: ${channel.name} (${channel.id})`);
        console.log(`   Guild: ${channel.guild.name}`);
        console.log(`   Type: ${channel.type}`);
        console.log(`   Position: ${channel.position}`);
        console.log('');
        
        const originalName = channel.name;
        const testNames = [
            `Test-${Date.now()}`,
            `Quick-Test-${Date.now()}`,
            `Performance-Test-${Date.now()}`,
            `Final-Test-${Date.now()}`,
            originalName // Restore original name
        ];
        
        console.log('🚀 Running channel.setName() performance tests...\n');
        
        for (let i = 0; i < testNames.length; i++) {
            const testName = testNames[i];
            const isRestore = i === testNames.length - 1;
            
            console.log(`📝 Test ${i + 1}/${testNames.length}: ${isRestore ? 'Restoring' : 'Setting'} name to "${testName}"`);
            
            try {
                const start = Date.now();
                
                // Test with different timeout values
                const timeoutMs = isRestore ? 10000 : 30000; // Shorter timeout for restore
                
                await Promise.race([
                    channel.setName(testName),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
                    )
                ]);
                
                const duration = Date.now() - start;
                
                if (duration < 1000) {
                    console.log(`✅ Success in ${duration}ms (Very fast!)`);
                } else if (duration < 5000) {
                    console.log(`✅ Success in ${duration}ms (Fast)`);
                } else if (duration < 10000) {
                    console.log(`⚠️  Success in ${duration}ms (Slow)`);
                } else {
                    console.log(`🐌 Success in ${duration}ms (Very slow!)`);
                }
                
                // Wait between tests to avoid rate limiting
                if (i < testNames.length - 1) {
                    console.log('⏳ Waiting 3 seconds before next test...');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
                
            } catch (error) {
                console.log(`❌ Failed: ${error.message}`);
                
                // If it's a timeout, let's try to restore the original name with a longer timeout
                if (error.message.includes('Timeout') && !isRestore) {
                    console.log('🔄 Attempting to restore original name with longer timeout...');
                    try {
                        await Promise.race([
                            channel.setName(originalName),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Restore timeout')), 60000)
                            )
                        ]);
                        console.log('✅ Original name restored');
                    } catch (restoreError) {
                        console.log(`❌ Failed to restore original name: ${restoreError.message}`);
                    }
                }
                break;
            }
        }
        
        console.log('\n📊 Test Results Analysis:');
        console.log('========================');
        console.log('If channel.setName() consistently takes >10 seconds:');
        console.log('  - This is a Discord API performance issue');
        console.log('  - Not related to your bot or code');
        console.log('  - Discord\'s servers may be experiencing issues');
        console.log('');
        console.log('If channel.setName() is fast in tests but slow in the bot:');
        console.log('  - There may be a bot-specific issue');
        console.log('  - Could be related to event handlers or other operations');
        console.log('  - Need to investigate the bot\'s event loop');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        client.destroy();
        process.exit(0);
    }
}

// Run test
testChannelRenamePerformance().catch(console.error);
