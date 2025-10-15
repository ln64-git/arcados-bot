import { ChatOpenAI } from "@langchain/openai";
import axios from "axios";
import { config } from "../../config";

export interface AIResponse {
	success: boolean;
	content: string;
	error?: string;
	imageUrl?: string;
}

export class OpenAIManager {
	private model: ChatOpenAI;
	private rateLimits: Map<string, { count: number; resetTime: number }> =
		new Map();
	private readonly RATE_LIMIT = 5; // 5 requests per minute
	private readonly RATE_WINDOW = 60 * 1000; // 1 minute in milliseconds

	constructor() {
		if (!config.openaiApiKey) {
			throw new Error("🔸 OpenAI API key is not configured");
		}

		// Use OpenAI API
		this.model = new ChatOpenAI({
			apiKey: config.openaiApiKey,
			modelName: "gpt-4o-mini", // Use GPT-4o-mini for cost efficiency
			temperature: 0.7,
			maxTokens: 1000,
		});
	}

	private checkRateLimit(userId: string): boolean {
		const now = Date.now();
		const userLimit = this.rateLimits.get(userId);

		if (!userLimit) {
			this.rateLimits.set(userId, {
				count: 1,
				resetTime: now + this.RATE_WINDOW,
			});
			return true;
		}

		// Reset if window has passed
		if (now > userLimit.resetTime) {
			this.rateLimits.set(userId, {
				count: 1,
				resetTime: now + this.RATE_WINDOW,
			});
			return true;
		}

		// Check if under limit
		if (userLimit.count < this.RATE_LIMIT) {
			userLimit.count++;
			return true;
		}

		return false;
	}

	private truncateResponse(content: string, maxLength = 4000): string {
		if (content.length <= maxLength) {
			return content;
		}
		return `${content.substring(0, maxLength - 3)}...`;
	}

	async askQuestion(prompt: string, userId: string): Promise<AIResponse> {
		if (!this.checkRateLimit(userId)) {
			return {
				success: false,
				content: "",
				error:
					"Rate limit exceeded. Please wait before making another request.",
			};
		}

		try {
			const systemPrompt =
				"You are a helpful AI assistant. Provide clear, accurate, and helpful responses to user questions.";
			const response = await this.model.invoke([
				{ role: "system", content: systemPrompt },
				{ role: "user", content: prompt },
			]);

			const content =
				typeof response.content === "string"
					? response.content
					: String(response.content);
			return {
				success: true,
				content: this.truncateResponse(content),
			};
		} catch (error) {
			console.error("🔸 Error in askQuestion:", error);
			return {
				success: false,
				content: "",
				error: "Failed to process your question. Please try again later.",
			};
		}
	}

	async generateCreative(prompt: string, userId: string): Promise<AIResponse> {
		if (!this.checkRateLimit(userId)) {
			return {
				success: false,
				content: "",
				error:
					"Rate limit exceeded. Please wait before making another request.",
			};
		}

		try {
			// Use OpenAI's DALL-E image generation API
			const response = await axios.post(
				"https://api.openai.com/v1/images/generations",
				{
					model: "dall-e-3",
					prompt: prompt,
					n: 1,
					size: "1024x1024",
					quality: "standard",
					response_format: "url",
				},
				{
					headers: {
						Authorization: `Bearer ${config.openaiApiKey}`,
						"Content-Type": "application/json",
					},
				},
			);

			const imageUrl = response.data.data[0].url;
			return {
				success: true,
				content: `🎨 Generated image for: "${prompt}"`,
				imageUrl: imageUrl,
			};
		} catch (error) {
			console.error("🔸 Error in generateCreative:", error);

			// Fallback to text generation if image generation fails
			try {
				const systemPrompt =
					"You are a creative AI assistant. Generate imaginative, creative, and engaging content based on user prompts. Be creative and original.";
				const response = await this.model.invoke([
					{ role: "system", content: systemPrompt },
					{
						role: "user",
						content: `Create something creative based on: ${prompt}`,
					},
				]);

				const content =
					typeof response.content === "string"
						? response.content
						: String(response.content);
				return {
					success: true,
					content: this.truncateResponse(content),
				};
			} catch (fallbackError) {
				console.error("🔸 Error in fallback text generation:", fallbackError);
				return {
					success: false,
					content: "",
					error: "Failed to generate creative content. Please try again later.",
				};
			}
		}
	}

	async factCheck(prompt: string, userId: string): Promise<AIResponse> {
		if (!this.checkRateLimit(userId)) {
			return {
				success: false,
				content: "",
				error:
					"Rate limit exceeded. Please wait before making another request.",
			};
		}

		try {
			const systemPrompt =
				"You are a fact-checking AI assistant. Analyze the given information and provide accurate, well-researched facts. If something cannot be verified, clearly state that. Always be objective and cite sources when possible.";
			const response = await this.model.invoke([
				{ role: "system", content: systemPrompt },
				{
					role: "user",
					content: `Please fact-check this information: ${prompt}`,
				},
			]);

			const content =
				typeof response.content === "string"
					? response.content
					: String(response.content);
			return {
				success: true,
				content: this.truncateResponse(content),
			};
		} catch (error) {
			console.error("🔸 Error in factCheck:", error);
			return {
				success: false,
				content: "",
				error: "Failed to fact-check the information. Please try again later.",
			};
		}
	}

	getRateLimitInfo(userId: string): { remaining: number; resetTime: number } {
		const userLimit = this.rateLimits.get(userId);
		if (!userLimit) {
			return { remaining: this.RATE_LIMIT, resetTime: 0 };
		}

		const now = Date.now();
		if (now > userLimit.resetTime) {
			return { remaining: this.RATE_LIMIT, resetTime: 0 };
		}

		return {
			remaining: Math.max(0, this.RATE_LIMIT - userLimit.count),
			resetTime: userLimit.resetTime,
		};
	}
}
