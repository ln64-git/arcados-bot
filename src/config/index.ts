import * as dotenv from "dotenv";

dotenv.config();

export interface BotConfig {
	// Required
	botToken: string;

	// Optional Discord settings
	guildId?: string;
	botPrefix: string;
	botOwnerId?: string;
	spawnChannelIds?: string[];
	excludedChannelIds?: string[];
	permanentChannelIds?: string[];
	starboardChannelId?: string;

	// Database settings
	postgresUrl?: string;
	dbName: string;

	// SurrealDB settings
	surrealUrl?: string;
	surrealNamespace?: string;
	surrealDatabase?: string;
	surrealUsername?: string;
	surrealPassword?: string;
	surrealToken?: string; // For OAuth2 authentication

	// Cache settings
	redisUrl?: string;

	// Development
	nodeEnv: "development" | "production" | "test";
	port: number;

	// Optional integrations
	webhookUrl?: string;
	openaiApiKey?: string;
	youtubeApiKey?: string;
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

		// SurrealDB settings
		surrealUrl: process.env.SURREAL_URL || undefined,
		surrealNamespace: process.env.SURREAL_NAMESPACE || "arcados-bot",
		surrealDatabase: process.env.SURREAL_DATABASE || "arcados-bot",
		surrealUsername: process.env.SURREAL_USERNAME || "root",
		surrealPassword: process.env.SURREAL_PASSWORD || "root",
		surrealToken: process.env.SURREAL_TOKEN || undefined, // For OAuth2 authentication

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
		youtubeApiKey: process.env.YOUTUBE_API_KEY || undefined,
	};

	// Validate node environment
	if (!["development", "production", "test"].includes(config.nodeEnv)) {
		throw new Error(
			"🔸 Invalid NODE_ENV. Must be one of: development, production, test",
		);
	}

	return config;
}

export const config = validateConfig();

// Helper function to check if we're in development
export const isDevelopment = config.nodeEnv === "development";
export const isProduction = config.nodeEnv === "production";
export const isTest = config.nodeEnv === "test";
