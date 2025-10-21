#!/usr/bin/env npx tsx

import { Client, GatewayIntentBits } from "discord.js";
import { config } from "../config";

async function checkChannel() {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });
    
    try {
        await client.login(config.botToken);
        await new Promise<void>(resolve => client.once('ready', resolve));
        
        const channel = client.channels.cache.get('1430041855642435665');
        if (channel) {
            console.log('Channel exists:', channel.name, '- Members:', channel.members.size);
            console.log('Channel type:', channel.type);
            console.log('Channel guild:', channel.guild.name);
        } else {
            console.log('Channel 1430041855642435665 does not exist (deleted)');
        }
        
        // Also check all voice channels
        const guild = client.guilds.cache.get('1254694808228986912');
        if (guild) {
            const voiceChannels = guild.channels.cache.filter(channel => channel.isVoiceBased());
            console.log('\nAll voice channels:');
            voiceChannels.forEach(channel => {
                console.log(`  - ${channel.name} (${channel.id}) - Members: ${channel.members.size}`);
            });
        }
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.destroy();
    }
}

checkChannel().catch(console.error);
