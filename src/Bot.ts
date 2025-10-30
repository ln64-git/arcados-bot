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
  getSessionHistory,
  startSession,
} from "./features/ai-assistant/ChatSessionManager";
import { resolveMentionsInText } from "./features/ai-assistant/utils/MentionResolver";

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

    // Handle bot mentions and continue chat sessions when users reply to bot messages
    this.client.on("messageCreate", async (message) => {
      try {
        // Ignore bot messages
        if (message.author.bot) return;

        if (!message.guildId) return;

        const manager = AIManager.getInstance();
        const provider = "grok"; // default provider for chat
        const botUserId = this.client.user?.id;

        if (!botUserId) {
          console.log("🔸 Bot user ID not available yet");
          return;
        }

        // Check if bot is mentioned (not a reply, just a mention in content)
        // Check both mentions.users and the message content for mention patterns
        const isBotMentionedInUsers = message.mentions.users.has(botUserId);
        const mentionPattern = new RegExp(`<@!?${botUserId}>`);
        const isBotMentionedInContent = mentionPattern.test(message.content);
        const isBotMentioned =
          (isBotMentionedInUsers || isBotMentionedInContent) &&
          !message.reference;

        // Debug logging (can be removed later)
        if (isBotMentionedInUsers || isBotMentionedInContent) {
          console.log(
            `🔹 Bot mention detected: users=${isBotMentionedInUsers}, content=${isBotMentionedInContent}, isReply=${!!message.reference}, willHandle=${isBotMentioned}`
          );
        }

        if (isBotMentioned) {
          // Extract message content without the mention
          let userContent = message.content
            .replace(new RegExp(`<@!?${botUserId}>`, "g"), "")
            .trim();

          // If empty after removing mention, use a default prompt
          if (!userContent) {
            userContent = "Hello!";
          }

          // Map self-referential queries to an explicit self-mention so tools can resolve the user
          const selfQueryRegex =
            /(who\s+am\s+i\b|whoami\b|tell\s+me\s+about\s+me\b|what\s+do\s+you\s+know\s+about\s+me\b|who\s+is\s+me\b)/i;
          if (selfQueryRegex.test(userContent)) {
            userContent = `tell me about <@${message.author.id}>`;
          }

          // For AI, keep the raw content (with <@id> intact) so tools can extract IDs reliably
          const rawForAI = userContent;

          // Optionally resolve mentions for display/session context only
          let resolvedContent = userContent;
          if (this.postgresManager.isConnected()) {
            try {
              resolvedContent = await resolveMentionsInText(
                userContent,
                message.guildId,
                this.postgresManager
              );
            } catch (err) {
              console.error("🔸 Error resolving mentions:", err);
            }
          }

          // Generate response with guild context
          await manager.runWithGuildContext(message.guildId, async () => {
            const contentResponse = await manager.generateText(
              rawForAI,
              message.author.id,
              provider,
              { persona: "casual", useDiscordFormatting: false }
            );

            if (!contentResponse?.success || !contentResponse.content) {
              console.error(
                "🔸 Failed to generate response for bot mention:",
                contentResponse?.error
              );
              return;
            }

            // Send response and start new session
            const reply = await message.reply({
              content: contentResponse.content,
            });

            // Start a new chat session
            startSession({
              initialBotMessage: reply,
              userId: message.author.id,
              initialUserMessage: resolvedContent,
              initialAssistantMessage: contentResponse.content,
            });
          });

          return;
        }

        // Continue existing chat sessions when users reply to bot messages
        const refId = message.reference?.messageId;
        if (!refId) return;

        const found = getSessionByRepliedMessageId(refId);
        if (!found) return;

        // Resolve mentions in user message
        let resolvedContent = message.content;
        // Map self-referential queries to an explicit self-mention so tools can resolve the user
        const selfQueryRegex =
          /(who\s+am\s+i\b|whoami\b|tell\s+me\s+about\s+me\b|what\s+do\s+you\s+know\s+about\s+me\b|who\s+is\s+me\b)/i;
        if (selfQueryRegex.test(resolvedContent)) {
          resolvedContent = `tell me about <@${message.author.id}>`;
        }
        const rawForAI = resolvedContent; // keep raw (with <@id>) for AI
        if (this.postgresManager.isConnected()) {
          try {
            resolvedContent = await resolveMentionsInText(
              message.content,
              message.guildId,
              this.postgresManager
            );
          } catch (err) {
            console.error("🔸 Error resolving mentions in reply:", err);
          }
        }

        // Get session history for context
        const history = getSessionHistory(found.sessionId);

        // Use tool-enabled generation with history context
        await manager.runWithGuildContext(message.guildId, async () => {
          const contentResponse = await manager.generateText(
            rawForAI,
            message.author.id,
            provider,
            {
              persona: "casual",
              history,
              useDiscordFormatting: false,
            }
          );

          if (!contentResponse?.success || !contentResponse.content) return;

          // Append user's turn to session (store resolved version)
          appendUserTurn(found.sessionId, resolvedContent);

          const reply = await message.reply({
            content: contentResponse.content,
          });
          appendAssistantTurnAndTrackMessage(
            found.sessionId,
            reply,
            contentResponse.content
          );
        });
      } catch (err) {
        // Log errors but don't send to channel to avoid spam
        console.error("🔸 Error in messageCreate handler:", err);
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
