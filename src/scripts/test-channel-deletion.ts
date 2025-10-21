#!/usr/bin/env npx tsx

import { Client, GatewayIntentBits } from "discord.js";
import { config } from "../config";

async function testChannelDeletion() {
    console.log("🔹 Testing channel deletion functionality...");
    
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates,
        ],
    });

    try {
        await client.login(config.botToken);
        console.log("🔹 Bot logged in successfully");

        // Wait for bot to be ready
        await new Promise<void>((resolve) => {
            client.once("ready", () => {
                console.log("🔹 Bot is ready");
                resolve();
            });
        });

        // Get the spawn channel
        const spawnChannelId = config.spawnChannelId;
        if (!spawnChannelId) {
            console.error("🔸 SPAWN_CHANNEL_ID not configured");
            return;
        }

        console.log(`🔹 Spawn channel ID: ${spawnChannelId}`);

        // Find the spawn channel
        const spawnChannel = client.channels.cache.get(spawnChannelId);
        if (!spawnChannel?.isVoiceBased()) {
            console.error(`🔸 Spawn channel ${spawnChannelId} not found or not voice`);
            return;
        }

        console.log(`🔹 Found spawn channel: ${spawnChannel.name}`);

        // Check current channels in the guild
        const guild = spawnChannel.guild;
        console.log(`🔹 Guild: ${guild.name}`);
        
        const voiceChannels = guild.channels.cache.filter(channel => channel.isVoiceBased());
        console.log(`🔹 Current voice channels:`);
        voiceChannels.forEach(channel => {
            console.log(`  - ${channel.name} (${channel.id}) - Members: ${channel.members.size}`);
        });

        // Check if there are any user-generated channels
        const userChannels = voiceChannels.filter(channel => 
            channel.name.includes("'s Channel") || 
            channel.name.includes("Channel") && channel.id !== spawnChannelId
        );

        console.log(`🔹 Found ${userChannels.size} potential user channels:`);
        userChannels.forEach(channel => {
            console.log(`  - ${channel.name} (${channel.id}) - Members: ${channel.members.size}`);
        });

        // If there are empty user channels, they should be deleted
        const emptyUserChannels = userChannels.filter(channel => channel.members.size === 0);
        console.log(`🔹 Found ${emptyUserChannels.size} empty user channels that should be deleted`);

        if (emptyUserChannels.size > 0) {
            console.log("🔹 Empty user channels found - these should be automatically deleted by the bot");
            emptyUserChannels.forEach(channel => {
                console.log(`  - ${channel.name} (${channel.id})`);
            });
        } else {
            console.log("🔹 No empty user channels found");
        }

        console.log("🔹 Test completed - check bot logs for channel deletion activity");

    } catch (error) {
        console.error("🔸 Error during test:", error);
    } finally {
        await client.destroy();
        console.log("🔹 Bot disconnected");
    }
}

testChannelDeletion().catch(console.error);
