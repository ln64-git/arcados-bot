export interface AIResponse {
  success: boolean;
  content: string;
  error?: string;
  imageUrl?: string;
  imageBuffer?: Buffer;
  imageFilename?: string;
}

export interface RateLimitInfo {
  remaining: number;
  resetTime: number;
}

export interface ProviderConfig {
  apiKey: string;
  baseURL?: string;
  modelName?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIProvider {
  // Core API methods - providers only handle the actual API calls
  callTextAPI(systemPrompt: string, userPrompt: string): Promise<string>;
  callImageAPI(prompt: string): Promise<{ url: string; buffer: Buffer }>;

  // Provider identification
  getProviderName(): string;
  getModelName(): string;

  // Rate limiting (inherited from BaseAIProvider)
  getRateLimitInfo(userId: string): RateLimitInfo;
}
