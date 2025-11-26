import { ChatOpenAI } from "@langchain/openai";
import axios from "axios";
import { config } from "../../config";
import { BaseAIProvider } from "./base/BaseAIProvider";
import { APICostTracker } from "../../utils/APICostTracker";

export class OpenAIProvider extends BaseAIProvider {
  private model: ChatOpenAI;

  constructor() {
    super(5); // 5 requests per minute
    if (!config.openaiApiKey) {
      throw new Error(
        "OpenAI API key is not configured in environment variables"
      );
    }

    this.model = new ChatOpenAI({
      apiKey: config.openaiApiKey,
      modelName: "gpt-4o-mini",
      temperature: 0.7,
      maxTokens: 1000,
    });
  }

  getProviderName(): string {
    return "openai";
  }

  getModelName(): string {
    return "GPT-4o-mini";
  }

  // Only handle the actual API call - no AI logic here
  async callTextAPI(systemPrompt: string, userPrompt: string): Promise<string> {
    const startTime = Date.now();
    const tracker = APICostTracker.getInstance();

    try {
      const response = await this.model.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);

      const latency = Date.now() - startTime;

      // Extract token counts from LangChain response
      // LangChain stores usage in response_metadata
      const usage = (response as any).response_metadata?.tokenUsage;
      const inputTokens = usage?.promptTokens || 0;
      const outputTokens = usage?.completionTokens || 0;

      tracker.trackRequest("openai", {
        endpoint: "callTextAPI",
        success: true,
        inputTokens,
        outputTokens,
        latency,
        additionalMetadata: {
          model: "gpt-4o-mini",
        },
      });

      return typeof response.content === "string"
        ? response.content
        : String(response.content);
    } catch (error: any) {
      const latency = Date.now() - startTime;
      tracker.trackRequest("openai", {
        endpoint: "callTextAPI",
        success: false,
        error: error?.message || "Unknown error",
        latency,
        additionalMetadata: {
          model: "gpt-4o-mini",
        },
      });
      throw error;
    }
  }

  // Only handle the actual API call - no AI logic here
  async callImageAPI(prompt: string): Promise<{ url: string; buffer: Buffer }> {
    const startTime = Date.now();
    const tracker = APICostTracker.getInstance();

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/images/generations",
        {
          model: "dall-e-3",
          prompt: prompt,
          n: 1,
          size: "1024x1024",
          response_format: "url",
        },
        {
          headers: {
            Authorization: `Bearer ${config.openaiApiKey}`,
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

      // DALL-E 3 pricing is fixed per image
      tracker.trackRequest("openai", {
        endpoint: "callImageAPI",
        success: true,
        latency,
        additionalMetadata: {
          model: "dall-e-3",
          size: "1024x1024",
        },
      });

      return { url: imageUrl, buffer: imageBuffer };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      tracker.trackRequest("openai", {
        endpoint: "callImageAPI",
        success: false,
        error: error?.message || "Unknown error",
        latency,
        additionalMetadata: {
          model: "dall-e-3",
        },
      });
      throw error;
    }
  }
}
