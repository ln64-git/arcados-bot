import {
	Client,
	Collection,
	GatewayIntentBits,
	type Interaction,
	REST,
	Routes,
} from "discord.js";
import { config } from "./config";
import { DatabaseManagementService } from "./features/database-manager/DatabaseManagementService";
import { speakVoiceCall } from "./features/speak-voice-call/speakVoiceCall";
import { voiceManager } from "./features/vocie-manager/VoiceManager";
import type { ClientWithVoiceManager, Command } from "./types";
import { loadCommands } from "./utils/loadCommands";
import { getRedisClient } from "./utils/redis";

export class Bot {
	public client: Client;
	public commands = new Collection<string, Command>();
	private databaseManagementService: DatabaseManagementService;

	constructor() {
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.GuildVoiceStates,
			],
		});
		// Initialize services
		this.databaseManagementService = new DatabaseManagementService(this.client);
	}

	async init() {
		this.setupEventHandlers();
		await this.client.login(config.botToken);
		await this.deployCommands();

		// Initialize database management service
		await this.databaseManagementService.initialize();

		// Initialize Redis connection
		try {
			await getRedisClient();
			console.log("🔹 Redis connection established");
		} catch (error) {
			console.warn(
				`🔸 Redis connection failed, using MongoDB fallback: ${error}`,
			);
		}

		// Initialize features after login
		speakVoiceCall(this.client);
		(this.client as ClientWithVoiceManager).voiceManager = voiceManager(
			this.client,
		);
	}

	private setupEventHandlers() {
		// Ready event
		this.client.once("ready", async () => {
			// Check guild sync status after bot is ready
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
}
