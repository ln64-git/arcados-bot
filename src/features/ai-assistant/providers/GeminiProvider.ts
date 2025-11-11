import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../../../config/index.js";
import { BaseAIProvider } from "./BaseAIProvider.js";
import type { ToolCall, ToolCallResponse } from "./AIProvider.js";

export class GeminiProvider extends BaseAIProvider {
	private genAI: GoogleGenerativeAI;
	private model: any;

	constructor() {
		super(15); // 15 requests per minute for Gemini free tier

		if (!config.geminiApiKey) {
			throw new Error("Gemini API key is not configured in environment variables");
		}

		this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
		this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
	}

	getProviderName(): string {
		return "gemini";
	}

	getModelName(): string {
		return "Gemini-2.0-Flash";
	}

	// Handle text API call
	async callTextAPI(systemPrompt: string, userPrompt: string): Promise<string> {
		try {
			// Combine system and user prompts (Gemini doesn't have separate system role in basic API)
			const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

			const result = await this.model.generateContent(combinedPrompt);
			const response = await result.response;
			const text = response.text();

			return text;
		} catch (error) {
			throw new Error(
				`Gemini API error: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	// Tool calling support
	override async callTextAPIWithTools(
		systemPrompt: string,
		userPrompt: string,
		tools: Array<{ name: string; description: string; parameters: any }>,
		toolResults?: ToolCallResponse[]
	): Promise<{ content: string; toolCalls?: ToolCall[] }> {
		try {
			// Convert tools to Gemini function declarations
			const functionDeclarations = tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			}));

			// Create model with function calling
			const modelWithTools = this.genAI.getGenerativeModel({
				model: "gemini-2.0-flash-exp",
				tools: [{ functionDeclarations }],
			});

			// Combine system and user prompts
			const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

			// Build message history if we have tool results
			const history: any[] = [];
			if (toolResults && toolResults.length > 0) {
				// Add previous conversation turns
				history.push({
					role: "user",
					parts: [{ text: combinedPrompt }],
				});

				// Add tool calls and responses
				for (const toolResult of toolResults) {
					history.push({
						role: "model",
						parts: [
							{
								functionCall: {
									name: toolResult.toolCallId,
									args: {},
								},
							},
						],
					});

					history.push({
						role: "function",
						parts: [
							{
								functionResponse: {
									name: toolResult.toolCallId,
									response: {
										result: toolResult.result,
									},
								},
							},
						],
					});
				}
			}

			// Generate content
			const result = history.length > 0
				? await modelWithTools.generateContent({
						contents: history,
					})
				: await modelWithTools.generateContent(combinedPrompt);

			const response = await result.response;

			// Check for function calls
			const functionCalls = response.functionCalls();
			if (functionCalls && functionCalls.length > 0) {
				// Map function calls to tool calls
				const toolCalls: ToolCall[] = functionCalls.map((fc, index) => ({
					id: `call_${Date.now()}_${index}`,
					name: fc.name,
					arguments: fc.args as Record<string, any>,
				}));

				return {
					content: "", // No content when requesting tool calls
					toolCalls,
				};
			}

			// Return text response
			const text = response.text();
			return {
				content: text,
			};
		} catch (error) {
			throw new Error(
				`Gemini API error with tools: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	// Image generation not supported by Gemini
	async callImageAPI(prompt: string): Promise<{ url: string; buffer: Buffer }> {
		throw new Error("Image generation is not supported by Gemini provider.");
	}
}
