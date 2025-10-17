import {
	Client,
	Collection,
	GatewayIntentBits,
	type Interaction,
	REST,
	Routes,
} from "discord.js";
import { config } from "./config";
import { speakVoiceCall } from "./features/speak-voice-call/speakVoiceCall";
import type { Command } from "./types";
import { loadCommands } from "./utils/loadCommands";

export class Bot {
	public client: Client;
	public commands = new Collection<string, Command>();

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
	}

	async init() {
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
