/**
 * MessageHandler
 *
 * Handles all Discord message events for the AI assistant feature.
 * Manages bot mentions, chat sessions, and message responses.
 */

import type { Client, Message } from "discord.js";
import type { PostgreSQLManager } from "../../database/PostgreSQLManager";
import { AIManager } from "./AIManager";
import {
  getSessionByRepliedMessageId,
  appendUserTurn,
  appendAssistantTurnAndTrackMessage,
  getSessionHistory,
  startSession,
} from "./ChatSessionManager";
import { resolveMentionsInText } from "./utils/MentionResolver";

export class MessageHandler {
  private client: Client;
  private db: PostgreSQLManager;
  private provider: string;

  constructor(client: Client, db: PostgreSQLManager, provider = "grok") {
    this.client = client;
    this.db = db;
    this.provider = provider;
  }

  /**
   * Handle incoming Discord messages
   */
  async handleMessage(message: Message): Promise<void> {
    try {
      // Ignore bot messages and DMs
      if (message.author.bot || !message.guildId) {
        return;
      }

      const botUserId = this.client.user?.id;
      if (!botUserId) {
        console.log("🔸 Bot user ID not available yet");
        return;
      }

      // Check if bot is mentioned (not a reply)
      const isBotMentioned = this.isBotMentioned(message, botUserId);

      if (isBotMentioned) {
        await this.handleBotMention(message, botUserId);
        return;
      }

      // Handle chat session continuation (replies to bot messages)
      const refId = message.reference?.messageId;
      if (refId) {
        await this.handleSessionContinuation(message, refId);
      }
    } catch (err) {
      // Log errors but don't send to channel to avoid spam
      console.error("🔸 Error in message handler:", err);
    }
  }

  /**
   * Check if the bot is mentioned in a message (excluding replies)
   */
  private isBotMentioned(message: Message, botUserId: string): boolean {
    // Check both mentions.users and message content for mention patterns
    const isBotMentionedInUsers = message.mentions.users.has(botUserId);
    const mentionPattern = new RegExp(`<@!?${botUserId}>`);
    const isBotMentionedInContent = mentionPattern.test(message.content);

    // Only consider it a mention if it's not a reply
    return (
      (isBotMentionedInUsers || isBotMentionedInContent) && !message.reference
    );
  }

