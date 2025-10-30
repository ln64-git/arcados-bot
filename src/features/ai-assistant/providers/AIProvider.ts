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

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolCallResponse {
  toolCallId: string;
  role: "tool";
  name: string;
  content: string;
}

export interface AIProvider {
  // Core API methods - providers only handle the actual API calls
  callTextAPI(systemPrompt: string, userPrompt: string): Promise<string>;
  callImageAPI(prompt: string): Promise<{ url: string; buffer: Buffer }>;

  // Tool calling support (optional - providers can implement if they support it)
  callTextAPIWithTools?(
    systemPrompt: string,
    userPrompt: string,
    tools: Array<{ name: string; description: string; parameters: any }>,
    toolResults?: ToolCallResponse[]
  ): Promise<{ content: string; toolCalls?: ToolCall[] }>;

  // Provider identification
  getProviderName(): string;
  getModelName(): string;

  // Rate limiting (inherited from BaseAIProvider)
  getRateLimitInfo(userId: string): RateLimitInfo;
}
