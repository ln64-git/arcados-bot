import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";
import axios from "axios";
import { config } from "../../config";
import { BaseAIProvider } from "./base/BaseAIProvider";
import type { ToolCall, ToolCallResponse } from "./base/AIProvider";
import { APICostTracker } from "../../utils/APICostTracker";

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
    const startTime = Date.now();
    const tracker = APICostTracker.getInstance();

    try {
      const result = await generateText({
        model: this.xai(this.modelName),
        system: systemPrompt,
        prompt: userPrompt,
        temperature: 0.7,
      });

      const latency = Date.now() - startTime;

      // Extract token counts from result (Vercel AI SDK format)
      // Usage object has promptTokens and completionTokens properties
      const usage = result.usage;
      const inputTokens = usage ? (usage as any).promptTokens || 0 : 0;
      const outputTokens = usage ? (usage as any).completionTokens || 0 : 0;

      tracker.trackRequest("grok", {
        endpoint: "callTextAPI",
        success: true,
        inputTokens,
        outputTokens,
        latency,
        additionalMetadata: {
          model: this.modelName,
        },
      });

      return result.text;
    } catch (error: any) {
      const latency = Date.now() - startTime;
      tracker.trackRequest("grok", {
        endpoint: "callTextAPI",
        success: false,
        error: error?.message || "Unknown error",
        latency,
        additionalMetadata: {
          model: this.modelName,
        },
      });
      throw error;
    }
  }

  // Streaming text generation for voice assistant
  async streamTextAPI(
    systemPrompt: string,
    userPrompt: string
  ): Promise<AsyncIterable<string>> {
    const startTime = Date.now();
    const tracker = APICostTracker.getInstance();

    try {
      const model = this.xai(this.modelName);

      const result = await streamText({
        model: model,
        system: systemPrompt,
        prompt: userPrompt,
        temperature: 0.7,
      });

      // Track streaming request (we'll update with final usage when stream completes)
      let inputTokens = 0;
      let outputTokens = 0;
      let streamError: Error | null = null;
      const modelName = this.modelName; // Capture for use in generator

      // Return async iterable that yields text deltas
      return (async function* () {
        try {
          if (!result.textStream) {
            // Try alternative stream properties
            if ("fullStream" in result && result.fullStream) {
              for await (const chunk of result.fullStream) {
                if (chunk.type === "text-delta" && (chunk as any).text) {
                  yield (chunk as any).text;
                }
              }
            }
            return;
          }

          for await (const delta of result.textStream) {
            yield delta;
          }

          // Extract final usage from result (usage is a promise in streaming)
          try {
            const usage = await result.usage;
            if (usage) {
              inputTokens = (usage as any).promptTokens || 0;
              outputTokens = (usage as any).completionTokens || 0;
            }
          } catch {
            // Usage not available, keep defaults
          }
        } catch (streamError_) {
          streamError = streamError_ as Error;
          console.error("[GrokProvider] Error iterating textStream:", streamError);
          throw streamError;
        } finally {
          // Track the request after stream completes
          const latency = Date.now() - startTime;
          tracker.trackRequest("grok", {
            endpoint: "streamTextAPI",
            success: !streamError,
            error: streamError?.message,
            inputTokens,
            outputTokens,
            latency,
            additionalMetadata: {
              model: modelName,
            },
          });
        }
      })();
    } catch (error: any) {
      const latency = Date.now() - startTime;
      tracker.trackRequest("grok", {
        endpoint: "streamTextAPI",
        success: false,
        error: error?.message || "Unknown error",
        latency,
        additionalMetadata: {
          model: this.modelName,
        },
      });
      console.error("[GrokProvider] Error in streamTextAPI:", error);
      // Return empty stream on error
      return (async function* () {
        yield "";
      })();
    }
  }

  // Tool calling support using Vercel AI SDK
  override async callTextAPIWithTools(
    systemPrompt: string,
    userPrompt: string,
    tools: Array<{ name: string; description: string; parameters: any }>,
    toolResults?: ToolCallResponse[],
    runtimeConfig?: {
      maxTokens?: number;
      temperature?: number;
      enableWebSearch?: boolean;
      enableXSearch?: boolean;
    }
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const startTime = Date.now();
    try {
      if (toolResults && toolResults.length > 0) {
        return await this.submitToolOutputs(
          toolResults,
          systemPrompt,
          userPrompt,
          startTime
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

      // Per-request control: runtimeConfig overrides global config
      const enableWebSearch =
        runtimeConfig?.enableWebSearch !== undefined
          ? runtimeConfig.enableWebSearch
          : config.grokEnableWebSearch;

      const enableXSearch =
        runtimeConfig?.enableXSearch !== undefined
          ? runtimeConfig.enableXSearch
          : config.grokEnableXSearch;

      if (enableWebSearch) {
        serverSideTools.push({ type: "web_search" });
      }

      if (enableXSearch) {
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

      const tracker = APICostTracker.getInstance();

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
          timeout: 30000, // 30 second timeout
        }
      );

      const latency = Date.now() - startTime;

      // Extract token counts from Grok response
      const usage = response.data?.usage;
      const inputTokens = usage?.input_tokens || usage?.inputTokens || 0;
      const outputTokens = usage?.output_tokens || usage?.outputTokens || 0;

      console.log(
        "[GrokProvider] Raw response data:",
        JSON.stringify(response.data, null, 2).substring(0, 2000)
      );

      // Track successful request
      tracker.trackRequest("grok", {
        endpoint: "callTextAPIWithTools",
        success: true,
        inputTokens,
        outputTokens,
        latency,
        additionalMetadata: {
          model: this.modelName,
          hasTools: tools.length > 0,
          webSearchEnabled: enableWebSearch,
          xSearchEnabled: enableXSearch,
        },
      });

      return this.parseResponsePayload(response.data);
    } catch (error: any) {
      const tracker = APICostTracker.getInstance();
      const latency = Date.now() - startTime;
      tracker.trackRequest("grok", {
        endpoint: "callTextAPIWithTools",
        success: false,
        error: error?.message || "Unknown error",
        latency,
        additionalMetadata: {
          model: this.modelName,
        },
      });
      console.error("🔸 GrokProvider: chat completion failed:", error);
      throw error;
    }
  }

  private async submitToolOutputs(
    toolResults: ToolCallResponse[],
    systemPrompt: string,
    userPrompt: string,
    startTime?: number
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const submitStartTime = startTime || Date.now();
    const tracker = APICostTracker.getInstance();
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
      const latency = Date.now() - submitStartTime;
      tracker.trackRequest("grok", {
        endpoint: "submitToolOutputs",
        success: false,
        error: "No response received",
        latency,
        additionalMetadata: {
          model: this.modelName,
        },
      });
      return { content: "" };
    }

    const latency = Date.now() - submitStartTime;
    const usage = latestResponse?.usage;
    const inputTokens = usage?.input_tokens || usage?.inputTokens || 0;
    const outputTokens = usage?.output_tokens || usage?.outputTokens || 0;

    tracker.trackRequest("grok", {
      endpoint: "submitToolOutputs",
      success: true,
      inputTokens,
      outputTokens,
      latency,
      additionalMetadata: {
        model: this.modelName,
      },
    });

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

    // Debug logging
    console.log(
      "[GrokProvider] parseResponsePayload - outputArray length:",
      outputArray.length
    );
    if (outputArray.length > 1) {
      console.log(
        "[GrokProvider] WARNING: Multiple outputs detected:",
        outputArray.length
      );
    }

    const toolCalls: ToolCall[] = [];
    const textOutputs: string[] = []; // Collect all text outputs separately

    const appendText = (text?: string) => {
      if (text && text.trim()) {
        textOutputs.push(text.trim());
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
    if (textOutputs.length === 0 && data.text) {
      if (typeof data.text === "string") {
        textOutputs.push(data.text);
      } else if (data.text.content) {
        textOutputs.push(data.text.content);
      }
    }

    if (textOutputs.length === 0) {
      const fallbackText =
        data?.output_text ||
        data?.response?.output_text ||
        (Array.isArray(data?.output_text) ? data.output_text.join("\n") : "") ||
        (Array.isArray(data?.response?.output_text)
          ? data.response.output_text.join("\n")
          : "");
      if (fallbackText) {
        textOutputs.push(fallbackText);
      } else if (toolCalls.length === 0) {
        // Only warn if we have no text AND no tool calls (unexpected state)
        // If we have tool calls, empty text is expected - we'll get text after submitting tool outputs
        console.warn(
          "🔸 GrokProvider: empty response (no text, no tool calls)",
          `Response ID: ${data?.id || "unknown"}`
        );
      }
    }

    // Use only the LAST text output to avoid multiple responses
    // Grok sometimes returns multiple output blocks, but we only want the final one
    const finalText =
      textOutputs.length > 0 ? textOutputs[textOutputs.length - 1] || "" : "";

    if (textOutputs.length > 1) {
      console.log(
        "[GrokProvider] Multiple text outputs found:",
        textOutputs.length
      );
      console.log(
        "[GrokProvider] Using last output. Discarded outputs:",
        textOutputs.slice(0, -1).map((t) => t.substring(0, 100))
      );
      console.log("[GrokProvider] Final output:", finalText.substring(0, 200));
    }

    return {
      content: finalText.trim(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  // Only handle the actual API call - no AI logic here
  async callImageAPI(prompt: string): Promise<{ url: string; buffer: Buffer }> {
    const startTime = Date.now();
    const tracker = APICostTracker.getInstance();

    try {
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

      const latency = Date.now() - startTime;

      // Image generation typically has fixed cost per image
      // Track with estimated tokens or fixed cost
      tracker.trackRequest("grok", {
        endpoint: "callImageAPI",
        success: true,
        latency,
        additionalMetadata: {
          model: "grok-2-image",
          // Image generation cost is typically fixed per image
        },
      });

      return { url: imageUrl, buffer: imageBuffer };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      tracker.trackRequest("grok", {
        endpoint: "callImageAPI",
        success: false,
        error: error?.message || "Unknown error",
        latency,
        additionalMetadata: {
          model: "grok-2-image",
        },
      });
      throw error;
    }
  }
}
