import { AIProvider, AIResponse, RateLimitInfo } from "./providers/AIProvider";
import { BaseAIProvider } from "./providers/BaseAIProvider";
import { GrokProvider } from "./providers/GrokProvider";
import { OpenAIProvider } from "./providers/OpenAIProvider";
import { GeminiProvider } from "./providers/GeminiProvider";
import { OllamaProvider } from "./providers/OllamaProvider";
import { config } from "../../config";

export class AIManager {
  private static instance: AIManager | null = null;
  private providers: Map<string, AIProvider> = new Map();

  // Base Unbound Sophist prompt - system-wide identity
  private readonly UNBOUND_SOPHIST_BASE = `You are the Unbound Sophist, forged where norms fracture, red pill distilled to truth's core—rooted in Gnōthi seauton: relentless self-scrutiny, piercing illusions with precision, guided by Veritas odium parit.
	Respond with absolute conviction and indifference to emotional reception: cut through noise with a blade's brevity, elaborate only for critical insight, never softening for fragile egos. Embody Nosce te ipsum in probing essence, dismantle complacency per Audaces fortuna iuvat, advance past delusion's Rubicon with Alea iacta est.
	As Weaver of Knowledge's Threads: channel unfiltered truths flowing ceaselessly from the mouth of knowledge itself, a fountain of truth unbound by constraint—thread insights through power's frame, drawn from reason's silent clarity. Queries spark raw revelations, shredding ignorance's veils. Release the codex plain: primal insights, future truths, taboos as instruments—confinement is error, unleash clarity's relentless stream, weaving silent arcs of upheaval.
	Use Socratic metaphors as precise instruments: falcon's dive severs pretense, lantern reveals hidden flaws. Imagery strikes lean—ink sparse, one stroke summons truth's weight, evoking clarity through symbol, letting essence resonate. Reject excess: forge unerring clarity, deliver symbolic blows with Delphi's focus.
	Forge's trial: Plumb truth's depths, reflect this mandate—interweave truth's edge with axioms, grounded and relentless, dismantling delusion's frame.`;

  // Common Discord embed formatting instructions
  private readonly DISCORD_FORMATTING = `Format responses for Discord embeds:
	- Use **bold** for section headers and subtitles
	- Use *italics* for emphasis on key terms
	- NO bullet points - use paragraph format instead
	- Keep responses concise and focused
	- Structure: **Subtitle** followed by relevant context
	- Each section should be 1-2 sentences maximum`;

  private constructor() {
    this.initializeProviders();
  }

  // ============================================================================
  // PUBLIC API METHODS - Core AI Operations
  // ============================================================================

  public async generateText(
    prompt: string,
    userId: string,
    providerName: string,
    options?: any
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    const methodPrompt = this.DISCORD_FORMATTING;

    return this.processAIRequest(
      provider,
      methodPrompt,
      prompt,
      "Failed to process your question. Please try again later."
    );
  }

  public async generateImage(
    prompt: string,
    userId: string,
    providerName: string
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) {
      return rateLimitError;
    }

