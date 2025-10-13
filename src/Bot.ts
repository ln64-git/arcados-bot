import {
	Client,
	Collection,
	GatewayIntentBits,
	type GuildMember,
	type Interaction,
	REST,
	Routes,
} from "discord.js";
import { config } from "./config";
import { getRedisClient } from "./features/cache-management/RedisManager";
import { DatabaseManager } from "./features/database-manager/DatabaseManager";
import { initializePostgresSchema } from "./features/database-manager/PostgresSchema.js";
import { memoryManager } from "./features/performance-monitoring/MemoryManager";
import { speakVoiceCall } from "./features/speak-voice-call/speakVoiceCall";
import { starboardManager } from "./features/starboard/StarboardManager";
import { VCLogsWatcher } from "./features/vc-logs-watcher/VCLogsWatcher.js";
import { voiceManager } from "./features/voice-manager/VoiceManager";
import type { ClientWithVoiceManager, Command } from "./types";
import { loadCommands } from "./utils/loadCommands";

export class Bot {
	public client: Client;
	public commands = new Collection<string, Command>();
	private databaseManager: DatabaseManager;
	private vcLogsWatcher: VCLogsWatcher | null = null;

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
		try {
			await this.databaseManager.initialize();
		} catch (error) {
			console.error("🔸 Database manager initialization failed:", error);
			// Continue with initialization even if database fails
		}

		// Initialize Redis connection
		try {
			await getRedisClient();
			// console.log("🔹 Redis connection established");
		} catch (error) {
			console.warn(
				`🔸 Redis connection failed, using PostgreSQL fallback: ${error}`,
			);
		}

		// Features will be initialized in the ready event handler

		memoryManager.endTimer(initStartTime);
	}

	private setupEventHandlers() {
		// Ready event
		this.client.once("ready", async () => {
			console.log("🔹 Bot is ready");

			// Initialize features after bot is ready
			speakVoiceCall(this.client);
			(this.client as ClientWithVoiceManager).voiceManager = voiceManager(
				this.client,
			);
			(this.client as ClientWithVoiceManager).starboardManager =
				starboardManager(this.client);

			// Initialize VC Logs Watcher
			try {
				await initializePostgresSchema();
				this.vcLogsWatcher = new VCLogsWatcher(
					this.client,
					null, // Will need to update VCLogsWatcher to work with PostgreSQL
					"1254696036988092437",
				);
				await this.vcLogsWatcher.startWatching();
				console.log("✅ VC Logs Watcher initialized");
			} catch (error) {
				console.error("🔸 VC Logs Watcher initialization failed:", error);
			}

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

		// Guild member events for role restoration using database manager
		this.client.on("guildMemberAdd", async (member) => {
			try {
				await this.restoreUserRolesFromDatabase(member);
			} catch (error) {
				console.error("🔸 Error handling guild member add:", error);
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

	private async restoreUserRolesFromDatabase(
		member: GuildMember,
	): Promise<void> {
		try {
			const { DatabaseManager } = await import(
				"./features/database-manager/DatabaseManager"
			);
			const dbManager = new DatabaseManager(this.client);
			await dbManager.initialize();

			const result = await dbManager.restoreMemberRoles(member);

			if (result.success && result.restoredCount > 0) {
				console.log(
					`🔹 Restored ${result.restoredCount} roles for user ${member.user.tag} (${member.id})`,
				);
			} else if (result.error) {
				console.log(`🔹 ${result.error}`);
			}
		} catch (error) {
			console.error(
				`🔸 Error restoring user roles for ${member.user.tag}:`,
				error,
			);
		}
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