  /**
   * Handle bot mention - start a new conversation
   */
  private async handleBotMention(
    message: Message,
    botUserId: string
  ): Promise<void> {
    // Extract message content without the mention
    let userContent = message.content
      .replace(new RegExp(`<@!?${botUserId}>`, "g"), "")
      .trim();

    // If empty after removing mention, use a default prompt
    if (!userContent) {
      userContent = "Hello!";
    }

    // Map self-referential queries to explicit self-mention
    userContent = this.mapSelfReferentialQuery(userContent, message.author.id);

    // For AI, keep the raw content (with <@id> intact) so tools can extract IDs reliably
    const rawForAI = userContent;

    // Optionally resolve mentions for display/session context only
    let resolvedContent = userContent;
    if (this.db.isConnected()) {
      try {
        resolvedContent = await resolveMentionsInText(
          userContent,
          message.guildId!,
          this.db
        );
      } catch (err) {
        console.error("🔸 Error resolving mentions:", err);
      }
    }

    const manager = AIManager.getInstance();
    await manager.runWithGuildContext(message.guildId!, async () => {
      const contentResponse = await manager.generateText(
        rawForAI,
        message.author.id,
        this.provider,
        {
          personaKey: "casual",
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
      const { message: reply, sentText } = await this.sendChunked(
        message,
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
  }

  /**
   * Handle continuation of existing chat session
   */
  private async handleSessionContinuation(
    message: Message,
    refId: string
  ): Promise<void> {
    const found = getSessionByRepliedMessageId(refId);
    if (!found) {
      return;
    }

    // Ignore replies with no meaningful text
    const rawReplyText = (message.content || "").trim();
    if (!rawReplyText) {
      return;
    }

    const textWithoutUserMentions = rawReplyText.replace(/<@!?\d+>/g, "");
    if (textWithoutUserMentions.trim().length === 0) {
      return;
    }

    // Resolve mentions in user message
    let resolvedContent = message.content;
    resolvedContent = this.mapSelfReferentialQuery(
      resolvedContent,
      message.author.id
    );

    const rawForAI = resolvedContent; // keep raw (with <@id>) for AI

    if (this.db.isConnected()) {
      try {
        resolvedContent = await resolveMentionsInText(
          message.content,
          message.guildId!,
          this.db
        );
      } catch (err) {
        console.error("🔸 Error resolving mentions in reply:", err);
      }
    }

    // Get session history for context
    const history = getSessionHistory(found.sessionId);

    const manager = AIManager.getInstance();
    await manager.runWithGuildContext(message.guildId!, async () => {
      const contentResponse = await manager.generateText(
        rawForAI,
        message.author.id,
        this.provider,
        {
          personaKey: "casual",
          history,
          useDiscordFormatting: false,
          mode: "chat",
          channelId: message.channel.id,
          messageId: message.id,
        }
      );

      if (!contentResponse?.success || !contentResponse.content) {
        return;
      }

      // Append user's turn to session (store resolved version)
      appendUserTurn(found.sessionId, resolvedContent);

      // Send response using chunking
      const { message: reply, sentText } = await this.sendChunked(
        message,
        contentResponse.content
      );

      // Store exactly what was sent in session history
      appendAssistantTurnAndTrackMessage(found.sessionId, reply, sentText);
    });
  }

  /**
   * Map self-referential queries to explicit user mentions
   */
  private mapSelfReferentialQuery(content: string, userId: string): string {
    const selfQueryRegex =
      /(who\s+am\s+i\b|whoami\b|tell\s+me\s+about\s+me\b|what\s+do\s+you\s+know\s+about\s+me\b|who\s+is\s+me\b)/i;

    if (selfQueryRegex.test(content)) {
      return `tell me about <@${userId}>`;
    }

    return content;
  }

  /**
   * Split and send long messages safely under Discord's 2000-char limit
   */
  private async sendChunked(
    message: Message,
    text: string
  ): Promise<{ message: any; sentText: string }> {
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

      if (idx < limit * 0.6) {
        idx = limit; // fallback to hard split
      }

      chunks.push(remaining.slice(0, idx).trim());
      remaining = remaining.slice(idx).trimStart();
    }

    if (remaining.length) {
      chunks.push(remaining);
    }

    let lastMessage = message as any;
    const sentParts: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      try {
        if (i === 0) {
          // First chunk: reply to the user's message to start the thread
          lastMessage = await lastMessage.reply({
            content: this.sanitizeEveryone(chunk),
            allowedMentions: {
              parse: ["users", "roles"],
              repliedUser: false,
            },
          });
        } else {
          // Subsequent chunks: send to channel to avoid stale message_reference errors
          lastMessage = await (message.channel as any).send({
            content: this.sanitizeEveryone(chunk),
            allowedMentions: {
              parse: ["users", "roles"],
              repliedUser: false,
            },
          });
        }
      } catch (err: any) {
        // Fallback: if replying failed, send to channel
        lastMessage = await (message.channel as any).send({
          content: this.sanitizeEveryone(chunk),
          allowedMentions: {
            parse: ["users", "roles"],
            repliedUser: false,
          },
        });
      }

      sentParts.push(
        (lastMessage as any).content || this.sanitizeEveryone(chunk)
      );
    }

    return { message: lastMessage, sentText: sentParts.join("\n\n") };
  }

  /**
   * Prevent mass-mention pings from bot output
   */
  private sanitizeEveryone(input: string | undefined | null): string {
    if (!input) return "";
    return input.replace(/@everyone/gi, "@\u200Beveryone");
  }
}
