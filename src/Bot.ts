import {
	Client,
	Collection,
	GatewayIntentBits,
	REST,
	Routes,
} from "discord.js";
import type { Interaction } from "discord.js";
import { config } from "./config";
import { SurrealDBManager } from "./database/SurrealDBManager";
import { DiscordSyncManager } from "./features/discord-sync/DiscordSyncManager";
import { speakVoiceCall } from "./features/speak-voice-call/speakVoiceCall";
import { VoiceChannelManager } from "./features/voice-channel-manager/VoiceChannelManager";
import type { Command } from "./types";
import { loadCommands } from "./utils/loadCommands";

export class Bot {
	public client: Client;
	public commands = new Collection<string, Command>();
	public surrealManager: SurrealDBManager;
	public syncManager?: DiscordSyncManager;
	public voiceChannelManager?: VoiceChannelManager;

	constructor() {
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.GuildVoiceStates,
				GatewayIntentBits.GuildMembers,
			],
		});

		// Initialize SurrealDB manager
		this.surrealManager = new SurrealDBManager();
	}

	async init() {
		// Initialize SurrealDB connection first
		const dbConnected = await this.surrealManager.connect();

		if (dbConnected) {
			console.log("🔹 SurrealDB connected successfully");
		} else {
			console.log(
				"🔸 SurrealDB connection failed, continuing without database features",
			);
		}

		this.setupEventHandlers();
		await this.client.login(config.botToken);
		await this.deployCommands();
	}

	private setupEventHandlers() {
		// Ready event
		this.client.once("ready", async () => {
			console.log("🔹 Bot is ready");

			// Initialize voice channel manager
			if (this.surrealManager.isConnected()) {
				console.log("🔹 Initializing Voice Channel Manager...");

				// Get spawn channel ID from config
				const spawnChannelId = config.spawnChannelId;
				if (!spawnChannelId) {
					console.error(
						"🔸 No spawn channel ID configured - voice channel manager disabled",
					);
				} else {
					this.voiceChannelManager = new VoiceChannelManager(
						this.client,
						this.surrealManager,
						spawnChannelId,
					);
					await this.voiceChannelManager.initialize();
					console.log(
						"🔹 Voice Channel Manager ready - voice channels are now functional!",
					);
				}
			}

			// Initialize features after bot is ready
			// speakVoiceCall(this.client);

			// Initialize SurrealDB sync in background if connected
			if (this.surrealManager.isConnected()) {
				console.log("🔹 Starting SurrealDB sync in background...");
				this.initializeSurrealSync().catch((error) => {
					console.error("🔸 Background SurrealDB sync failed:", error);
				});
			}
		});

		// Interaction event for slash commands
		this.client.on("interactionCreate", async (interaction: Interaction) => {
			if (!interaction.isChatInputCommand()) return;

			const command = this.commands.get(interaction.commandName);
			if (!command) {
				return;
			}

			try {
				await command.execute(interaction);
			} catch (error) {
				console.error(
					`🔸 Error executing command ${interaction.commandName}:`,
					error,
				);
				const errorMessage = "There was an error while executing this command!";
				try {
					if (interaction.replied || interaction.deferred) {
						await interaction.followUp({
							content: errorMessage,
							ephemeral: true,
						});
					} else {
						await interaction.reply({ content: errorMessage, ephemeral: true });
					}
				} catch (err) {
					// If sending the error message fails, just log it - don't try again
					console.error("🔸 Failed to send error message to interaction:", err);
				}
			}
		});
	}

	private async deployCommands() {
		const rest = new REST({ version: "10" }).setToken(config.botToken);
		const commands = await loadCommands(this.commands);

		const appId = this.client.application?.id;
		if (!appId) {
			throw new Error(
				"Application ID is missing. Make sure the client is fully logged in.",
			);
		}
		if (config.guildId) {
			// Fast guild-specific deployment for testing
			await rest.put(Routes.applicationGuildCommands(appId, config.guildId), {
				body: commands,
			});
		} else {
			// Global deployment (takes up to an hour)
			await rest.put(Routes.applicationCommands(appId), { body: commands });
		}
	}

	private async initializeSurrealSync(): Promise<void> {
		try {
			console.log("🔹 [BACKGROUND] Initializing SurrealDB sync...");

			// Initialize sync manager
			this.syncManager = new DiscordSyncManager(
				this.client,
				this.surrealManager,
			);
			await this.syncManager.initialize();

			console.log(
				"🔹 DiscordSyncManager ready - syncing Discord data to database",
			);

			console.log("🔹 [BACKGROUND] SurrealDB sync initialized successfully");
		} catch (error) {
			console.error(
				"🔸 [BACKGROUND] Failed to initialize SurrealDB sync:",
				error,
			);
		}
	}

	async shutdown(): Promise<void> {
		// Silent shutdown - no console output to prevent lingering logs

		// Shutdown sync manager first to stop all sync operations
		if (this.syncManager) {
			await this.syncManager.shutdown();
		}

		// Immediately destroy Discord client to stop all Discord operations
		this.client.destroy();

		// Disconnect from SurrealDB
		if (this.surrealManager.isConnected()) {
			await this.surrealManager.disconnect();
		}
	}
}
