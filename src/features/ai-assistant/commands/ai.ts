import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../../../config";
import { AIManager } from "../AIManager";
import type { Command } from "../../../types";
import { startSession } from "../ChatSessionManager";

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

interface StructuredContent {
  description?: string;
  fields: DiscordField[];
}

function normalizeBullets(text: string): string {
  // Replace various bullet styles with consistent filled bullet (•)
  return text
    .replace(/^[\s]*[o○◦‣⁃▪▫‥][\s]*/gm, "• ") // Replace unfilled bullets
    .replace(/^[\s]*[-–—][\s]*/gm, "• ") // Replace dashes
    .replace(/^[\s]*[∗][\s]*/gm, "• ") // Replace asterisk bullets
    .replace(/^[\s]*[→][\s]*/gm, "• ") // Replace arrow bullets
    .replace(/^[\s]*[▪][\s]*/gm, "• ") // Replace square bullets
    .replace(/^[\s]*[▫][\s]*/gm, "• "); // Replace hollow square bullets
}

function parseContentForDiscord(content: string): StructuredContent {
  const lines = content.split("\n");
  const result: StructuredContent = {
    fields: [],
  };

  let currentField: DiscordField | null = null;
  const descriptionLines: string[] = [];
  let isInDescription = true;

  for (const line of lines) {
    const trimmedLine = normalizeBullets(line.trim());

    // Check if this is a bold header (potential field name)
    if (
      trimmedLine.startsWith("**") &&
      trimmedLine.endsWith("**") &&
      trimmedLine.length > 4
    ) {
      // Save previous field if exists
      if (currentField) {
        result.fields.push(currentField);
      }

      // Start new field
      const fieldName = trimmedLine.slice(2, -2); // Remove **
      currentField = {
        name: fieldName,
        value: "",
        inline: false,
      };
      isInDescription = false;
    }
    // Check if this is a bullet point or content line
    else if (
      trimmedLine.startsWith("•") ||
      (trimmedLine.length > 0 && !trimmedLine.startsWith("**"))
    ) {
      if (currentField) {
        // Add to current field
        if (currentField.value) {
          currentField.value += "\n";
        }
        currentField.value += trimmedLine;
      } else if (isInDescription) {
        // Add to description
        descriptionLines.push(trimmedLine);
      }
    }
    // Empty line - continue current context
    else if (trimmedLine === "") {
      if (currentField?.value) {
        currentField.value += "\n";
      } else if (isInDescription) {
        descriptionLines.push("");
      }
    }
  }

  // Save final field
  if (currentField) {
    result.fields.push(currentField);
  }

  // Set description if we have content
  if (descriptionLines.length > 0) {
    result.description = descriptionLines.join("\n").trim();
  }

  // If no fields were created but we have content, put it all in description
  if (result.fields.length === 0 && content.trim()) {
    result.description = content.trim();
  }

  return result;
}

let aiManager: AIManager | null = null;

// Initialize AIManager lazily
function getAIManager(): AIManager {
  if (!aiManager) {
    try {
      aiManager = AIManager.getInstance();
    } catch (error) {
      throw new Error(
        "🔸 AI service is not configured. Please add your API keys to the .env file:\n`GROK_API_KEY=your_api_key_here`\n\nGet your API key from: https://console.x.ai/"
      );
    }
  }
  return aiManager;
}

