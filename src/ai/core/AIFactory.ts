import { AIEngine } from "./AIEngine";
import { AIRequestBuilder } from "./AIRequestBuilder";
import { DatabaseTools } from "../tools/registry/DatabaseTools";
import type { AIProvider } from "../providers/base/AIProvider";
import { GrokProvider } from "../providers/GrokProvider";
import { OpenAIProvider } from "../providers/OpenAIProvider";
// import { GeminiProvider } from "../providers/GeminiProvider"; // Disabled - switching to OpenAI
import { OllamaProvider } from "../providers/OllamaProvider";
import { config } from "../../config";

// Tool imports
import { userTools } from "../tools/user/UserTools";
import { relationshipTools } from "../tools/relationship/RelationshipTools";
import { conversationTools } from "../tools/conversation/ConversationTools";
import { messageTools } from "../tools/message/MessageTools";
import { serverTools } from "../tools/server/ServerTools";
import { contextTools } from "../tools/context/ContextTools";
import { analysisTools } from "../tools/analysis/AnalysisTools";
import { liveConversationTools } from "../tools/live/LiveConversationTools";
import { dramaAnalysisTools } from "../tools/drama/DramaAnalysisTools";
import { semanticSearchTools } from "../tools/search/SemanticSearchTools";
import { storylineTools } from "../tools/storyline/StorylineTools";
// Voice/media tools are dynamically imported to avoid segfaults in test environments

/**
 * AIFactory - Centralized initialization for the AI system
 *
 * This factory creates and wires together:
 * - AI providers (Grok, OpenAI, Gemini, Ollama)
 * - DatabaseTools registry
 * - AIEngine
 * - AIRequestBuilder
 *
 * Usage:
 *   const { engine, builder } = AIFactory.create();
 */
export class AIFactory {
	/**
	 * Create and initialize the AI system
	 */
	static async create(): Promise<{
		engine: AIEngine;
		builder: AIRequestBuilder;
		providers: Map<string, AIProvider>;
		databaseTools: DatabaseTools;
	}> {
		// Initialize providers
		const providers = this.initializeProviders();

		// Initialize database tools (async due to dynamic imports)
		const databaseTools = await this.initializeDatabaseTools();

		// Create AIEngine
		const engine = new AIEngine(providers, databaseTools);

		// Create AIRequestBuilder
		const builder = new AIRequestBuilder(engine);

		return { engine, builder, providers, databaseTools };
	}

	/**
	 * Initialize all AI providers
	 */
	private static initializeProviders(): Map<string, AIProvider> {
		const providers = new Map<string, AIProvider>();

		// Grok (primary for chat and voice)
		if (config.grokApiKey) {
			providers.set("grok", new GrokProvider());
		}

		// OpenAI
		if (config.openaiApiKey) {
			providers.set("openai", new OpenAIProvider());
		}

		// Gemini disabled - switching to OpenAI due to high API costs
		// if (config.geminiApiKey) {
		// 	providers.set("gemini", new GeminiProvider());
		// }

		// Ollama (local inference)
		if (config.ollamaUrl) {
			providers.set("ollama", new OllamaProvider());
		}

		if (providers.size === 0) {
			console.warn("⚠️ No AI providers configured. Set API keys in environment.");
		}

		return providers;
	}

	/**
	 * Initialize and register all database tools
	 */
	private static async initializeDatabaseTools(): Promise<DatabaseTools> {
		const tools = new DatabaseTools();

		// Register all tool categories
		tools.registerTools(userTools);
		tools.registerTools(relationshipTools);
		tools.registerTools(conversationTools);
		tools.registerTools(messageTools);
		tools.registerTools(serverTools);
		tools.registerTools(contextTools);
		tools.registerTools(analysisTools);
		tools.registerTools(liveConversationTools);
		tools.registerTools(dramaAnalysisTools);
		tools.registerTools(semanticSearchTools);
		tools.registerTools(storylineTools);

		// Dynamically import optional tools that may fail if dependencies aren't available
		// (e.g., in test environments without Discord client or native modules)
		try {
			const { voiceTools } = await import("../tools/voice/VoiceTools.js");
			tools.registerTools(voiceTools);
		} catch (error) {
			console.warn("⚠️ Failed to load voice tools:", error instanceof Error ? error.message : String(error));
		}

		try {
			const { musicTools } = await import("../tools/music/MusicTools.js");
			tools.registerTools(musicTools);
		} catch (error) {
			console.warn("⚠️ Failed to load music tools:", error instanceof Error ? error.message : String(error));
		}

		try {
			const { mediaPlayerTools } = await import("../tools/media/MediaPlayerTools.js");
			tools.registerTools(mediaPlayerTools);
		} catch (error) {
			console.warn("⚠️ Failed to load media player tools:", error instanceof Error ? error.message : String(error));
		}

		try {
			const { streamPlayerTools } = await import("../tools/stream/StreamPlayerTools.js");
			tools.registerTools(streamPlayerTools);
		} catch (error) {
			console.warn("⚠️ Failed to load stream player tools:", error instanceof Error ? error.message : String(error));
		}

		return tools;
	}
}
