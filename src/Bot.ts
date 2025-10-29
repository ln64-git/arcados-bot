import {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import type { Interaction } from "discord.js";
import { config } from "./config";
import { PostgreSQLManager } from "./features/database/PostgreSQLManager";
import type { Command } from "./types";
import { loadCommands } from "./utils/loadCommands";
import { AIManager } from "./features/ai-assistant/AIManager";
import {
  getSessionByRepliedMessageId,
  appendUserTurn,
  appendAssistantTurnAndTrackMessage,
  formatHistoryForPrompt,
} from "./features/ai-assistant/ChatSessionManager";

export class Bot {
  public client: Client;
  public commands = new Collection<string, Command>();
  public postgresManager: PostgreSQLManager;

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

    // Initialize PostgreSQL manager
    this.postgresManager = new PostgreSQLManager();
  }

  async init() {
    // Initialize PostgreSQL connection for commands that need it
    const dbConnected = await this.postgresManager.connect();

    if (dbConnected) {
      console.log("🔹 PostgreSQL connected successfully");
    } else {
      console.log(
        "🔸 PostgreSQL connection failed, some commands may not work"
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
      console.log(`🔹 Logged in as ${this.client.user?.tag}`);
      console.log(`🔹 Serving ${this.client.guilds.cache.size} guilds`);
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
          error
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

    // Continue chat sessions when users reply to bot messages
    this.client.on("messageCreate", async (message) => {
      try {
        // Ignore bot messages and messages without a reference
        if (message.author.bot) return;
        const refId = message.reference?.messageId;
        if (!refId) return;

        const found = getSessionByRepliedMessageId(refId);
        if (!found) return;

        const manager = AIManager.getInstance();
        const provider = "grok"; // default provider for chat
        const methodPrompt =
          "You are a friendly, concise Discord chat companion. Keep replies brief (1-2 sentences), natural, and conversational. Avoid long lists or formal tone.";

        // Append user's new turn
        appendUserTurn(found.sessionId, message.content);
        const compiledPrompt = formatHistoryForPrompt(found.sessionId);

        // Use public API with chat style included in prompt
        const fullPrompt = `${methodPrompt}\n\n${compiledPrompt}`;
        const contentResponse = await manager.generateText(
          fullPrompt,
          message.author.id,
          provider
        );

        if (!contentResponse?.success || !contentResponse.content) return;

        const reply = await message.reply({ content: contentResponse.content });
        appendAssistantTurnAndTrackMessage(
          found.sessionId,
          reply,
          contentResponse.content
        );
      } catch (err) {
        // Silent fail to avoid noisy channels
      }
    });
  }

  private async deployCommands() {
    const rest = new REST({ version: "10" }).setToken(config.botToken);
    const commands = await loadCommands(this.commands);

    const appId = this.client.application?.id;
    if (!appId) {
      throw new Error(
        "Application ID is missing. Make sure the client is fully logged in."
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

  async shutdown(): Promise<void> {
    // Silent shutdown - no console output to prevent lingering logs

    // Immediately destroy Discord client to stop all Discord operations
    this.client.destroy();

    // Disconnect from PostgreSQL
    if (this.postgresManager.isConnected()) {
      await this.postgresManager.disconnect();
    }
  }
}
