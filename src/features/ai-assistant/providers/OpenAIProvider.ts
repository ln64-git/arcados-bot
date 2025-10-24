import { ChatOpenAI } from "@langchain/openai";
import axios from "axios";
import { config } from "../../../config";
import { BaseAIProvider } from "./BaseAIProvider";

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

    return { url: imageUrl, buffer: imageBuffer };
  }
}