export const aiCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Interact with AI using different modes")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Choose the AI mode")
        .setRequired(true)
        .addChoices(
          { name: "Ask", value: "ask" },
          { name: "Imagine", value: "imagine" },
          { name: "Fact Check", value: "fact-check" },
          { name: "Source", value: "source" },
          { name: "Define", value: "define" },
          { name: "Context", value: "context" },
          { name: "Chat", value: "chat" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("Your prompt (or opening message for chat)")
        .setRequired(true)
        .setMaxLength(500)
    )
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription("Optional persona or style for chat mode")
        .setRequired(false)
        .setMaxLength(500)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member;
    if (!member || !interaction.guild) {
      await interaction.reply({
        content: "🔸 This command can only be used in a server!",
        ephemeral: true,
      });
      return;
    }

    // Check if any AI API key is configured
    if (!config.grokApiKey && !config.openaiApiKey && !config.geminiApiKey) {
      await interaction.reply({
        content:
          "🔸 AI service is not configured. Please add at least one API key to the .env file:\n`GROK_API_KEY=your_api_key_here`\n`OPENAI_API_KEY=your_api_key_here`\n`GEMINI_API_KEY=your_api_key_here`",
        ephemeral: true,
      });
      return;
    }

    const mode = interaction.options.getString("mode", true);
    const prompt = interaction.options.getString("prompt", true);
    const persona = interaction.options.getString("persona") || undefined;

    // Defer reply since AI requests can take time
    await interaction.deferReply();

    try {
      const manager = getAIManager();
      const userId = interaction.user.id;

      let response: any;
      let title: string;
      let color: number;
      let provider: string;

      switch (mode) {
        case "ask": {
          provider = "grok"; // Can be changed to "openai" or "gemini" later
          response = await manager.generateText(prompt, userId, provider);
          title = `Ask: *${prompt}*`;
          color = 0x3c3d7d; // Same as starboard
          break;
        }
        case "imagine": {
          provider = "grok"; // Can be changed to "openai" later
          response = await manager.generateImage(prompt, userId, provider);
          title = `Imagine: *${prompt}*`;
          color = 0x3c3d7d; // Same as starboard
          break;
        }
        case "fact-check": {
          provider = "grok"; // Can be changed to "openai" or "gemini" later
          response = await manager.factCheck(prompt, userId, provider);
          title = `Fact Check: *${prompt}*`;
          color = 0x3c3d7d; // Same as starboard
          break;
        }
        case "source": {
          provider = "grok"; // Can be changed to "openai" or "gemini" later
          response = await manager.citeSources(prompt, userId, provider);
          title = `Source: *${prompt}*`;
          color = 0x3c3d7d; // Same as starboard
          break;
        }
        case "define": {
          provider = "grok"; // Can be changed to "openai" or "gemini" later
          response = await manager.defineTerm(prompt, userId, provider);
          title = `Define: *${prompt}*`;
          color = 0x3c3d7d; // Same as starboard
          break;
        }
        case "context": {
          provider = "grok"; // Can be changed to "openai" or "gemini" later
          response = await manager.provideContext(prompt, userId, provider);
          title = `Context: *${prompt}*`;
          color = 0x3c3d7d; // Same as starboard
          break;
        }
        case "chat": {
          provider = "grok";

          // Short, conversational system prompt layer
          const chatStyle =
            "You are a friendly, concise Discord chat companion. Keep replies brief (1-2 sentences), natural, and conversational. Avoid long lists or formal tone.";

          // Use existing pipeline for now (no native history); persona is treated as part of method prompt
          const methodPrompt = persona
            ? `${chatStyle}\nPersona: ${persona}`
            : chatStyle;

          // Use public API for stability
          response = await manager.generateText(
            `${methodPrompt}\n${prompt}`,
            userId,
            provider
          );

          title = `Chat: *${prompt}*`;
          color = 0x3c3d7d;
          break;
        }
        default: {
          await interaction.editReply({
            content: "🔸 Invalid AI mode specified!",
          });
          return;
        }
      }

      if (!response || response.success !== true) {
        await interaction.editReply({
          content: `🔸 ${
            response?.error ||
            "An error occurred while processing your AI request."
          }`,
        });
        return;
      }

      // Get rate limit info for footer
      const rateLimitInfo = manager.getRateLimitInfo(userId, provider);
      const resetTime =
        rateLimitInfo.resetTime > 0
          ? new Date(rateLimitInfo.resetTime).toLocaleTimeString()
          : "Now";

      // Get model name for footer
      const modelName = manager.getProviderModelName(provider);

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setFooter({
          text: `Generated with ${modelName}\nRate limit: ${
            rateLimitInfo.remaining
          } remaining | Resets at: ${resetTime}\nToday at ${new Date().toLocaleTimeString()}`,
        })
        .setTimestamp();

      // Parse and structure content for Discord embeds
      if (mode !== "imagine") {
        const structuredContent = parseContentForDiscord(
          response.content || ""
        );

        if (structuredContent.description) {
          embed.setDescription(structuredContent.description);
        }

        // Add fields for better organization
        for (const field of structuredContent.fields) {
          embed.addFields({
            name: field.name,
            value: field.value,
            inline: field.inline || false,
          });
        }
      }

      // Add image if available (prefer attachment to avoid URL expiry)
      let files: AttachmentBuilder[] | undefined;
      if (response.imageBuffer && response.imageFilename) {
        const attachment = new AttachmentBuilder(response.imageBuffer, {
          name: response.imageFilename,
        });
        files = [attachment];
        embed.setImage(`attachment://${response.imageFilename}`);
      } else if (response.imageUrl) {
        embed.setImage(response.imageUrl);
      }

      const replyOptions: {
        embeds: EmbedBuilder[];
        files?: AttachmentBuilder[];
      } = { embeds: [embed] };
      if (files) {
        replyOptions.files = files;
      }

      const reply = await interaction.editReply(replyOptions);

      // If this is a chat, start a tracked session for replies
      if (mode === "chat") {
        try {
          const repliedMessage = await interaction.fetchReply();
          startSession({
            initialBotMessage: repliedMessage,
            userId: interaction.user.id,
            persona,
            initialUserMessage: prompt,
            initialAssistantMessage: response.content || "",
          });
        } catch {}
      }
    } catch (error) {
      console.error("🔸 Error in AI command:", error);
      await interaction.editReply({
        content:
          "🔸 An error occurred while processing your AI request. Please try again later.",
      });
    }
  },
};
