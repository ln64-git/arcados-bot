import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import axios from "axios";
import { config } from "../../config";
import { BaseAIProvider } from "./base/BaseAIProvider";
import type { ToolCall, ToolCallResponse } from "./base/AIProvider";

export class GrokProvider extends BaseAIProvider {
  private xai: ReturnType<typeof createOpenAI>;
  private modelName = "grok-4-1-fast-non-reasoning"; // Grok 4.1 fast non-reasoning model

  constructor() {
    super(5); // 5 requests per minute
    if (!config.grokApiKey) {
      throw new Error(
        "Grok API key is not configured in environment variables"
      );
    }

    // Create X.AI provider using Vercel AI SDK
    this.xai = createOpenAI({
      apiKey: config.grokApiKey,
      baseURL: "https://api.x.ai/v1",
    });
  }

  getProviderName(): string {
    return "grok";
  }

  getModelName(): string {
    return "Grok-4.1-Fast";
  }

  // Basic text generation without tools
  async callTextAPI(systemPrompt: string, userPrompt: string): Promise<string> {
    const result = await generateText({
      model: this.xai(this.modelName),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.7,
    });

    return result.text;
  }

  // Tool calling support using Vercel AI SDK
  override async callTextAPIWithTools(
    systemPrompt: string,
    userPrompt: string,
    tools: Array<{ name: string; description: string; parameters: any }>,
    _toolResults?: ToolCallResponse[],
    runtimeConfig?: { maxTokens?: number; temperature?: number }
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const inputMessages = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ];

    const serverSideTools: Array<
      | { type: "web_search"; filters?: Record<string, unknown> }
      | { type: "x_search"; filters?: Record<string, unknown> }
    > = [];

    if (config.grokEnableWebSearch) {
      serverSideTools.push({ type: "web_search" });
    }

    if (config.grokEnableXSearch) {
      serverSideTools.push({ type: "x_search" });
    }

    const functionTools =
      tools.length > 0
        ? tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          }))
        : [];

    const toolPayload =
      serverSideTools.length > 0 || functionTools.length > 0
        ? [...serverSideTools, ...functionTools]
        : undefined;

    try {
      const response = await axios.post(
        "https://api.x.ai/v1/responses",
        {
          model: this.modelName,
          input: inputMessages,
          temperature: runtimeConfig?.temperature ?? 0.7,
          max_output_tokens: runtimeConfig?.maxTokens,
          tools: toolPayload,
          response_mode: "blocking",
        },
        {
          headers: {
            Authorization: `Bearer ${config.grokApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const rawOutput =
        response.data?.output ||
        response.data?.response?.output ||
        response.data?.response?.output_text ||
        [];

      const toolCalls: ToolCall[] = [];
      let finalText = "";

      const outputArray = Array.isArray(rawOutput) ? rawOutput : [rawOutput];

      for (const entry of outputArray) {
        const contentParts = entry?.content;
        if (Array.isArray(contentParts)) {
          for (const part of contentParts) {
            if (
              part?.type === "output_text" ||
              part?.type === "text" ||
              typeof part === "string"
            ) {
              const textValue =
                typeof part === "string" ? part : part.text || part.value || "";
              if (textValue) {
                finalText += (finalText ? "\n" : "") + textValue;
              }
            } else if (part?.type === "tool_call") {
              const argsRaw =
                part.arguments ??
                part.argument ??
                part.input ??
                part.tool_input ??
                {};
              let parsedArgs: Record<string, any> = {};
              if (typeof argsRaw === "string") {
                try {
                  parsedArgs = JSON.parse(argsRaw);
                } catch {
                  parsedArgs = {};
                }
              } else if (typeof argsRaw === "object" && argsRaw !== null) {
                parsedArgs = argsRaw;
              }

              toolCalls.push({
                id: part.tool_call_id || part.id || part.name || "tool-call",
                name: part.name || part.tool_name || "unknown_tool",
                arguments: parsedArgs,
              });
            }
          }
        } else if (typeof entry === "string") {
          finalText += (finalText ? "\n" : "") + entry;
        }
      }

      return {
        content: finalText.trim(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error: any) {
      console.error("🔸 GrokProvider: chat completion failed:", error);
      throw error;
    }
  }

  // Only handle the actual API call - no AI logic here
  async callImageAPI(prompt: string): Promise<{ url: string; buffer: Buffer }> {
    const response = await axios.post(
      "https://api.x.ai/v1/images/generations",
      {
        model: "grok-2-image",
        prompt: prompt,
        n: 1,
        response_format: "url",
      },
      {
        headers: {
          Authorization: `Bearer ${config.grokApiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const imageUrl = response.data.data[0].url;

    // Download the image so we can attach it directly to Discord (avoids URL expiry)
    const imageDownload = await axios.get(imageUrl, {
      responseType: "arraybuffer",
    });
    const imageBuffer = Buffer.from(imageDownload.data);

    return { url: imageUrl, buffer: imageBuffer };
  }
}
