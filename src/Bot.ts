/**
 * Bot
 *
 * Main bot coordinator that initializes features and manages lifecycle.
 * Delegates feature-specific logic to appropriate handlers.
 */

import { PostgreSQLManager } from "./database/PostgreSQLManager";
import { Client, Collection, GatewayIntentBits } from "discord.js";
import type { Interaction } from "discord.js";
import { config } from "./config";
import type { Command } from "./types";
import { CommandDeployer } from "./utils/CommandDeployer";
import { StateSyncService } from "./features/discord-sync/StateSyncService";
import { ConversationWorkflowManager } from "./features/social-intelligence";
import { MessageHandler } from "./features/ai-assistant";

export class Bot {
  public client: Client;
  public commands = new Collection<string, Command>();
  private db: PostgreSQLManager;

  // Feature coordinators
  private stateSyncService?: StateSyncService;
  private conversationWorkflow?: ConversationWorkflowManager;
  private messageHandler?: MessageHandler;
  private commandDeployer?: CommandDeployer;

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

    this.db = new PostgreSQLManager();
  }

  /**
   * Initialize the bot and all features
   */
  async init(): Promise<void> {
    // Connect to database
    const dbConnected = await this.db.connect();
    if (dbConnected) {
      console.log("🔹 PostgreSQL connected successfully");
    } else {
      console.log(
        "🔸 PostgreSQL connection failed, some commands may not work"
      );
    }

    // Set up event handlers
    this.setupEventHandlers();

    // Login to Discord
    await this.client.login(config.botToken);

    // Deploy commands
    await this.deployCommands();
  }

  /**
   * Set up Discord event handlers
   */
  private setupEventHandlers(): void {
    // Ready event - initialize all features
    this.client.once("ready", async () => {
      console.log(`🔹 Logged in as ${this.client.user?.tag}`);
      await this.initializeFeatures();
    });

    // Slash command interactions
    this.client.on("interactionCreate", async (interaction: Interaction) => {
      await this.handleInteraction(interaction);
    });

    // Message events (for AI assistant)
    this.client.on("messageCreate", async (message) => {
      await this.messageHandler?.handleMessage(message);
    });
  }

  /**
   * Initialize all feature services
   */
  private async initializeFeatures(): Promise<void> {
    console.log("🔹 Initializing features...");

    // Initialize conversation detection workflow
    // Handles relationship mapping, conversation detection, and maintenance
    this.conversationWorkflow = new ConversationWorkflowManager(
      this.client,
      this.db,
      {
        guildId: config.guildId,
        verbose: false, // Set to true for debugging
      }
    );
    await this.conversationWorkflow.start();

    // Initialize state sync service
    // Handles real-time Discord state synchronization
    this.stateSyncService = new StateSyncService(
      this.client,
      this.db,
      this.conversationWorkflow.getRelationshipMapper()!,
      this.conversationWorkflow.getConversationDetector()!,
      false // Set to true for verbose logging
    );
    await this.stateSyncService.start();

    // Initialize message handler
    // Handles AI assistant interactions
    this.messageHandler = new MessageHandler(this.client, this.db);

    console.log("✅ All features initialized successfully");
  }

  /**
   * Handle slash command interactions
   */
  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) {
      return;
    }

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
          await interaction.reply({
            content: errorMessage,
            ephemeral: true,
          });
        }
      } catch (err) {
        // If sending the error message fails, just log it
        console.error("🔸 Failed to send error message to interaction:", err);
      }
    }
  }

  /**
   * Deploy commands to Discord
   */
  private async deployCommands(): Promise<void> {
    const appId = this.client.application?.id;
    if (!appId) {
      throw new Error(
        "Application ID is missing. Make sure the client is fully logged in."
      );
    }

    this.commandDeployer = new CommandDeployer(config.botToken, this.commands);
    await this.commandDeployer.deploy(appId, config.guildId);
  }

  /**
   * Gracefully shutdown the bot and all features
   */
  async shutdown(): Promise<void> {
    console.log("🔹 Shutting down bot...");

    // Stop conversation workflow (handles conversation finalization + cleanup)
    if (this.conversationWorkflow) {
      await this.conversationWorkflow.stop();
    }

    // Stop state sync service
    if (this.stateSyncService) {
      await this.stateSyncService.stop();
    }

    // Destroy Discord client
    this.client.destroy();

    // Disconnect from database
    if (this.db.isConnected()) {
      await this.db.disconnect();
    }

    console.log("✅ Bot shutdown complete");
  }
}
