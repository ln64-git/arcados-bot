import { BaseAIProvider } from "./BaseAIProvider";

export class GeminiProvider extends BaseAIProvider {
  constructor() {
    super(5); // 5 requests per minute
    // No API key check needed since this is a stub
  }

  getProviderName(): string {
    return "gemini";
  }

  getModelName(): string {
    return "Gemini-Pro";
  }

  // Only handle the actual API call - no AI logic here
  async callTextAPI(systemPrompt: string, userPrompt: string): Promise<string> {
    throw new Error(
      "Gemini provider is not yet implemented. Please use 'grok' or 'openai' provider instead."
    );
  }

  // Only handle the actual API call - no AI logic here
  async callImageAPI(prompt: string): Promise<{ url: string; buffer: Buffer }> {
    throw new Error(
      "Gemini provider is not yet implemented. Please use 'grok' or 'openai' provider instead."
    );
  }
}
