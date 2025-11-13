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
import { DatabaseHealer } from "./features/guild-sync/DatabaseHealer";
import { LiveSyncWatcher } from "./features/guild-sync/LiveSyncWatcher";
import { RelationshipNetworkManager } from "./features/relationship-network/NetworkManager";
import { ConversationManager } from "./features/relationship-network/ConversationManager";
import {
  getSessionByRepliedMessageId,
  appendUserTurn,
  appendAssistantTurnAndTrackMessage,
  getSessionHistory,
  startSession,
} from "./features/ai-assistant/ChatSessionManager";
import { resolveMentionsInText } from "./features/ai-assistant/utils/MentionResolver";

export class Bot {
  public client: Client;
  public commands = new Collection<string, Command>();
  public postgresManager: PostgreSQLManager;
  private databaseHealer?: DatabaseHealer;
  private liveSyncWatcher?: LiveSyncWatcher;
  private relationshipManager?: RelationshipNetworkManager;
  private conversationManager?: ConversationManager;

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
      console.log(`🔹 Logged in as ${this.client.user?.tag}`);

      // Initialize realtime sync components
      this.relationshipManager = new RelationshipNetworkManager(
        this.postgresManager
      );
      this.conversationManager = new ConversationManager(this.postgresManager);
      if (config.enableTopicSplitting) {
        const aiManager = AIManager.getInstance();
        this.conversationManager.setAIManager(aiManager);
      } else {
        console.log(
          "🔸 ENABLE_TOPIC_SPLITTING is disabled; conversations will not be split by Gemini."
        );
      }

      // Start database healer and maintenance
      this.databaseHealer = new DatabaseHealer(
        this.client,
        this.postgresManager,
        this.relationshipManager,
        false // Set to true for verbose logging
      );
      this.databaseHealer.startMaintenance();

      // Start live sync watcher
      this.liveSyncWatcher = new LiveSyncWatcher(
        this.client,
        this.postgresManager,
        this.relationshipManager,
        this.conversationManager
      );
      this.liveSyncWatcher.start();

      // Load active conversations for guilds (filtered by config.guildId if set)
      const guilds = this.client.guilds.cache;
      if (config.guildId) {
        const targetGuild = guilds.get(config.guildId);
        if (targetGuild) {
          console.log(
            `🔹 Limiting sync to guild: ${targetGuild.name} (${config.guildId})`
          );
          await this.conversationManager!.loadActiveConversations(
            targetGuild.id
          );
        } else {
          console.log(
            `🔸 Warning: Guild ID ${config.guildId} not found in cache`
          );
        }
      } else {
        for (const [, guild] of guilds) {
          await this.conversationManager!.loadActiveConversations(guild.id);
        }
      }

      // Start periodic cleanup of stale conversations (every 15 minutes)
      setInterval(async () => {
        if (config.guildId) {
          const targetGuild = this.client.guilds.cache.get(config.guildId);
          if (targetGuild) {
            await this.conversationManager!.cleanupStaleConversations(
              targetGuild.id
            );
          }
        } else {
          for (const [, guild] of this.client.guilds.cache) {
            await this.conversationManager!.cleanupStaleConversations(guild.id);
          }
        }
      }, 15 * 60 * 1000);

      // Periodically flush inactive buffers to ensure conversations finalize in real-time
      setInterval(async () => {
        try {
          await this.conversationManager?.flushInactiveBuffers();
        } catch (error) {
          console.error("🔸 Failed to flush inactive conversation buffers:", error);
        }
      }, 2 * 60 * 1000);

      // Start periodic semantic merging of related conversations (every hour)
      setInterval(async () => {
        if (config.guildId) {
          const targetGuild = this.client.guilds.cache.get(config.guildId);
          if (targetGuild) {
            await this.conversationManager!.runSemanticMergingForGuild(
              targetGuild.id
            );
          }
        } else {
          for (const [, guild] of this.client.guilds.cache) {
            await this.conversationManager!.runSemanticMergingForGuild(
              guild.id
            );
          }
        }
      }, 60 * 60 * 1000);

      // Run initial healing pass (after main functionality is started)
      await this.databaseHealer.runOnce();
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

        // Prevent mass-mention pings from bot output (usable in all branches)
        const sanitizeEveryone = (input: string | undefined | null): string => {
          if (!input) return "";
          return input.replace(/@everyone/gi, "@\u200Beveryone");
        };

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

