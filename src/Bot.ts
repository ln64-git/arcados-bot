/**
 * Bot
 *
 * Main bot coordinator that initializes features and manages lifecycle.
 * Delegates feature-specific logic to appropriate handlers.
 */

import { PostgreSQLManager } from "./database/PostgreSQLManager";
import { Client, Collection, GatewayIntentBits } from "discord.js";
import type { Interaction, VoiceState } from "discord.js";
import { config } from "./config";
import type { Command } from "./types";
import { CommandDeployer } from "./utils/CommandDeployer";
import { StateSyncService } from "./features/discord-sync/StateSyncService";
import { ConversationWorkflowManager } from "./features/social-intelligence";
import { MessageHandler } from "./features/chat-assistant";
import { VoiceAssistantManager } from "./features/voice-assistant/VoiceAssistantManager";
import { MediaPlayerManager } from "./features/media-player/MediaPlayerManager";
import { VoiceConnectionManager } from "./features/voice-assistant/services/VoiceConnectionManager";
import { StreamPlayerManager } from "./features/stream-player/StreamPlayerManager";

export class Bot {
  public client: Client;
  public commands = new Collection<string, Command>();
  private db: PostgreSQLManager;

  // Feature coordinators
  private stateSyncService?: StateSyncService;
  private conversationWorkflow?: ConversationWorkflowManager;
  private messageHandler?: MessageHandler;
  private commandDeployer?: CommandDeployer;
  private voiceAssistant?: VoiceAssistantManager;

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
      // Handle button interactions for media player
      if (interaction.isButton() && interaction.customId.startsWith("media_")) {
        await this.handleMediaButton(interaction);
        return;
      }

      await this.handleInteraction(interaction);
    });

    // Message events (for AI assistant)
    this.client.on("messageCreate", async (message) => {
      await this.messageHandler?.handleMessage(message);
    });

    // Voice state updates - disconnect if everyone leaves
    this.client.on(
      "voiceStateUpdate",
      async (oldState: VoiceState, newState: VoiceState) => {
        await this.handleVoiceStateUpdate(oldState, newState);
      }
    );
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

    // Initialize message handler
    // Handles AI assistant interactions
    this.messageHandler = new MessageHandler(this.client, this.db);

    // Initialize voice assistant
    // Handles voice channel interactions and real-time voice conversation
    this.voiceAssistant = VoiceAssistantManager.getInstance();
    await this.voiceAssistant.initialize(this.client);

    // Initialize media player
    const mediaPlayer = MediaPlayerManager.getInstance();
    mediaPlayer.initialize(this.client);

    // Initialize stream player
    const streamPlayer = StreamPlayerManager.getInstance();
    // await streamPlayer.initialize(this.client);

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

    console.log("✅ All features initialized successfully");
  }

  /**
   * Handle media player button interactions
   */
  private async handleMediaButton(interaction: any): Promise<void> {
    if (!interaction.guildId || !interaction.channel) {
      return;
    }

    try {
      const mediaPlayer = MediaPlayerManager.getInstance();

      // For queue button, we need to reply ephemerally, so don't defer
      if (interaction.customId === "media_queue") {
        await mediaPlayer.handleButtonInteraction(
          interaction.guildId,
          interaction.customId,
          interaction.channel,
          interaction
        );
        return; // Don't defer update for queue button
      }

      await mediaPlayer.handleButtonInteraction(
        interaction.guildId,
        interaction.customId,
        interaction.channel,
        interaction
      );

      // Acknowledge interaction
      await interaction.deferUpdate().catch(() => {
        // Ignore if already acknowledged
      });
    } catch (error) {
      console.error("[Bot] Error handling media button:", error);
      try {
        await interaction.reply({
          content: "An error occurred while handling that action.",
          ephemeral: true,
        });
      } catch {
        // Ignore if interaction already handled
      }
    }
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
   * Handle voice state updates - disconnect if everyone leaves
   */
  private async handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState
  ): Promise<void> {
    // Only check when someone leaves a channel (not when they join or switch)
    if (!oldState.channelId) {
      return; // User wasn't in a channel before
    }

    // Check if bot is connected to this channel
    const connectionManager = VoiceConnectionManager.getInstance();
    const session = connectionManager.getSession(oldState.guild.id);

    if (!session || session.channelId !== oldState.channelId) {
      return; // Bot is not connected to this channel
    }

    // Fetch the channel to get current member count
    const channel = await oldState.guild.channels.fetch(oldState.channelId);
    if (!channel || !channel.isVoiceBased()) {
      return;
    }

    // Count members in the channel (excluding the bot)
    const botId = this.client.user?.id;
    const memberCount = channel.members.filter(
      (member) => member.id !== botId
    ).size;

    // If no other members remain, disconnect
    if (memberCount === 0) {
      console.log(
        `🔹 Everyone left voice channel ${channel.name} in ${oldState.guild.name}, disconnecting bot`
      );

      // Disconnect voice assistant
      if (this.voiceAssistant?.isInVoiceChannel(oldState.guild.id)) {
        try {
          await this.voiceAssistant.leaveVoiceChannel(oldState.guild.id);
        } catch (error) {
          console.error(`🔸 Error disconnecting voice assistant:`, error);
        }
      }

      // Stop and disconnect media player
      const mediaPlayer = MediaPlayerManager.getInstance();
      try {
        await mediaPlayer.stop(oldState.guild.id);
        // Also disconnect the connection if media player was using it
        if (connectionManager.isConnected(oldState.guild.id)) {
          await connectionManager.leaveChannel(oldState.guild.id);
        }
      } catch (error) {
        console.error(`🔸 Error stopping media player:`, error);
      }
    }
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

    // Shutdown stream player
    const streamPlayer = StreamPlayerManager.getInstance();
    await streamPlayer.shutdown();

    // Cleanup voice assistant (stops Whisper server)
    if (this.voiceAssistant) {
      await this.voiceAssistant.cleanup();
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
