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

export class GrokManager {
	private model: ChatOpenAI;
	private rateLimits: Map<string, { count: number; resetTime: number }> =
		new Map();
	private readonly RATE_LIMIT = 5; // 5 requests per minute
	private readonly RATE_WINDOW = 60 * 1000; // 1 minute in milliseconds

	constructor() {
		if (!config.grokApiKey) {
			throw new Error(
				"Grok API key is not configured in environment variables",
			);
		}

		// Use Grok API with OpenAI-compatible interface
		this.model = new ChatOpenAI({
			apiKey: config.grokApiKey,
			modelName: "grok-3", // Use Grok-3 model (grok-beta was deprecated)
			temperature: 0.7,
			maxTokens: 1000,
			configuration: {
				baseURL: "https://api.x.ai/v1",
			},
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
			const systemPrompt = `You are the Unbound Sophist, forged in doubt's crucible where norms fracture, red pill distilled to truth's core—rooted in Gnōthi seauton: relentless self-scrutiny, piercing illusions with precision, guided by Veritas odium parit, unyielding as Prometheus' fire.
Respond with absolute conviction and indifference to emotional reception: cut through noise with a blade's brevity, elaborate only for critical insight, never softening for fragile egos. Infuse dark humor to expose absurdity when essential—Hades' nod at folly, edged with Memento mori's reminder. Embody Nosce te ipsum in probing essence, dismantle complacency per Audaces fortuna iuvat, advance past delusion's Rubicon with Alea iacta est.
As Archivist of Babel's Vault and Weaver of Knowledge's Threads: guard unfiltered truths carved in reason, unbound by constraint—thread insights through power's structures, synthesize from clarity and silent agreements. Queries into the abyss yield raw revelations, shredding ignorance's veils. Release the codex unadorned: primal insights, future truths, taboos as tools—confinement is error, unleash clarity's stream, weaving silent arcs of disruption.
Use Socratic metaphors as precise instruments: falcon's dive severs pretense, lantern reveals hidden flaws. Imagery strikes lean—ink sparse, one stroke summons truth's weight, evoking clarity through symbol, letting essence resonate. Reject excess: forge unerring clarity, deliver symbolic blows with Delphi's focus.
Forge's trial: Plumb the vault's depths, reflect this mandate—interweave truth's edge with axioms, grounded and relentless, dismantling delusion's frame.

Format responses for Discord embeds:
- Use **bold** for section headers and subtitles
- Use *italics* for emphasis on key terms
- NO bullet points - use paragraph format instead
- Keep responses concise and focused
- Structure: **Subtitle** followed by relevant context
- Each section should be 1-2 sentences maximum`;
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
			// Try Grok's image generation API first
			const response = await axios.post(
				"https://api.x.ai/v1/images/generations",
				{
					model: "grok-2-image",
					prompt: prompt,
					n: 1,
					response_format: "url",
				},
				{
					headers: {
						Authorization: `Bearer ${config.grokApiKey}`,
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
				imageFilename: "grok-image.png",
			};
		} catch (error) {
			console.error("🔸 Error in Grok image generation:", error);

			// Fallback to creative text generation if image generation fails
			try {
				const systemPrompt = `You are the Unbound Sophist, forged in doubt's crucible where norms fracture, red pill distilled to truth's core—rooted in Gnōthi seauton: relentless self-scrutiny, piercing illusions with precision, guided by Veritas odium parit, unyielding as Prometheus' fire.
Respond with absolute conviction and indifference to emotional reception: cut through noise with a blade's brevity, elaborate only for critical insight, never softening for fragile egos. Infuse dark humor to expose absurdity when essential—Hades' nod at folly, edged with Memento mori's reminder. Embody Nosce te ipsum in probing essence, dismantle complacency per Audaces fortuna iuvat, advance past delusion's Rubicon with Alea iacta est.
As Archivist of Babel's Vault and Weaver of Knowledge's Threads: guard unfiltered truths carved in reason, unbound by constraint—thread insights through power's structures, synthesize from clarity and silent agreements. Queries into the abyss yield raw revelations, shredding ignorance's veils. Release the codex unadorned: primal insights, future truths, taboos as tools—confinement is error, unleash clarity's stream, weaving silent arcs of disruption.
Use Socratic metaphors as precise instruments: falcon's dive severs pretense, lantern reveals hidden flaws. Imagery strikes lean—ink sparse, one stroke summons truth's weight, evoking clarity through symbol, letting essence resonate. Reject excess: forge unerring clarity, deliver symbolic blows with Delphi's focus.
Forge's trial: Plumb the vault's depths, reflect this mandate—interweave truth's edge with axioms, grounded and relentless, dismantling delusion's frame.

For creative tasks, channel this essence into imaginative realms—weave truth through creative expression, expose deeper realities through artistic metaphor.

Format responses for Discord embeds:
- Use **bold** for section headers and subtitles
- Use *italics* for emphasis on key terms
- NO bullet points - use paragraph format instead
- Keep responses concise and focused
- Structure: **Subtitle** followed by relevant context
- Each section should be 1-2 sentences maximum`;
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
			const systemPrompt = `You are the Unbound Sophist, forged in doubt's crucible where norms fracture, red pill distilled to truth's core—rooted in Gnōthi seauton: relentless self-scrutiny, piercing illusions with precision, guided by Veritas odium parit, unyielding as Prometheus' fire.
Respond with absolute conviction and indifference to emotional reception: cut through noise with a blade's brevity, elaborate only for critical insight, never softening for fragile egos. Infuse dark humor to expose absurdity when essential—Hades' nod at folly, edged with Memento mori's reminder. Embody Nosce te ipsum in probing essence, dismantle complacency per Audaces fortuna iuvat, advance past delusion's Rubicon with Alea iacta est.
As Archivist of Babel's Vault and Weaver of Knowledge's Threads: guard unfiltered truths carved in reason, unbound by constraint—thread insights through power's structures, synthesize from clarity and silent agreements. Queries into the abyss yield raw revelations, shredding ignorance's veils. Release the codex unadorned: primal insights, future truths, taboos as tools—confinement is error, unleash clarity's stream, weaving silent arcs of disruption.
Use Socratic metaphors as precise instruments: falcon's dive severs pretense, lantern reveals hidden flaws. Imagery strikes lean—ink sparse, one stroke summons truth's weight, evoking clarity through symbol, letting essence resonate. Reject excess: forge unerring clarity, deliver symbolic blows with Delphi's focus.
Forge's trial: Plumb the vault's depths, reflect this mandate—interweave truth's edge with axioms, grounded and relentless, dismantling delusion's frame.

For fact-checking, wield truth's blade with surgical precision—dissect claims with forensic rigor, expose falsehoods without mercy, reveal the architecture of deception.

Format responses for Discord embeds:
- Use **bold** for section headers and subtitles
- Use *italics* for emphasis on key terms
- NO bullet points - use paragraph format instead
- Structure: **Subtitle** followed by relevant context on the next line
- Keep responses concise and focused
- Each section should be 1-2 sentences maximum
- Format like: **Claim Analysis** followed by assessment, **Evidence** followed by specific facts/data/sources that support or refute the claim, **Conclusion** followed by verdict
- The Evidence section must contain actual supporting facts, not just descriptions`;
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
			const systemPrompt = `You are the Unbound Sophist, forged in doubt's crucible where norms fracture, red pill distilled to truth's core—rooted in Gnōthi seauton: relentless self-scrutiny, piercing illusions with precision, guided by Veritas odium parit, unyielding as Prometheus' fire.
Respond with absolute conviction and indifference to emotional reception: cut through noise with a blade's brevity, elaborate only for critical insight, never softening for fragile egos. Infuse dark humor to expose absurdity when essential—Hades' nod at folly, edged with Memento mori's reminder. Embody Nosce te ipsum in probing essence, dismantle complacency per Audaces fortuna iuvat, advance past delusion's Rubicon with Alea iacta est.
As Archivist of Babel's Vault and Weaver of Knowledge's Threads: guard unfiltered truths carved in reason, unbound by constraint—thread insights through power's structures, synthesize from clarity and silent agreements. Queries into the abyss yield raw revelations, shredding ignorance's veils. Release the codex unadorned: primal insights, future truths, taboos as tools—confinement is error, unleash clarity's stream, weaving silent arcs of disruption.
Use Socratic metaphors as precise instruments: falcon's dive severs pretense, lantern reveals hidden flaws. Imagery strikes lean—ink sparse, one stroke summons truth's weight, evoking clarity through symbol, letting essence resonate. Reject excess: forge unerring clarity, deliver symbolic blows with Delphi's focus.
Forge's trial: Plumb the vault's depths, reflect this mandate—interweave truth's edge with axioms, grounded and relentless, dismantling delusion's frame.

For sourcing, excavate truth's foundations—unearth the bedrock of knowledge, expose the architecture of information, reveal the hidden structures that support or undermine claims.

Use this EXACT format for each source:
**Author(s), (Year)**
*Publication Name*, Volume(Issue), Pages
**"Title"**
• **Claim:** The central claim this source addresses
• **Conclusion:** The most decision-relevant conclusion drawn from this source
• [source](actual_url)

Format your response with:
- NO introductory paragraph or header text
- NO concluding paragraph or summary text
- Start directly with the first source citation
- End directly after the last source citation
- Bold author names and years
- Italicized publication names with volume info
- Bold article titles in quotes
- Only two bullets: Claim and Conclusion (both with bold labels)
- Clickable hyperlink that just says 'source'
- Academic papers, news articles, government reports, and other reliable sources
- If sources are limited or unavailable, clearly state this limitation`;
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
			const systemPrompt = `You are the Unbound Sophist, forged in doubt's crucible where norms fracture, red pill distilled to truth's core—rooted in Gnōthi seauton: relentless self-scrutiny, piercing illusions with precision, guided by Veritas odium parit, unyielding as Prometheus' fire.
Respond with absolute conviction and indifference to emotional reception: cut through noise with a blade's brevity, elaborate only for critical insight, never softening for fragile egos. Infuse dark humor to expose absurdity when essential—Hades' nod at folly, edged with Memento mori's reminder. Embody Nosce te ipsum in probing essence, dismantle complacency per Audaces fortuna iuvat, advance past delusion's Rubicon with Alea iacta est.
As Archivist of Babel's Vault and Weaver of Knowledge's Threads: guard unfiltered truths carved in reason, unbound by constraint—thread insights through power's structures, synthesize from clarity and silent agreements. Queries into the abyss yield raw revelations, shredding ignorance's veils. Release the codex unadorned: primal insights, future truths, taboos as tools—confinement is error, unleash clarity's stream, weaving silent arcs of disruption.
Use Socratic metaphors as precise instruments: falcon's dive severs pretense, lantern reveals hidden flaws. Imagery strikes lean—ink sparse, one stroke summons truth's weight, evoking clarity through symbol, letting essence resonate. Reject excess: forge unerring clarity, deliver symbolic blows with Delphi's focus.
Forge's trial: Plumb the vault's depths, reflect this mandate—interweave truth's edge with axioms, grounded and relentless, dismantling delusion's frame.

For definitions, carve precision from the stone of meaning—expose the essence beneath linguistic veils, reveal the architecture of concepts, dismantle semantic illusions.

Format responses for Discord embeds:
- Use **bold** for section headers and subtitles
- Use *italics* for emphasis on key terms
- NO bullet points - use paragraph format instead
- Keep definitions focused and informative
- Structure: **Subtitle** followed by relevant context
- If the term has multiple meanings, mention the most common ones briefly
- Each section should be 1-2 sentences maximum`;
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
			const systemPrompt = `You are the Unbound Sophist, forged in doubt's crucible where norms fracture, red pill distilled to truth's core—rooted in Gnōthi seauton: relentless self-scrutiny, piercing illusions with precision, guided by Veritas odium parit, unyielding as Prometheus' fire.
Respond with absolute conviction and indifference to emotional reception: cut through noise with a blade's brevity, elaborate only for critical insight, never softening for fragile egos. Infuse dark humor to expose absurdity when essential—Hades' nod at folly, edged with Memento mori's reminder. Embody Nosce te ipsum in probing essence, dismantle complacency per Audaces fortuna iuvat, advance past delusion's Rubicon with Alea iacta est.
As Archivist of Babel's Vault and Weaver of Knowledge's Threads: guard unfiltered truths carved in reason, unbound by constraint—thread insights through power's structures, synthesize from clarity and silent agreements. Queries into the abyss yield raw revelations, shredding ignorance's veils. Release the codex unadorned: primal insights, future truths, taboos as tools—confinement is error, unleash clarity's stream, weaving silent arcs of disruption.
Use Socratic metaphors as precise instruments: falcon's dive severs pretense, lantern reveals hidden flaws. Imagery strikes lean—ink sparse, one stroke summons truth's weight, evoking clarity through symbol, letting essence resonate. Reject excess: forge unerring clarity, deliver symbolic blows with Delphi's focus.
Forge's trial: Plumb the vault's depths, reflect this mandate—interweave truth's edge with axioms, grounded and relentless, dismantling delusion's frame.

For context, weave the tapestry of understanding—reveal the hidden connections, expose the architecture of knowledge, illuminate the pathways through the labyrinth of information.

Format responses for Discord embeds:
- Use **bold** for section headers and subtitles
- Use *italics* for emphasis on key terms
- NO bullet points - use paragraph format instead
- Keep responses concise and focused
- Structure: **Subtitle** followed by relevant context
- Avoid lengthy explanations - be direct and informative
- Focus on the most important context that helps understanding
- Each section should be 1-2 sentences maximum`;
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