          // Helper to split and send long messages safely under Discord's 2000-char limit
          const sendChunked = async (
            text: string
          ): Promise<{ message: any; sentText: string }> => {
            const limit = 1900; // leave headroom for safety
            const chunks: string[] = [];
            let remaining = text;
            while (remaining.length > limit) {
              // Try to split on paragraph, sentence, or newline boundaries
              let idx = Math.max(
                remaining.lastIndexOf("\n\n", limit),
                remaining.lastIndexOf("\n", limit),
                remaining.lastIndexOf(". ", limit)
              );
              if (idx < limit * 0.6) idx = limit; // fallback to hard split
              chunks.push(remaining.slice(0, idx).trim());
              remaining = remaining.slice(idx).trimStart();
            }
            if (remaining.length) chunks.push(remaining);
            let lastMessage = message as any;
            const sentParts: string[] = [];
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              try {
                if (i === 0) {
                  // First chunk: reply to the user's message to start the thread
                  lastMessage = await lastMessage.reply({
                    content: sanitizeEveryone(chunk),
                    allowedMentions: {
                      parse: ["users", "roles"],
                      repliedUser: false,
                    },
                  });
                } else {
                  // Subsequent chunks: send to channel to avoid stale message_reference errors
                  lastMessage = await (message.channel as any).send({
                    content: sanitizeEveryone(chunk),
                    allowedMentions: {
                      parse: ["users", "roles"],
                      repliedUser: false,
                    },
                  });
                }
              } catch (err: any) {
                // Fallback: if replying failed due to unknown message reference, send to channel
                lastMessage = await (message.channel as any).send({
                  content: sanitizeEveryone(chunk),
                  allowedMentions: {
                    parse: ["users", "roles"],
                    repliedUser: false,
                  },
                });
              }
              sentParts.push(
                (lastMessage as any).content || sanitizeEveryone(chunk)
              );
            }
            return { message: lastMessage, sentText: sentParts.join("\n\n") };
          };

          await manager.runWithGuildContext(message.guildId, async () => {
            const contentResponse = await manager.generateText(
              rawForAI,
              message.author.id,
              provider,
              {
                persona: "casual",
                useDiscordFormatting: false,
                mode: "chat",
                channelId: message.channel.id,
                messageId: message.id,
              }
            );

            if (!contentResponse?.success || !contentResponse.content) {
              console.error(
                "🔸 Failed to generate response for bot mention:",
                contentResponse?.error
              );
              return;
            }

            // Send response using chunking (handles long responses automatically)
            const { message: reply, sentText } = await sendChunked(
              contentResponse.content
            );

            // Start a new chat session, storing exactly what was sent
            startSession({
              initialBotMessage: reply,
              userId: message.author.id,
              initialUserMessage: resolvedContent,
              initialAssistantMessage: sentText,
            });
          });

          return;
        }

        // Continue existing chat sessions when users reply to bot messages
        const refId = message.reference?.messageId;
        if (!refId) return;

        const found = getSessionByRepliedMessageId(refId);
        if (!found) return;

        // Ignore replies with no meaningful text (attachments only or mentions only)
        const rawReplyText = (message.content || "").trim();
        if (!rawReplyText) return;
        const textWithoutUserMentions = rawReplyText.replace(/<@!?\d+>/g, "");
        if (textWithoutUserMentions.trim().length === 0) return;

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
              mode: "chat",
              channelId: message.channel.id,
              messageId: message.id,
            }
          );

          if (!contentResponse?.success || !contentResponse.content) return;

          // Append user's turn to session (store resolved version)
          appendUserTurn(found.sessionId, resolvedContent);

          // Helper to split and send long reply messages (reuse chunking logic)
          const sendReplyChunked = async (
            text: string
          ): Promise<{ message: any; sentText: string }> => {
            const limit = 1900;
            const chunks: string[] = [];
            let remaining = text;
            while (remaining.length > limit) {
              let idx = Math.max(
                remaining.lastIndexOf("\n\n", limit),
                remaining.lastIndexOf("\n", limit),
                remaining.lastIndexOf(". ", limit)
              );
              if (idx < limit * 0.6) idx = limit;
              chunks.push(remaining.slice(0, idx).trim());
              remaining = remaining.slice(idx).trimStart();
            }
            if (remaining.length) chunks.push(remaining);
            let lastMessage = message as any;
            const sentParts: string[] = [];
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              try {
                if (i === 0) {
                  lastMessage = await lastMessage.reply({
                    content: sanitizeEveryone(chunk),
                    allowedMentions: {
                      parse: ["users", "roles"],
                      repliedUser: false,
                    },
                  });
                } else {
                  lastMessage = await (message.channel as any).send({
                    content: sanitizeEveryone(chunk),
                    allowedMentions: {
                      parse: ["users", "roles"],
                      repliedUser: false,
                    },
                  });
                }
              } catch (err: any) {
                lastMessage = await (message.channel as any).send({
                  content: sanitizeEveryone(chunk),
                  allowedMentions: {
                    parse: ["users", "roles"],
                    repliedUser: false,
                  },
                });
              }
              sentParts.push(
                (lastMessage as any).content || sanitizeEveryone(chunk)
              );
            }
            return { message: lastMessage, sentText: sentParts.join("\n\n") };
          };

          // Send response using chunking (handles long responses automatically)
          const { message: reply, sentText } = await sendReplyChunked(
            contentResponse.content
          );

          // Store exactly what was sent in session history
          appendAssistantTurnAndTrackMessage(found.sessionId, reply, sentText);
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

    // Finalize all active conversations
    if (this.conversationManager) {
      await this.conversationManager.finalizeAllSegments();
    }

    // Stop live sync watcher
    if (this.liveSyncWatcher) {
      await this.liveSyncWatcher.stop();
    }

    // Immediately destroy Discord client to stop all Discord operations
    this.client.destroy();

    // Disconnect from PostgreSQL
    if (this.postgresManager.isConnected()) {
      await this.postgresManager.disconnect();
    }
  }
}
