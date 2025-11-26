import type { AIEngine } from "../../ai/core/AIEngine";
import { AIRequestBuilder } from "../../ai/core/AIRequestBuilder";
import type { AIContext } from "../../ai/core/AIContext";
import type { AIResponse } from "../../ai/providers/base/AIProvider";

/**
 * VoiceAIManager - Domain-specific AI interface for voice interactions
 *
 * This manager handles all AI operations for the voice assistant.
 * It provides high-level methods that configure the AI engine appropriately
 * for voice use cases (command mode, conversation mode, streaming).
 *
 * Responsibilities:
 * - Voice-specific AI configuration (persona, tools, prompts)
 * - Clean interface for VoiceAssistantManager
 *
 * NOT responsible for:
 * - Trigger word detection (stays in VoiceAssistantManager)
 * - Transcription filtering (stays in VoiceAssistantManager)
 * - TTS pipeline (stays in VoiceAssistantManager)
 * - Audio processing (stays in VoiceAssistantManager)
 */
export class VoiceAIManager {
	private engine: AIEngine;

	constructor(aiEngine: AIEngine) {
		this.engine = aiEngine;
	}

	/**
	 * Generate response for command mode (blocking)
	 *
	 * Use this for:
	 * - Single utterance commands ("what's the weather?")
	 * - Music requests ("play arcade fire")
	 * - Quick queries
	 *
	 * Configuration:
	 * - Persona: casual
	 * - Mode: chat (concise, 3 iterations max)
	 * - Tools: media, voice (dynamic based on prompt)
	 * - Formatting: disabled (optimized for TTS)
	 */
	async generateCommandResponse(
		query: string,
		context: AIContext
	): Promise<AIResponse> {
		const builder = new AIRequestBuilder(this.engine);

		const result = await builder
			.voice()
			.blocking()
			.withContext(context)
			.provider("grok")
			.generate(query);

		// Blocking mode always returns AIResponse
		if (typeof result === "object" && "success" in result) {
			return result as AIResponse;
		}

		// Fallback (shouldn't happen in blocking mode)
		return {
			success: false,
			content: "Unexpected response type",
		};
	}

	/**
	 * Stream response for conversation mode (low-latency)
	 *
	 * Use this for:
	 * - Multi-turn conversations
	 * - Long-form responses
	 * - Real-time playback during generation
	 *
	 * Configuration:
	 * - Persona: casual
	 * - Mode: chat
	 * - Tools: media, voice (dynamic)
	 * - Streaming: enabled
	 * - Formatting: paragraph-based (separated with \n)
	 */
	async streamConversationResponse(
		query: string,
		context: AIContext
	): Promise<AsyncIterable<string>> {
		const builder = new AIRequestBuilder(this.engine);

		const result = await builder
			.voiceStream()
			.withContext(context)
			.provider("grok")
			.generate(query);

		// Streaming mode returns AsyncIterable<string>
		if (result && typeof result === "object" && Symbol.asyncIterator in result) {
			return result as AsyncIterable<string>;
		}

		// Fallback: convert AIResponse to async iterable
		if (typeof result === "object" && "content" in result) {
			const response = result as AIResponse;
			return (async function* () {
				yield response.content || "";
			})();
		}

		// Final fallback
		return (async function* () {
			yield "";
		})();
	}

	/**
	 * Generate response for conversation mode (blocking, with history)
	 *
	 * Use this for:
	 * - Multi-turn conversations where streaming isn't needed
	 * - When you need to wait for the full response
	 *
	 * Configuration:
	 * - Same as streamConversationResponse, but blocking
	 * - Includes conversation history from context
	 */
	async generateConversationResponse(
		query: string,
		context: AIContext
	): Promise<AIResponse> {
		const builder = new AIRequestBuilder(this.engine);

		const result = await builder
			.voice()
			.blocking()
			.withContext(context)
			.history(context.history || [])
			.provider("grok")
			.generate(query);

		// Blocking mode always returns AIResponse
		if (typeof result === "object" && "success" in result) {
			return result as AIResponse;
		}

		// Fallback (shouldn't happen in blocking mode)
		return {
			success: false,
			content: "Unexpected response type",
		};
	}
}
