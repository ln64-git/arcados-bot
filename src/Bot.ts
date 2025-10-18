import {
	Client,
	Collection,
	GatewayIntentBits,
	type Interaction,
	REST,
	Routes,
} from "discord.js";
import { config } from "./config";
import { SurrealDBManager } from "./database/SurrealDBManager";
import type { SurrealAction } from "./database/schema";
import { DiscordSyncManager } from "./features/discord-sync/DiscordSyncManager";
import { DatabaseActions } from "./features/discord-sync/actions";
import { speakVoiceCall } from "./features/speak-voice-call/speakVoiceCall";
import type { Command } from "./types";
import { loadCommands } from "./utils/loadCommands";

export class Bot {
	public client: Client;
	public commands = new Collection<string, Command>();
	public surrealManager: SurrealDBManager;
	public syncManager?: DiscordSyncManager;
	public actionsManager?: DatabaseActions;

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

			// Initialize features after bot is ready
			speakVoiceCall(this.client);

			// Initialize SurrealDB sync if connected
			if (this.surrealManager.isConnected()) {
				await this.initializeSurrealSync();
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
			console.log("🔹 Initializing SurrealDB sync...");

			// Initialize sync manager
			this.syncManager = new DiscordSyncManager(
				this.client,
				this.surrealManager,
			);
			await this.syncManager.initialize();

			// Initialize actions manager
			this.actionsManager = new DatabaseActions(
				this.client,
				this.surrealManager,
			);

			// Set up live query subscriptions
			await this.setupLiveQueries();

			// Start action processor
			this.actionsManager.startActionProcessor(30000); // Check every 30 seconds

			console.log("🔹 SurrealDB sync initialized successfully");
		} catch (error) {
			console.error("🔸 Failed to initialize SurrealDB sync:", error);
		}
	}

	private async setupLiveQueries(): Promise<void> {
		try {
			// Subscribe to guild changes
			await this.surrealManager.subscribeToGuilds((action, data) => {
				console.log(`🔹 Guild ${action}:`, data);
				this.handleGuildChangeFromDB(
					action,
					data as unknown as Record<string, unknown>,
				);
			});

			// Subscribe to member changes
			await this.surrealManager.subscribeToMembers((action, data) => {
				console.log(`🔹 Member ${action}:`, data);
				this.handleMemberChangeFromDB(
					action,
					data as unknown as Record<string, unknown>,
				);
			});

			// Subscribe to action changes
			await this.surrealManager.subscribeToActions((action, data) => {
				console.log(`🔹 Action ${action}:`, data);
				if (action === "CREATE" && this.actionsManager) {
					this.actionsManager.executeAction(data as unknown as SurrealAction);
				}
			});

			console.log("🔹 Live query subscriptions established");
		} catch (error) {
			console.error("🔸 Failed to setup live queries:", error);
		}
	}

	private handleGuildChangeFromDB(
		action: string,
		data: Record<string, unknown>,
	): void {
		// Handle real-time guild updates from SurrealDB
		console.log(`🔹 Processing guild ${action} from database:`, data);

		// You can add specific logic here for guild changes
		// For example, updating Discord cache, sending notifications, etc.
	}

	private handleMemberChangeFromDB(
		action: string,
		data: Record<string, unknown>,
	): void {
		// Handle real-time member updates from SurrealDB
		console.log(`🔹 Processing member ${action} from database:`, data);

		// You can add specific logic here for member changes
		// For example, checking for milestone achievements, role updates, etc.
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
