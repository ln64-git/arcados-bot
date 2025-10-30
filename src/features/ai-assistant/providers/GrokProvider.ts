import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import axios from "axios";
import { config } from "../../../config";
import { BaseAIProvider } from "./BaseAIProvider";
import type { ToolCall, ToolCallResponse } from "./AIProvider";

export class GrokProvider extends BaseAIProvider {
  private model: ChatOpenAI;

  constructor() {
    super(5); // 5 requests per minute
    if (!config.grokApiKey) {
      throw new Error(
        "Grok API key is not configured in environment variables"
      );
    }

    // Use Grok API with OpenAI-compatible interface
    this.model = new ChatOpenAI({
      apiKey: config.grokApiKey,
      modelName: "grok-3", // Use Grok-3 model (grok-beta was deprecated)
      temperature: 0.7,
      maxTokens: 1000,
      configuration: {
        baseURL: "https://api.x.ai/v1",
      },
    });
  }

  getProviderName(): string {
    return "grok";
  }

  getModelName(): string {
    return "Grok-3";
  }

  // Only handle the actual API call - no AI logic here
  async callTextAPI(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    return typeof response.content === "string"
      ? response.content
      : String(response.content);
  }

  // Tool calling support using LangChain
  override async callTextAPIWithTools(
    systemPrompt: string,
    userPrompt: string,
    tools: Array<{ name: string; description: string; parameters: any }>,
    toolResults?: ToolCallResponse[]
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    // Convert tools to LangChain format
    const langchainTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));

    // Bind tools to model
    // Bind tools to model (runtime params are currently applied via guidance at the prompt level)
    const modelWithTools = this.model.bindTools(
      langchainTools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
    );

    // Build messages
    const messages: Array<
      SystemMessage | HumanMessage | AIMessage | ToolMessage
    > = [new SystemMessage(systemPrompt)];

    // Add tool results if provided (for multi-turn tool calling)
    if (toolResults && toolResults.length > 0) {
      messages.push(new HumanMessage(userPrompt));
      for (const toolResult of toolResults) {
        messages.push(
          new AIMessage({
            content: "",
            tool_calls: [
              {
                name: toolResult.name,
                id: toolResult.toolCallId,
                args: {},
              },
            ],
          })
        );
        messages.push(
          new ToolMessage({
            content: toolResult.content,
            tool_call_id: toolResult.toolCallId,
          })
        );
      }
    } else {
      messages.push(new HumanMessage(userPrompt));
    }

    // Invoke model
    const response = await modelWithTools.invoke(messages);

    // Extract tool calls if present
    const toolCalls: ToolCall[] = [];
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        toolCalls.push({
          id: toolCall.id || "",
          name: toolCall.name || "",
          arguments: toolCall.args || {},
        });
      }
    }

    const content =
      typeof response.content === "string"
        ? response.content
        : String(response.content || "");

    return {
      content,
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
