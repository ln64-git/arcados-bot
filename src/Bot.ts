import { Client, Collection, GatewayIntentBits, REST, Routes } from "discord.js";
import { loadCommands } from "./utils/loadCommands";
import { speakVoiceCall } from "./features/speak-voice-call/speakVoiceCall";
import type { Command } from "./types";
import { config } from "./config";

export class Bot {
    public client: Client;
    public commands = new Collection<string, Command>();

    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });
    }

    async init() {
        try {
            console.log('🔹 Initializing bot...');
            await this.client.login(config.botToken);
            await this.deployCommands();
            this.setupEventHandlers();
            console.log(`🔹 Logged in as ${this.client.user?.tag}!`);
        } catch (error) {
            console.error('🔸 Failed to initialize bot:', error);
            throw error;
        }
    }

    private setupEventHandlers() {
        // Ready event
        this.client.once('ready', () => {
            console.log('🔹 Bot is ready!');
            console.log(`🔹 Serving ${this.client.guilds.cache.size} guilds`);
            speakVoiceCall(this.client);
        });

        // Interaction event for slash commands
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            const command = this.commands.get(interaction.commandName);
            if (!command) {
                console.warn(`⚠️ Unknown command: ${interaction.commandName}`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`🔸 Error executing command ${interaction.commandName}:`, error);
                const errorMessage = 'There was an error while executing this command!';
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: errorMessage, ephemeral: true });
                    } else {
                        await interaction.reply({ content: errorMessage, ephemeral: true });
                    }
                } catch (replyError) {
                    console.error('🔸 Failed to send error message to user:', replyError);
                }
            }
        });

        // Error handling
        this.client.on('error', (error) => {
            console.error('🔸 Discord client error:', error);
        });

        // Warning handling
        this.client.on('warn', (warning) => {
            console.warn('⚠️ Discord client warning:', warning);
        });

        // Disconnect handling
        this.client.on('disconnect', () => {
            console.warn('⚠️ Bot disconnected from Discord');
        });

        // Reconnect handling
        this.client.on('reconnecting', () => {
            console.log('🔹 Bot reconnecting to Discord...');
        });
    }

    private async deployCommands() {
        const rest = new REST({ version: "10" }).setToken(config.botToken);
        const commands = await loadCommands(this.client, this.commands);

        const appId = this.client.application?.id;
        if (!appId) {
            throw new Error("Application ID is missing. Make sure the client is fully logged in.");
        }

        try {
            if (config.guildId) {
                // Fast guild-specific deployment for testing
                await rest.put(
                    Routes.applicationGuildCommands(appId, config.guildId),
                    { body: commands },
                );
                const guildName = this.client.guilds.cache.get(config.guildId)?.name || 'Unknown Guild';
                console.log(`🔹 Slash commands registered for ${guildName}`);
            } else {
                // Global deployment (takes up to an hour)
                await rest.put(
                    Routes.applicationCommands(appId),
                    { body: commands },
                );
                console.log("🔹 Global slash commands registered to all guilds");
            }
        } catch (error) {
            console.error("🔸 Error registering slash commands:", error);
            throw error;
        }
    }
}