import { ChatOpenAI } from "@langchain/openai";
import axios from "axios";
import { config } from "../../../config";
import { BaseAIProvider } from "./BaseAIProvider";

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