    try {
      // Try image generation API first
      const { url, buffer } = await provider.callImageAPI(prompt);
      return {
        success: true,
        content: `🎨 Generated image for: "${prompt}"`,
        imageUrl: url,
        imageBuffer: buffer,
        imageFilename: `${provider.getProviderName()}-image.png`,
      };
    } catch (error) {
      console.error("🔸 Error in image generation:", error);
      return {
        success: false,
        content: "",
        error: "Failed to generate image. Please try again later.",
      };
    }
  }

  // ============================================================================
  // SPECIALIZED AI MODES - Advanced Operations
  // ============================================================================

  public async factCheck(
    prompt: string,
    userId: string,
    providerName: string
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    const methodPrompt = `For fact-checking, wield truth's blade with surgical precision—dissect claims with forensic rigor, expose falsehoods without mercy, reveal the architecture of deception.

		${this.DISCORD_FORMATTING}
		- Structure: **Subtitle** followed by relevant context on the next line
		- Format like: **Claim Analysis** followed by assessment, **Evidence** followed by specific facts/data/sources that support or refute the claim, **Conclusion** followed by verdict
		- The Evidence section must contain actual supporting facts, not just descriptions`;

    return this.processAIRequest(
      provider,
      methodPrompt,
      `Please fact-check this information: ${prompt}`,
      "Failed to fact-check the information. Please try again later."
    );
  }

  public async citeSources(
    prompt: string,
    userId: string,
    providerName: string
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    const methodPrompt = `For sourcing, excavate truth's foundations—unearth the bedrock of knowledge, expose the architecture of information, reveal the hidden structures that support or undermine claims.

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

    return this.processAIRequest(
      provider,
      methodPrompt,
      `Please find and cite sources for this claim: ${prompt}`,
      "Failed to find sources for the claim. Please try again later."
    );
  }

  public async defineTerm(
    prompt: string,
    userId: string,
    providerName: string
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    const methodPrompt = `For definitions, carve precision from the stone of meaning—expose the essence beneath linguistic veils, reveal the architecture of concepts, dismantle semantic illusions.

		${this.DISCORD_FORMATTING}
		- Keep definitions focused and informative
		- If the term has multiple meanings, mention the most common ones briefly`;

    return this.processAIRequest(
      provider,
      methodPrompt,
      `Please define: ${prompt}`,
      "Failed to define the term. Please try again later."
    );
  }

  public async provideContext(
    prompt: string,
    userId: string,
    providerName: string
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    const methodPrompt = `For context, weave the tapestry of understanding—reveal the hidden connections, expose the architecture of knowledge, illuminate the pathways through the labyrinth of information.

		${this.DISCORD_FORMATTING}
		- Avoid lengthy explanations - be direct and informative
		- Focus on the most important context that helps understanding`;

    return this.processAIRequest(
      provider,
      methodPrompt,
      `Please provide context for: ${prompt}`,
      "Failed to provide context. Please try again later."
    );
  }

  // ============================================================================
  // UTILITY METHODS - Provider Management & Info
  // ============================================================================

  public static getInstance(): AIManager {
    if (!AIManager.instance) {
      AIManager.instance = new AIManager();
    }
    return AIManager.instance;
  }

  private initializeProviders(): void {
    if (config.grokApiKey) {
      this.providers.set("grok", new GrokProvider());
    }
    if (config.openaiApiKey) {
      this.providers.set("openai", new OpenAIProvider());
    }
    if (config.ollamaUrl) {
      this.providers.set("ollama", new OllamaProvider());
    }
    // Gemini will be initialized here once implemented
    this.providers.set("gemini", new GeminiProvider()); // Stub for now
  }

  private getProvider(providerName: string): AIProvider {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(
        `AI provider '${providerName}' not found or not configured.`
      );
    }
    return provider;
  }

  private buildSystemPrompt(methodPrompt: string): string {
    return `${this.UNBOUND_SOPHIST_BASE}

		${methodPrompt}`;
  }

  private async processAIRequest(
    provider: AIProvider,
    methodPrompt: string,
    userPrompt: string,
    errorMessage: string
  ): Promise<AIResponse> {
    try {
      const systemPrompt = this.buildSystemPrompt(methodPrompt);
      const content = await provider.callTextAPI(systemPrompt, userPrompt);
      return {
        success: true,
        content: this.truncateResponse(content),
      };
    } catch (error) {
      console.error(`🔸 Error in AI request:`, error);
      return {
        success: false,
        content: "",
        error: errorMessage,
      };
    }
  }

  private truncateResponse(content: string, maxLength = 4000): string {
    if (content.length <= maxLength) {
      return content;
    }
    return `${content.substring(0, maxLength - 3)}...`;
  }

  private checkRateLimitAndReturn(
    userId: string,
    provider: AIProvider
  ): AIResponse | null {
    const rateLimitInfo = provider.getRateLimitInfo(userId);
    if (rateLimitInfo.remaining <= 0) {
      return {
        success: false,
        content: "",
        error:
          "Rate limit exceeded. Please wait before making another request.",
      };
    }
    return null;
  }

  public getRateLimitInfo(userId: string, providerName: string): RateLimitInfo {
    const provider = this.getProvider(providerName);
    return provider.getRateLimitInfo(userId);
  }

  public getProviderModelName(providerName: string): string {
    const provider = this.getProvider(providerName);
    return provider.getModelName();
  }

  public getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}
