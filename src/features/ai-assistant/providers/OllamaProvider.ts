import axios from "axios";
import { config } from "../../../config";
import { BaseAIProvider } from "./BaseAIProvider";

export class OllamaProvider extends BaseAIProvider {
  private readonly baseURL: string;
  private readonly modelName: string;

  constructor() {
    super(10); // 10 requests per minute (more generous for local)
    this.baseURL = config.ollamaUrl || "http://localhost:11434";
    this.modelName = config.ollamaModel || "gpt-oss";
  }

  getProviderName(): string {
    return "ollama";
  }

  getModelName(): string {
    return this.modelName;
  }

  // Only handle the actual API call - no AI logic here
  async callTextAPI(systemPrompt: string, userPrompt: string): Promise<string> {
    try {
      const response = await axios.post(`${this.baseURL}/api/generate`, {
        model: this.modelName,
        prompt: `${systemPrompt}\n\nUser: ${userPrompt}\nAssistant:`,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 1000,
        },
      });

      return response.data.response || "";
    } catch (error) {
      console.error("🔸 Error calling Ollama API:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to call Ollama API: ${error.message}`);
      } else {
        throw new Error("Failed to call Ollama API: Unknown error");
      }
    }
  }

  // Only handle the actual API call - no AI logic here
  async callImageAPI(prompt: string): Promise<{ url: string; buffer: Buffer }> {
    // Ollama doesn't have native image generation, so we'll throw an error
    // In a real implementation, you might want to integrate with a separate image generation service
    throw new Error(
      "Image generation not supported by Ollama provider. Please use 'grok' or 'openai' provider for image generation."
    );
  }
}
