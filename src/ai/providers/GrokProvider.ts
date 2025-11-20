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
    toolResults?: ToolCallResponse[],
    runtimeConfig?: { maxTokens?: number; temperature?: number }
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    try {
      if (toolResults && toolResults.length > 0) {
        return await this.submitToolOutputs(
          toolResults,
          systemPrompt,
          userPrompt
        );
      }

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

      return this.parseResponsePayload(response.data);
    } catch (error: any) {
      console.error("🔸 GrokProvider: chat completion failed:", error);
      throw error;
    }
  }

  private async submitToolOutputs(
    toolResults: ToolCallResponse[],
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const grouped = new Map<
      string,
      Array<{ tool_call_id: string; output: string }>
    >();

    for (const result of toolResults) {
      const [responseId, callId] = result.toolCallId.split("|", 2);
      if (!responseId || !callId) {
        console.warn(
          "🔸 GrokProvider: malformed toolCallId",
          result.toolCallId
        );
        continue;
      }

      if (!grouped.has(responseId)) {
        grouped.set(responseId, []);
      }
      grouped.get(responseId)!.push({
        tool_call_id: callId,
        output: result.content,
      });
    }

    let latestResponse: any = null;
    for (const [responseId, outputs] of grouped.entries()) {
      if (outputs.length === 0) continue;

      const toolMessages = outputs.map((output) => ({
        role: "tool",
        tool_call_id: output.tool_call_id,
        content: output.output,
      }));

      // Include full conversation context when continuing
      const fullInput = [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
        ...toolMessages,
      ];

      const res = await axios.post(
        "https://api.x.ai/v1/responses",
        {
          model: this.modelName,
          response_id: responseId,
          input: fullInput,
          response_mode: "blocking",
        },
        {
          headers: {
            Authorization: `Bearer ${config.grokApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      latestResponse = res.data;
    }

    if (!latestResponse) {
      return { content: "" };
    }

    return this.parseResponsePayload(latestResponse);
  }

  private parseResponsePayload(data: any): {
    content: string;
    toolCalls?: ToolCall[];
  } {
    if (!data) {
      return { content: "" };
    }

    const responseId: string | undefined = data.id;
    const rawOutput =
      data.output || data.response?.output || data.response?.output_text || [];
    const outputArray = Array.isArray(rawOutput) ? rawOutput : [rawOutput];

    const toolCalls: ToolCall[] = [];
    let finalText = "";

    const appendText = (text?: string) => {
      if (text && text.trim()) {
        finalText += (finalText ? "\n" : "") + text.trim();
      }
    };

    const handleToolCallEntry = (entry: any) => {
      const callId = entry?.call_id || entry?.tool_call_id || entry?.id;
      if (!callId || !responseId) return;

      let argsRaw =
        entry?.arguments ??
        entry?.argument ??
        entry?.input ??
        entry?.tool_input;
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
        id: `${responseId}|${callId}`,
        name: entry?.name || entry?.tool_name || "unknown_tool",
        arguments: parsedArgs,
      });
    };

    for (const entry of outputArray) {
      if (!entry) continue;

      if (
        entry.type === "function_call" ||
        entry.type === "tool_call" ||
        entry.kind === "function_call"
      ) {
        handleToolCallEntry(entry);
        continue;
      }

      const contentParts = entry?.content;
      if (Array.isArray(contentParts)) {
        for (const part of contentParts) {
          if (
            part?.type === "output_text" ||
            part?.type === "text" ||
            typeof part === "string"
          ) {
            appendText(
              typeof part === "string"
                ? part
                : part.text || part.value || part.output_text
            );
          } else if (
            part?.type === "function_call" ||
            part?.type === "tool_call"
          ) {
            handleToolCallEntry(part);
          }
        }
      } else if (entry?.type === "output_text") {
        appendText(
          Array.isArray(entry.text) ? entry.text.join("\n") : entry.text
        );
      } else if (typeof entry === "string") {
        appendText(entry);
      }
    }

    // Check for text in the response object itself
    if (!finalText.trim() && data.text) {
      if (typeof data.text === "string") {
        finalText = data.text;
      } else if (data.text.content) {
        finalText = data.text.content;
      }
    }

    if (!finalText.trim()) {
      const fallbackText =
        data?.output_text ||
        data?.response?.output_text ||
        (Array.isArray(data?.output_text) ? data.output_text.join("\n") : "") ||
        (Array.isArray(data?.response?.output_text)
          ? data.response.output_text.join("\n")
          : "");
      if (fallbackText) {
        finalText = fallbackText;
      } else if (toolCalls.length === 0) {
        // Only warn if we have no text AND no tool calls (unexpected state)
        // If we have tool calls, empty text is expected - we'll get text after submitting tool outputs
        console.warn(
          "🔸 GrokProvider: empty response (no text, no tool calls)",
          `Response ID: ${data?.id || "unknown"}`
        );
      }
    }

    return {
      content: finalText.trim(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
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
