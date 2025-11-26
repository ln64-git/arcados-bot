import { config } from "../config";

/**
 * Provider pricing configuration
 * Costs are in USD per unit (1K tokens for LLMs, per character for TTS)
 */
export interface ProviderPricing {
	inputCostPer1K?: number; // For token-based providers
	outputCostPer1K?: number; // For token-based providers
	costPerChar?: number; // For character-based providers (TTS)
	costPerSecond?: number; // For time-based providers
	free?: boolean; // For local/free providers like Ollama
}

export interface CostTrackingConfig {
	enabled: boolean;
	flushInterval: number; // milliseconds
	historyLimit: number; // max requests per file
	baseDirectory: string; // base directory for cost files
}

/**
 * Get pricing configuration for a provider
 * Loads from environment variables with fallback defaults
 */
export function getProviderPricing(
	provider: string
): ProviderPricing {
	switch (provider) {
		case "grok": {
			// X.AI Grok pricing (as of 2025)
			// Default: $0.01 per 1K input tokens, $0.03 per 1K output tokens
			return {
				inputCostPer1K:
					parseFloat(
						process.env.GROK_INPUT_COST_PER_1K || "0.01"
					),
				outputCostPer1K: parseFloat(
					process.env.GROK_OUTPUT_COST_PER_1K || "0.03"
				),
			};
		}

		case "gemini": {
			// Google Gemini pricing (as of 2025)
			// Default: $0.00025 per 1K input, $0.001 per 1K output
			return {
				inputCostPer1K: parseFloat(
					process.env.GEMINI_INPUT_COST_PER_1K || "0.00025"
				),
				outputCostPer1K: parseFloat(
					process.env.GEMINI_OUTPUT_COST_PER_1K || "0.001"
				),
			};
		}

		case "openai": {
			// OpenAI pricing (GPT-4o-mini as default)
			// Default: $0.15 per 1M input, $0.60 per 1M output
			return {
				inputCostPer1K: parseFloat(
					process.env.OPENAI_INPUT_COST_PER_1K || "0.00015"
				),
				outputCostPer1K: parseFloat(
					process.env.OPENAI_OUTPUT_COST_PER_1K || "0.0006"
				),
			};
		}

		case "ollama": {
			// Ollama is typically free (local), but can be configured
			return {
				free: process.env.OLLAMA_COST_PER_1K === undefined,
				inputCostPer1K: process.env.OLLAMA_COST_PER_1K
					? parseFloat(process.env.OLLAMA_COST_PER_1K)
					: 0,
				outputCostPer1K: process.env.OLLAMA_COST_PER_1K
					? parseFloat(process.env.OLLAMA_COST_PER_1K)
					: 0,
			};
		}

		case "cartesia": {
			// Cartesia TTS pricing (per character)
			// Default: $0.00001 per character (example, adjust to actual)
			return {
				costPerChar: parseFloat(
					process.env.CARTESIA_COST_PER_CHAR || "0.00001"
				),
			};
		}

		case "google-tts": {
			// Google Cloud TTS pricing (per character)
			// Default: $0.000016 per character (Standard voices)
			return {
				costPerChar: parseFloat(
					process.env.GOOGLE_TTS_COST_PER_CHAR || "0.000016"
				),
			};
		}

		default:
			return { free: true };
	}
}

/**
 * Get cost tracking configuration
 */
export function getCostTrackingConfig(): CostTrackingConfig {
	return {
		enabled:
			process.env.ENABLE_COST_TRACKING !== "false", // Default: true
		flushInterval: parseInt(
			process.env.COST_TRACKING_FLUSH_INTERVAL || "300000",
			10
		), // 5 minutes default
		historyLimit: parseInt(
			process.env.COST_TRACKING_HISTORY_LIMIT || "1000",
			10
		), // 1000 requests per file default
		baseDirectory:
			process.env.COST_TRACKING_DIR || "api-costs",
	};
}

/**
 * Calculate cost for a request based on provider pricing
 */
export function calculateCost(
	provider: string,
	pricing: ProviderPricing,
	metadata: {
		inputTokens?: number;
		outputTokens?: number;
		characters?: number;
		seconds?: number;
	}
): number {
	if (pricing.free) {
		return 0;
	}

	let cost = 0;

	// Token-based calculation
	if (pricing.inputCostPer1K && metadata.inputTokens) {
		cost += (metadata.inputTokens / 1000) * pricing.inputCostPer1K;
	}
	if (pricing.outputCostPer1K && metadata.outputTokens) {
		cost += (metadata.outputTokens / 1000) * pricing.outputCostPer1K;
	}

	// Character-based calculation
	if (pricing.costPerChar && metadata.characters) {
		cost += metadata.characters * pricing.costPerChar;
	}

	// Time-based calculation
	if (pricing.costPerSecond && metadata.seconds) {
		cost += metadata.seconds * pricing.costPerSecond;
	}

	return Math.round(cost * 1000000) / 1000000; // Round to 6 decimal places
}

