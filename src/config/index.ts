import dotenv from 'dotenv';

dotenv.config();

export interface BotConfig {
  // Required
  botToken: string;

  // Optional Discord settings
  guildId?: string;
  botPrefix: string;
  botOwnerId?: string;

  // Database settings
  mongoUri?: string;
  dbName: string;


  // Development
  nodeEnv: 'development' | 'production' | 'test';
  port: number;

  // Optional integrations
  webhookUrl?: string;
  openaiApiKey?: string;
  youtubeApiKey?: string;
}

function validateConfig(): BotConfig {
  const requiredVars = ['BOT_TOKEN'] as const;

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`🔸 Missing required environment variable: ${varName}`);
    }
  }

  const config: BotConfig = {
    // Required
    botToken: process.env.BOT_TOKEN!,

    // Optional Discord settings
    guildId: process.env.GUILD_ID,
    botPrefix: process.env.BOT_PREFIX || '!',
    botOwnerId: process.env.BOT_OWNER_ID,

    // Database settings
    mongoUri: process.env.MONGO_URI,
    dbName: process.env.DB_NAME || 'discord-bot',


    // Development
    nodeEnv: (process.env.NODE_ENV as any) || 'development',
    port: parseInt(process.env.PORT || '3000'),

    // Optional integrations
    webhookUrl: process.env.WEBHOOK_URL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    youtubeApiKey: process.env.YOUTUBE_API_KEY,
  };


  // Validate node environment
  if (!['development', 'production', 'test'].includes(config.nodeEnv)) {
    throw new Error('🔸 Invalid NODE_ENV. Must be one of: development, production, test');
  }

  return config;
}

export const config = validateConfig();

// Helper function to check if we're in development
export const isDevelopment = config.nodeEnv === 'development';
export const isProduction = config.nodeEnv === 'production';
export const isTest = config.nodeEnv === 'test';
