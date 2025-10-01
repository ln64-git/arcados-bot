#!/usr/bin/env node

/**
 * Bot Environment Diagnostic
 * Analyzes the bot's environment to identify what might be causing channel.setName() timeouts
 */

import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './src/config/index.ts';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages,
    ],
});

// Track event handler performance
const eventMetrics = {
    voiceStateUpdate: { count: 0, totalTime: 0, maxTime: 0 },
    interactionCreate: { count: 0, totalTime: 0, maxTime: 0 },
    messageCreate: { count: 0, totalTime: 0, maxTime: 0 },
};

// Monitor event handler performance
function wrapEventHandler(eventName, handler) {
    return async (...args) => {
        const start = Date.now();
        try {
            await handler(...args);
        } catch (error) {
            console.error(`🔸 Error in ${eventName} handler:`, error);
        } finally {
            const duration = Date.now() - start;
            if (eventMetrics[eventName]) {
                eventMetrics[eventName].count++;
                eventMetrics[eventName].totalTime += duration;
                eventMetrics[eventName].maxTime = Math.max(eventMetrics[eventName].maxTime, duration);
            }
        }
    };
}

async function diagnoseBotEnvironment() {
    console.log('🔍 Bot Environment Diagnostic');
    console.log('==============================\n');
    
    try {
        // Login to Discord
        console.log('🔹 Logging into Discord...');
        await client.login(config.botToken);
        console.log('✅ Logged in successfully\n');
        
        // Wait for ready
        await new Promise(resolve => client.once('ready', resolve));
        console.log('✅ Bot is ready\n');
        
        // Basic bot info
        console.log('📊 Bot Information:');
        console.log(`  - Bot: ${client.user.tag}`);
        console.log(`  - Ping: ${client.ws.ping}ms`);
        console.log(`  - Uptime: ${client.uptime}ms`);
        console.log(`  - Guilds: ${client.guilds.cache.size}`);
        console.log(`  - Channels: ${client.channels.cache.size}`);
        console.log(`  - Users: ${client.users.cache.size}`);
        console.log('');
        
        // Memory usage
        const memUsage = process.memoryUsage();
        console.log('📊 Memory Usage:');
        console.log(`  - RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
        console.log(`  - Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
        console.log(`  - Heap Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
        console.log(`  - External: ${Math.round(memUsage.external / 1024 / 1024)}MB`);
        console.log('');
        
        // Check Node.js version and environment
        console.log('📊 Environment:');
        console.log(`  - Node.js: ${process.version}`);
        console.log(`  - Platform: ${process.platform}`);
        console.log(`  - Arch: ${process.arch}`);
        console.log(`  - PID: ${process.pid}`);
        console.log(`  - CPU Usage: ${JSON.stringify(process.cpuUsage())}`);
        console.log('');
        
        // Check Discord.js version
        console.log('📊 Discord.js:');
        console.log(`  - Version: ${require('discord.js/package.json').version}`);
        console.log('');
        
        // Monitor events for 30 seconds
        console.log('🔍 Monitoring events for 30 seconds...');
        
        // Set up event monitoring
        client.on('voiceStateUpdate', wrapEventHandler('voiceStateUpdate', (oldState, newState) => {
            // Simulate the bot's voice state update handler
            console.log(`🔊 Voice state update: ${oldState.member?.user.tag || 'Unknown'} ${oldState.channelId ? 'left' : 'joined'} ${newState.channelId ? 'joined' : 'left'}`);
        }));
        
        client.on('interactionCreate', wrapEventHandler('interactionCreate', (interaction) => {
            console.log(`🎯 Interaction: ${interaction.type} from ${interaction.user?.tag || 'Unknown'}`);
        }));
        
        client.on('messageCreate', wrapEventHandler('messageCreate', (message) => {
            if (message.author.bot) return;
            console.log(`💬 Message: ${message.author.tag} in ${message.channel.name}`);
        }));
        
        // Wait and collect metrics
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Print event metrics
        console.log('\n📊 Event Handler Performance (30 seconds):');
        console.log('==========================================');
        
        Object.entries(eventMetrics).forEach(([eventName, metrics]) => {
            if (metrics.count > 0) {
                const avgTime = metrics.totalTime / metrics.count;
                console.log(`${eventName}:`);
                console.log(`  - Count: ${metrics.count}`);
                console.log(`  - Average time: ${avgTime.toFixed(2)}ms`);
                console.log(`  - Max time: ${metrics.maxTime}ms`);
                console.log(`  - Total time: ${metrics.totalTime}ms`);
            } else {
                console.log(`${eventName}: No events`);
            }
        });
        
        // Check for potential issues
        console.log('\n🔍 Potential Issues:');
        console.log('===================');
        
        if (memUsage.heapUsed > 100 * 1024 * 1024) { // > 100MB
            console.log('⚠️  High memory usage detected');
        }
        
        if (client.ws.ping > 200) {
            console.log('⚠️  High Discord ping detected');
        }
        
        const totalEventTime = Object.values(eventMetrics).reduce((sum, metrics) => sum + metrics.totalTime, 0);
        if (totalEventTime > 5000) { // > 5 seconds total
            console.log('⚠️  Event handlers taking significant time');
        }
        
        // Test channel.setName() in this environment
        console.log('\n🔍 Testing channel.setName() in bot environment...');
        
        const voiceChannels = client.channels.cache.filter(channel => channel.isVoiceBased());
        if (voiceChannels.size > 0) {
            const testChannel = voiceChannels.first();
            const originalName = testChannel.name;
            const testName = `Diagnostic-Test-${Date.now()}`;
            
            console.log(`🎯 Testing with channel: ${testChannel.name} (${testChannel.id})`);
            
            try {
                const start = Date.now();
                await Promise.race([
                    testChannel.setName(testName),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), 20000)
                    )
                ]);
                const duration = Date.now() - start;
                console.log(`✅ channel.setName() succeeded in ${duration}ms`);
                
                // Restore original name
                await testChannel.setName(originalName);
                console.log('✅ Original name restored');
                
            } catch (error) {
                console.log(`❌ channel.setName() failed: ${error.message}`);
            }
        }
        
        console.log('\n✅ Diagnostic completed!');
        
    } catch (error) {
        console.error('❌ Diagnostic failed:', error);
    } finally {
        client.destroy();
        process.exit(0);
    }
}

// Run diagnostic
diagnoseBotEnvironment().catch(console.error);
