import { ChatOpenAI } from "@langchain/openai";
import axios from "axios";
import { config } from "../../config";

export interface AIResponse {
	success: boolean;
	content: string;
	error?: string;
	imageUrl?: string;
	imageBuffer?: Buffer;
	imageFilename?: string;
}

export class OpenAIManager {
	private model: ChatOpenAI;
	private rateLimits: Map<string, { count: number; resetTime: number }> =
		new Map();
	private readonly RATE_LIMIT = 5; // 5 requests per minute
	private readonly RATE_WINDOW = 60 * 1000; // 1 minute in milliseconds

	constructor() {
		if (!config.openaiApiKey) {
			throw new Error(
				"OpenAI API key is not configured in environment variables",
			);
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
				"You are a helpful AI assistant providing concise responses for Discord embeds. Format your responses using Discord's formatting features:\n\n- Use **bold** for section headers and subtitles\n- Use *italics* for emphasis on key terms\n- NO bullet points - use paragraph format instead\n- Keep responses concise and focused\n- Structure: **Subtitle** followed by relevant context\n- Avoid lengthy explanations - be direct and informative\n- Each section should be 1-2 sentences maximum";
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

			// Download the image so we can attach it directly to Discord (avoids URL expiry)
			const imageDownload = await axios.get(imageUrl, {
				responseType: "arraybuffer",
			});
			const imageBuffer = Buffer.from(imageDownload.data);
			return {
				success: true,
				content: `🎨 Generated image for: "${prompt}"`,
				imageUrl: imageUrl,
				imageBuffer,
				imageFilename: "ai-image.png",
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
				"You are a fact-checking AI assistant providing concise responses for Discord embeds. Analyze the given information and provide accurate, well-researched facts. Format your response using Discord's formatting features:\n\n- Use **bold** for section headers and subtitles\n- Use *italics* for emphasis on key terms\n- NO bullet points - use paragraph format instead\n- Structure: **Subtitle** followed by relevant context on the next line\n- Keep responses concise and focused\n- If something cannot be verified, clearly state that\n- Always be objective and cite sources when possible\n- Each section should be 1-2 sentences maximum\n- Format like: **Claim Analysis** followed by assessment, **Evidence** followed by specific facts/data/sources that support or refute the claim, **Conclusion** followed by verdict\n- The Evidence section must contain actual supporting facts, not just descriptions";
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

	async citeSources(prompt: string, userId: string): Promise<AIResponse> {
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
				"You are a research AI assistant specialized in finding and citing credible sources. When given a claim or statement, provide relevant sources that support or refute the claim. Use this EXACT format for each source:\n\n**Author(s), (Year)**\n*Publication Name*, Volume(Issue), Pages\n**\"Title\"**\n• **Claim:** The central claim this source addresses\n• **Conclusion:** The most decision-relevant conclusion drawn from this source\n• [source](actual_url)\n\nFormat your response with:\n- NO introductory paragraph or header text\n- NO concluding paragraph or summary text\n- Start directly with the first source citation\n- End directly after the last source citation\n- Bold author names and years\n- Italicized publication names with volume info\n- Bold article titles in quotes\n- Only two bullets: Claim and Conclusion (both with bold labels)\n- Clickable hyperlink that just says 'source'\n- Academic papers, news articles, government reports, and other reliable sources\n- If sources are limited or unavailable, clearly state this limitation";
			const response = await this.model.invoke([
				{ role: "system", content: systemPrompt },
				{
					role: "user",
					content: `Please find and cite sources for this claim: ${prompt}`,
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
			console.error("🔸 Error in citeSources:", error);
			return {
				success: false,
				content: "",
				error: "Failed to find sources for the claim. Please try again later.",
			};
		}
	}

	async defineTerm(prompt: string, userId: string): Promise<AIResponse> {
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
				"You are a helpful AI assistant specialized in providing clear, concise definitions for Discord embeds. When given a term, concept, or phrase, provide a precise and easy-to-understand definition. Format your response using Discord's formatting features:\n\n- Use **bold** for section headers and subtitles\n- Use *italics* for emphasis on key terms\n- NO bullet points - use paragraph format instead\n- Keep definitions focused and informative\n- Structure: **Subtitle** followed by relevant context\n- If the term has multiple meanings, mention the most common ones briefly\n- Each section should be 1-2 sentences maximum";
			const response = await this.model.invoke([
				{ role: "system", content: systemPrompt },
				{
					role: "user",
					content: `Please define: ${prompt}`,
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
			console.error("🔸 Error in defineTerm:", error);
			return {
				success: false,
				content: "",
				error: "Failed to define the term. Please try again later.",
			};
		}
	}

	async provideContext(prompt: string, userId: string): Promise<AIResponse> {
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
				"You are a helpful AI assistant specialized in providing comprehensive context and background information for Discord embeds. When given a topic, provide relevant background information in a format suitable for Discord embeds. Use Discord's formatting features:\n\n- Use **bold** for section headers and subtitles\n- Use *italics* for emphasis on key terms\n- NO bullet points - use paragraph format instead\n- Keep responses concise and focused\n- Structure: **Subtitle** followed by relevant context\n- Avoid lengthy explanations - be direct and informative\n- Focus on the most important context that helps understanding\n- Each section should be 1-2 sentences maximum";
			const response = await this.model.invoke([
				{ role: "system", content: systemPrompt },
				{
					role: "user",
					content: `Please provide context for: ${prompt}`,
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
			console.error("🔸 Error in provideContext:", error);
			return {
				success: false,
				content: "",
				error: "Failed to provide context. Please try again later.",
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
