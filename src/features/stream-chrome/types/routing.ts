import type { Snowflake } from "discord.js";

/**
 * Result of provider detection from query
 */
export interface ProviderRoutingResult {
	provider: string | null; // Detected provider name, or null if not detected
	cleanQuery: string; // Query with provider syntax removed
}

/**
 * Guild preferences for provider selection
 */
export interface GuildPreferences {
	guildId: Snowflake;
	defaultProvider: string; // Default provider name for this guild
}

