import * as dotenv from "dotenv";

dotenv.config();

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface BotConfig {
  // Required
  botToken: string;

  // Optional Discord settings
  guildId?: string;
  botPrefix: string;
  botOwnerId?: string;
  spawnChannelIds?: string[];
  spawnChannelId?: string; // Single spawn channel for voice channel manager
  excludedChannelIds?: string[];
  permanentChannelIds?: string[];
  starboardChannelId?: string;

  // Database settings
  postgresUrl?: string;
  dbName: string;

  // Cache settings
  redisUrl?: string;

  // Development
  nodeEnv: "development" | "production" | "test";
  port: number;

  // Optional integrations
  webhookUrl?: string;
  openaiApiKey?: string;
  grokApiKey?: string;
  geminiApiKey?: string;
  youtubeApiKey?: string;
  grokEnableWebSearch: boolean;
  grokEnableXSearch: boolean;

  // Ollama settings
  ollamaUrl?: string;
  ollamaModel?: string;

  // Feature flags
  enableTopicSplitting: boolean;

  // Voice Assistant settings
  googleTtsApiKey?: string;
  googleTtsLanguageCode: string;
  googleTtsVoiceName: string;
  whisperApiKey?: string;
  whisperUrl?: string;
  voiceAssistantTriggerWord: string;
  voiceAssistantEnabled: boolean;
  voiceAssistantLogLevel: LogLevel;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return defaultValue;
  }
}

function parseLogLevel(value: string | undefined, defaultValue: LogLevel): LogLevel {
  if (!value) {
    return defaultValue;
  }

  switch (value.trim().toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value.trim().toLowerCase() as LogLevel;
    default:
      return defaultValue;
  }
}

function validateConfig(): BotConfig {
  const requiredVars = ["BOT_TOKEN"] as const;

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`🔸 Missing required environment variable: ${varName}`);
    }
  }

  const config: BotConfig = {
    // Required
    botToken: process.env.BOT_TOKEN as string,

    // Optional Discord settings
    guildId: process.env.GUILD_ID || undefined,
    botPrefix: process.env.BOT_PREFIX || "!",
    botOwnerId: process.env.BOT_OWNER_ID || undefined,
    spawnChannelIds: process.env.SPAWN_CHANNEL_IDS
      ? process.env.SPAWN_CHANNEL_IDS.split(",").map((id) => id.trim())
      : undefined,
    spawnChannelId: process.env.SPAWN_CHANNEL_ID || undefined,
    excludedChannelIds: process.env.EXCLUDED_CHANNEL_IDS
      ? process.env.EXCLUDED_CHANNEL_IDS.split(",").map((id) => id.trim())
      : undefined,
    permanentChannelIds: process.env.PERMANENT_CHANNEL_IDS
      ? process.env.PERMANENT_CHANNEL_IDS.split(",").map((id) => id.trim())
      : undefined,
    starboardChannelId: process.env.STARBOARD_CHANNEL_ID || undefined,

    // Database settings
    postgresUrl: process.env.POSTGRES_URL || undefined,
    dbName: process.env.DB_NAME || "arcados",

    // Cache settings
    redisUrl: process.env.REDIS_URL || undefined,

    // Development
    nodeEnv:
      (process.env.NODE_ENV as "development" | "production" | "test") ||
      "development",
    port: Number.parseInt(process.env.PORT || "3000", 10),

    // Optional integrations
    webhookUrl: process.env.WEBHOOK_URL || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    grokApiKey: process.env.GROK_API_KEY || undefined,
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    youtubeApiKey: process.env.YOUTUBE_API_KEY || undefined,
    grokEnableWebSearch: parseBoolean(
      process.env.GROK_ENABLE_WEB_SEARCH,
      true
    ),
    grokEnableXSearch: parseBoolean(process.env.GROK_ENABLE_X_SEARCH, true),

    // Ollama settings
    ollamaUrl: process.env.OLLAMA_URL || undefined,
    ollamaModel: process.env.OLLAMA_MODEL || undefined,

    // Feature flags
    enableTopicSplitting: parseBoolean(
      process.env.ENABLE_TOPIC_SPLITTING,
      false
    ),

    // Voice Assistant settings
    googleTtsApiKey: process.env.GOOGLE_TTS_API_KEY || undefined,
    googleTtsLanguageCode: process.env.GOOGLE_TTS_LANGUAGE_CODE || "en-US",
    googleTtsVoiceName: process.env.GOOGLE_TTS_VOICE_NAME || "en-US-Wavenet-D",
    whisperApiKey: process.env.WHISPER_API_KEY || undefined,
    whisperUrl: process.env.WHISPER_URL || undefined,
    voiceAssistantTriggerWord: process.env.VOICE_ASSISTANT_TRIGGER_WORD || "aria",
    voiceAssistantEnabled: parseBoolean(
      process.env.VOICE_ASSISTANT_ENABLED,
      true
    ),
    voiceAssistantLogLevel: parseLogLevel(
      process.env.VOICE_ASSISTANT_LOG_LEVEL,
      "info"
    ),
  };

  // Validate node environment
  if (!["development", "production", "test"].includes(config.nodeEnv)) {
    throw new Error(
      "🔸 Invalid NODE_ENV. Must be one of: development, production, test"
    );
  }

  return config;
}

export const config = validateConfig();

// Helper function to check if we're in development
export const isDevelopment = config.nodeEnv === "development";
export const isProduction = config.nodeEnv === "production";
export const isTest = config.nodeEnv === "test";
