import {
	Client,
	Collection,
	GatewayIntentBits,
	type Interaction,
	REST,
	Routes,
} from "discord.js";
import { config } from "./config";
import { getRedisClient } from "./features/cache-management/RedisManager";
import { DatabaseManager } from "./features/database-manager/DatabaseManager";
import { memoryManager } from "./features/performance-monitoring/MemoryManager";
import { speakVoiceCall } from "./features/speak-voice-call/speakVoiceCall";
import { starboardManager } from "./features/starboard/StarboardManager";
import { userManager } from "./features/user-manager/UserManager";
import { voiceManager } from "./features/voice-manager/VoiceManager";
import type { ClientWithVoiceManager, Command } from "./types";
import { loadCommands } from "./utils/loadCommands";

export class Bot {
	public client: Client;
	public commands = new Collection<string, Command>();
	private databaseManager: DatabaseManager;

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
		// Initialize services
		this.databaseManager = new DatabaseManager(this.client);
	}

	async init() {
		const initStartTime = memoryManager.startTimer();

		this.setupEventHandlers();
		await this.client.login(config.botToken);
		await this.deployCommands();

		// Initialize database manager
		await this.databaseManager.initialize();

		// Initialize Redis connection
		try {
			await getRedisClient();
			// console.log("🔹 Redis connection established");
		} catch (error) {
			console.warn(
				`🔸 Redis connection failed, using MongoDB fallback: ${error}`,
			);
		}

		// Initialize features after login
		speakVoiceCall(this.client);
		(this.client as ClientWithVoiceManager).userManager = userManager();
		(this.client as ClientWithVoiceManager).voiceManager = voiceManager(
			this.client,
		);
		(this.client as ClientWithVoiceManager).starboardManager = starboardManager(
			this.client,
		);

		memoryManager.endTimer(initStartTime);
	}

	private setupEventHandlers() {
		// Ready event
		this.client.once("ready", async () => {
			console.log("🔹 Bot is ready");
			// Check guild sync status after bot is ready
		});

		// Interaction event for slash commands
		this.client.on("interactionCreate", async (interaction: Interaction) => {
			if (!interaction.isChatInputCommand()) return;

			const command = this.commands.get(interaction.commandName);
			if (!command) {
				return;
			}

			const commandStartTime = memoryManager.startTimer();

			try {
				await command.execute(interaction);

				const commandTime = memoryManager.endTimer(commandStartTime);
				memoryManager.recordCommandExecutionTime(commandTime);

				// Log slow commands (>1 second)
				if (commandTime > 1000) {
					console.warn(
						`🔸 Slow command detected: ${interaction.commandName} took ${commandTime.toFixed(2)}ms`,
					);
				}
			} catch (error) {
				const commandTime = memoryManager.endTimer(commandStartTime);
				console.error(
					`🔸 Error executing command ${interaction.commandName} (${commandTime.toFixed(2)}ms):`,
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

		// Guild member events for role restoration
		this.client.on("guildMemberAdd", async (member) => {
			try {
				const userManager = (this.client as ClientWithVoiceManager).userManager;
				if (userManager) {
					await userManager.restoreUserRoles(member);
				}
			} catch (error) {
				console.error("🔸 Error handling guild member add:", error);
			}
		});

		this.client.on("guildMemberRemove", async (member) => {
			try {
				const userManager = (this.client as ClientWithVoiceManager).userManager;
				if (userManager && member.partial === false) {
					await userManager.storeUserRoles(member);
				}
			} catch (error) {
				console.error("🔸 Error handling guild member remove:", error);
			}
		});

		// Starboard reaction events
		this.client.on("messageReactionAdd", async (reaction) => {
			try {
				const starboardManager = (this.client as ClientWithVoiceManager)
					.starboardManager;
				if (starboardManager) {
					await starboardManager.handleReactionAdd(reaction);
				}
			} catch (error) {
				console.error("🔸 Error handling reaction add:", error);
			}
		});

		this.client.on("messageReactionRemove", async (reaction) => {
			try {
				const starboardManager = (this.client as ClientWithVoiceManager)
					.starboardManager;
				if (starboardManager) {
					await starboardManager.handleReactionRemove(reaction);
				}
			} catch (error) {
				console.error("🔸 Error handling reaction remove:", error);
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
