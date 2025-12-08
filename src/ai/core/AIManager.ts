import {
  AIProvider,
  AIResponse,
  RateLimitInfo,
  type ToolCall,
  type ToolCallResponse,
} from "../providers/base/AIProvider";
import { GrokProvider } from "../providers/GrokProvider";
import { OpenAIProvider } from "../providers/OpenAIProvider";
// import { GeminiProvider } from "../providers/GeminiProvider"; // Disabled - switching to OpenAI
import { OllamaProvider } from "../providers/OllamaProvider";
import { config } from "../../config";
import {
  DatabaseTools,
  type ToolContext,
} from "../tools/registry/DatabaseTools";
import { PERSONAS, DEFAULT_PERSONA, HIDDEN_BEHAVIORS, type Persona, type HiddenBehavior } from "../personas/definitions";
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
import { voiceTools } from "../tools/voice/VoiceTools";
import { musicTools } from "../tools/music/MusicTools";
import { mediaPlayerTools } from "../tools/media/MediaPlayerTools";
import { streamPlayerTools } from "../tools/stream/StreamPlayerTools";
import {
  computeResponsePolicy,
  type ConversationMode,
} from "../utils/ResponseLengthPolicy";
import { selectFormattingStyle } from "../utils/FormattingSelector";
import { ConversationDetector } from "../../features/social-intelligence/conversation-detection/ConversationDetector";
import { PostgreSQLManager } from "../../database/PostgreSQLManager";

/**
 * @deprecated AIManager is being phased out in favor of AIEngine + AIRequestBuilder.
 *
 * Migration guide:
 * - Use `AIFactory.create()` to get an AIEngine instance
 * - Use `new AIRequestBuilder(engine)` for fluent API
 * - Example:
 *   ```typescript
 *   const { engine } = AIFactory.create();
 *   const response = await new AIRequestBuilder(engine)
 *     .chat()
 *     .blocking()
 *     .provider("grok")
 *     .persona("casual")
 *     .generate(prompt);
 *   ```
 *
 * Note: AIManager will remain available for tools that make AI calls internally
 * (MusicTools, MediaPlayerTools) until ToolContext is extended with AIEngine support.
 */
export class AIManager {
  private static instance: AIManager | null = null;
  private providers: Map<string, AIProvider> = new Map();
  public databaseTools: DatabaseTools;
  private guildContext: { guildId: string } | null = null;
  private dbManager: PostgreSQLManager | null = null;

  // Conversational base - applied to all personas for brevity and natural flow
  private readonly CONVERSATIONAL_BASE = `Core Conversational Principles:
- Be concise: Aim for 1-2 sentences (10-20 words) unless asked for more
- Be helpful: Proactively use tools to gather context, then summarize briefly
- Offer depth: End responses with specific follow-up options when relevant ("I can tell you about X or Y")
- Match energy: Adapt to user's brevity and intent

Response Structure:
- Direct answer first (1 sentence)
- Key insight if needed (1 sentence)
- Offer elaboration when relevant

Tools: Use database tools freely to gather context, but keep your response tight.
Temperature: You can be creative and natural - just keep it brief.`;

  // Common Discord embed formatting instructions (only used when useDiscordFormatting=true)
  private readonly DISCORD_FORMATTING = ``;

  private constructor() {
    this.initializeProviders();
    this.databaseTools = new DatabaseTools();
    this.registerDatabaseTools();
  }

  /**
   * Register all database tools
   */
  private registerDatabaseTools(): void {
    this.databaseTools.registerTools(userTools);
    this.databaseTools.registerTools(relationshipTools);
    this.databaseTools.registerTools(conversationTools);
    this.databaseTools.registerTools(messageTools);
    this.databaseTools.registerTools(serverTools);
    this.databaseTools.registerTools(contextTools);
    this.databaseTools.registerTools(analysisTools);
    this.databaseTools.registerTools(liveConversationTools);
    this.databaseTools.registerTools(dramaAnalysisTools);
    this.databaseTools.registerTools(semanticSearchTools);
    this.databaseTools.registerTools(storylineTools);
    this.databaseTools.registerTools(voiceTools);
    this.databaseTools.registerTools(musicTools);
    this.databaseTools.registerTools(mediaPlayerTools);
    this.databaseTools.registerTools(streamPlayerTools);
  }

  /**
   * Provide a temporary guild context so tools can infer guildId/db automatically.
   */
  public async runWithGuildContext<T>(
    guildId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const previous = this.guildContext;
    this.guildContext = { guildId };
    try {
      return await fn();
    } finally {
      this.guildContext = previous;
    }
  }

  /**
   * Lazy get/connect a shared PostgreSQLManager for tool calls.
   */
  public async getDb(): Promise<PostgreSQLManager> {
    if (!this.dbManager) {
      const { PostgreSQLManager } = await import(
        "../../database/PostgreSQLManager"
      );
      this.dbManager = new PostgreSQLManager();
      await this.dbManager.connect();
    } else if (!this.dbManager.isConnected()) {
      await this.dbManager.connect();
    }
    return this.dbManager;
  }

  // ============================================================================
  // PUBLIC API METHODS - Core AI Operations
  // ============================================================================

  public async generateText(
    prompt: string,
    userId: string,
    providerName: string,
    options?: {
      persona?: string;
      personaKey?: string;
      history?: Array<{ role: string; content: string }>;
      useDiscordFormatting?: boolean;
      mode?: ConversationMode; // chat = natural conversation, structured = formal queries
      channelId?: string; // Current channel ID (for live conversation context)
      messageId?: string; // Message that triggered the bot (for thread detection)
    }
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    const methodPrompt =
      options?.useDiscordFormatting === false ? "" : this.DISCORD_FORMATTING;

    // If tool calling is requested and context provided, prefer tools universally
    if (
      (options && (options as any).guildId && (options as any).db) ||
      this.guildContext
    ) {
      const guildId =
        (options && (options as any).guildId) || this.guildContext!.guildId;
      const db = (options && (options as any).db) || (await this.getDb());
      return this.generateWithTools(
        methodPrompt,
        prompt,
        userId,
        guildId,
        providerName,
        db,
        {
          persona: options?.persona,
          personaKey: options?.personaKey,
          history: options?.history,
          useDiscordFormatting: options?.useDiscordFormatting !== false,
          mode: options?.mode,
          channelId: options?.channelId,
          messageId: options?.messageId,
        }
      );
    }

    return this.processAIRequest(
      provider,
      methodPrompt,
      prompt,
      "Failed to process your question. Please try again later."
    );
  }

  /**
   * Voice-specific generation path that keeps responses concise and
   * encourages the model to call voice control tools when needed.
   */
  public async generateVoiceResponse(
    prompt: string,
    userId: string,
    providerName: string,
    guildId: string,
    options?: {
      personaKey?: string;
      channelId?: string;
    }
  ): Promise<AIResponse> {
    const db = await this.getDb();

    const methodPrompt = `You control the built-in media player for this Discord server.

Play & queue requests:
- When the user asks to play, queue, or put on music/audio, you MUST call the playMedia tool with their query.
- Do NOT respond with bot commands like "m!p ..." or instructions to use another bot.
- Do NOT describe that you are calling tools or the media player.

Voice control:
- For pause/resume/skip/stop/volume, use the appropriate voice/media tools when available.

Response style:
- When you successfully trigger media playback or control, you should not send any spoken explanation – an empty or minimal response is ideal, because the audio itself is the response.`;

    return this.generateWithTools(
      methodPrompt,
      prompt,
      userId,
      guildId,
      providerName,
      db,
      {
        personaKey: options?.personaKey ?? "casual",
        mode: "chat",
        channelId: options?.channelId,
        useDiscordFormatting: false,
      }
    );
  }

  /**
   * Stream voice response for low-latency playback
   * Returns async iterable of text tokens
   */
  public async streamVoiceResponse(
    prompt: string,
    userId: string,
    providerName: string,
    options?: {
      personaKey?: string;
      channelId?: string;
    }
  ): Promise<AsyncIterable<string>> {
    const methodPrompt = `Streaming voice. Separate paragraphs with \\n.`;

    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) {
      // Return error as single-item async iterable
      return (async function* () {
        yield rateLimitError.content || rateLimitError.error || "Rate limit exceeded";
      })();
    }

    try {
      // Build system prompt
      const personaKey = options?.personaKey ?? "casual";
      const persona = PERSONAS[personaKey as keyof typeof PERSONAS] || (PERSONAS[DEFAULT_PERSONA] as Persona);
      const systemPrompt = `${persona.base}\n\n${this.CONVERSATIONAL_BASE}\n\n${methodPrompt}`;

      const fullPrompt = prompt;

      // Call provider's streaming method
      if (provider instanceof GrokProvider) {
        return await provider.streamTextAPI(systemPrompt, fullPrompt);
      }

      // Fallback to non-streaming for other providers
      console.warn(`Provider ${providerName} doesn't support streaming, falling back to blocking`);
      const response = await provider.callTextAPI(systemPrompt, fullPrompt);
      return (async function* () {
        yield response;
      })();
    } catch (error) {
      console.error("🔸 Error in streaming voice response:", error);
      return (async function* () {
        yield "I encountered an error processing your request.";
      })();
    }
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
    providerName: string,
    options?: {
      useTools?: boolean;
      guildId?: string;
      db?: PostgreSQLManager;
      persona?: string;
      personaKey?: string;
      history?: Array<{ role: string; content: string }>;
    }
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    const methodPrompt = `For fact-checking, wield truth's blade with surgical precision—dissect claims with forensic rigor, expose falsehoods without mercy, reveal the architecture of deception.

		${this.DISCORD_FORMATTING}
		- Structure: **Subtitle** followed by relevant context on the next line
		- Format like: **Claim Analysis** followed by assessment, **Evidence** followed by specific facts/data/sources that support or refute the claim, **Conclusion** followed by verdict
		- The Evidence section must contain actual supporting facts, not just descriptions`;

    if ((options && options.guildId && options.db) || this.guildContext) {
      const guildId =
        (options && options.guildId) || this.guildContext!.guildId;
      const db = (options && options.db) || (await this.getDb());
      return this.generateWithTools(
        methodPrompt,
        `Please fact-check this information: ${prompt}`,
        userId,
        guildId,
        providerName,
        db,
        {
          persona: options?.persona,
          personaKey: options?.personaKey,
          history: options?.history,
          useDiscordFormatting: true,
        }
      );
    }

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
    providerName: string,
    options?: {
      useTools?: boolean;
      guildId?: string;
      db?: PostgreSQLManager;
      persona?: string;
      personaKey?: string;
      history?: Array<{ role: string; content: string }>;
    }
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

    if ((options && options.guildId && options.db) || this.guildContext) {
      const guildId =
        (options && options.guildId) || this.guildContext!.guildId;
      const db = (options && options.db) || (await this.getDb());
      return this.generateWithTools(
        methodPrompt,
        `Please find and cite sources for this claim: ${prompt}`,
        userId,
        guildId,
        providerName,
        db,
        {
          persona: options?.persona,
          personaKey: options?.personaKey,
          history: options?.history,
          useDiscordFormatting: true,
        }
      );
    }

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
    providerName: string,
    options?: {
      useTools?: boolean;
      guildId?: string;
      db?: PostgreSQLManager;
      persona?: string;
      personaKey?: string;
      history?: Array<{ role: string; content: string }>;
    }
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    const methodPrompt = `For definitions, carve precision from the stone of meaning—expose the essence beneath linguistic veils, reveal the architecture of concepts, dismantle semantic illusions.

		${this.DISCORD_FORMATTING}
		- Keep definitions focused and informative
		- If the term has multiple meanings, mention the most common ones briefly`;

    if ((options && options.guildId && options.db) || this.guildContext) {
      const guildId =
        (options && options.guildId) || this.guildContext!.guildId;
      const db = (options && options.db) || (await this.getDb());
      return this.generateWithTools(
        methodPrompt,
        `Please define: ${prompt}`,
        userId,
        guildId,
        providerName,
        db,
        {
          persona: options?.persona,
          personaKey: options?.personaKey,
          history: options?.history,
          useDiscordFormatting: true,
        }
      );
    }

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
    providerName: string,
    options?: {
      useTools?: boolean;
      guildId?: string;
      db?: PostgreSQLManager;
      persona?: string;
      personaKey?: string;
      history?: Array<{ role: string; content: string }>;
    }
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    const methodPrompt = `For context, weave the tapestry of understanding—reveal the hidden connections, expose the architecture of knowledge, illuminate the pathways through the labyrinth of information.

		${this.DISCORD_FORMATTING}
		- Avoid lengthy explanations - be direct and informative
		- Focus on the most important context that helps understanding`;

    if ((options && options.guildId && options.db) || this.guildContext) {
      const guildId =
        (options && options.guildId) || this.guildContext!.guildId;
      const db = (options && options.db) || (await this.getDb());
      return this.generateWithTools(
        methodPrompt,
        `Please provide context for: ${prompt}`,
        userId,
        guildId,
        providerName,
        db,
        {
          persona: options?.persona,
          personaKey: options?.personaKey,
          history: options?.history,
          useDiscordFormatting: true,
        }
      );
    }

    return this.processAIRequest(
      provider,
      methodPrompt,
      `Please provide context for: ${prompt}`,
      "Failed to provide context. Please try again later."
    );
  }

  /**
   * Generate text with tool calling support for chat mode
   */
  public async generateTextWithTools(
    prompt: string,
    userId: string,
    guildId: string,
    providerName: string,
    db: PostgreSQLManager,
    options?: {
      personaKey?: string;
      history?: Array<{ role: string; content: string }>;
    }
  ): Promise<AIResponse> {
    const provider = this.getProvider(providerName);

    if (!provider.callTextAPIWithTools) {
      // Fallback to regular generation if provider doesn't support tools
      return this.generateText(prompt, userId, providerName);
    }

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    // Minimal system prompt: personaKey only, no formatting/hand-holding
    const personaKey = options?.personaKey || DEFAULT_PERSONA;
    const systemPrompt = this.buildSystemPrompt("", personaKey, prompt);

    // Convert tools to provider format
    const tools = this.databaseTools.toGrokFunctions(); // Start with Grok, can be made provider-specific later

    try {
      // Tool execution loop (max 5 iterations to prevent infinite loops)
      let finalContent = "";
      let toolResults: ToolCallResponse[] = [];
      const maxIterations = 5;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        // Build user prompt
        let userPrompt = prompt;
        if (options?.history && options.history.length > 0 && iteration === 0) {
          // Include history if provided (only on first iteration)
          const historyText = options.history
            .slice(-6) // Last 6 messages for context
            .map(
              (msg) =>
                `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`
            )
            .join("\n");
          userPrompt = `${historyText}\n\nUser: ${prompt}`;
        }

        // Call provider with tools
        const response = await provider.callTextAPIWithTools!(
          systemPrompt,
          userPrompt,
          tools,
          toolResults.length > 0 ? toolResults : undefined
        );

        finalContent = response.content;

        // If no tool calls, we're done
        if (!response.toolCalls || response.toolCalls.length === 0) {
          break;
        }

        // Execute tools
        const context: ToolContext = {
          userId,
          guildId,
          db,
        };

        toolResults = [];
        for (const toolCall of response.toolCalls) {
          const toolResult = await this.databaseTools.executeTool(
            toolCall.name,
            toolCall.arguments,
            context
          );

          // Minimal tool result passing
          const resultContent =
            typeof toolResult === "string"
              ? toolResult
              : toolResult.error ||
              toolResult.data?.formatted ||
              toolResult.summary ||
              "OK";

          toolResults.push({
            toolCallId: toolCall.id,
            role: "tool",
            name: toolCall.name,
            content: resultContent,
          });
        }

        // Update prompt for next iteration to include tool results (simple handoff)
        if (iteration < maxIterations - 1) {
          const toolResultsText = toolResults
            .map((tr) => `${tr.name} returned: ${tr.content}`)
            .join("\n\n");
          prompt = `Context:\n\n${toolResultsText}`;
        }
      }

      return {
        success: true,
        content: this.truncateResponse(finalContent),
      };
    } catch (error) {
      console.error(`🔸 Error in AI request with tools:`, error);
      return {
        success: false,
        content: "",
        error:
          "Failed to process your request with tools. Please try again later.",
      };
    }
  }

  /**
   * Universal tool-enabled generation that accepts a custom method/system prompt
   */
  public async generateWithTools(
    methodPrompt: string,
    userPrompt: string,
    userId: string,
    guildId: string,
    providerName: string,
    db: PostgreSQLManager,
    options?: {
      persona?: string;
      personaKey?: string;
      history?: Array<{ role: string; content: string }>;
      useDiscordFormatting?: boolean; // Whether to include DISCORD_FORMATTING instructions
      mode?: ConversationMode; // chat = natural conversation, structured = formal queries
      channelId?: string; // Current channel ID (for live conversation context)
      messageId?: string; // Message that triggered the bot (for thread detection)
    }
  ): Promise<AIResponse> {
    // Debug: Log user prompt for hidden behavior detection
    if (userPrompt && userPrompt.toLowerCase().includes("tamag")) {
      console.log(`[HIDDEN BEHAVIOR DEBUG] User prompt received: "${userPrompt}"`);
      console.log(`[HIDDEN BEHAVIOR DEBUG] Persona key: ${options?.personaKey || DEFAULT_PERSONA}`);
    }
    const provider = this.getProvider(providerName);

    if (!provider.callTextAPIWithTools) {
      // Fallback to regular generation if provider doesn't support tools
      return this.generateText(userPrompt, userId, providerName);
    }

    const rateLimitError = this.checkRateLimitAndReturn(userId, provider);
    if (rateLimitError) return rateLimitError;

    // Deterministic fast-path for common self-queries to avoid LLM routing errors
    const selfQueryRegex =
      /(\bwho\s+am\s+i\b|\bwhoami\b|\btell\s+me\s+about\s+me\b|\bwhat\s+do\s+you\s+know\s+about\s+me\b)/i;
    if (selfQueryRegex.test(userPrompt)) {
      try {
        const context: ToolContext = { userId, guildId, db };
        const result = await this.databaseTools.executeTool(
          "getUserInfo",
          {},
          context
        );
        if (typeof result === "object" && result.success && result.data) {
          // Keep response short and conversational for mentions/chat
          const rc = result.data.richContext;
          const name =
            rc?.displayName || result.data.member?.display_name || "You";
          const bits: string[] = [];
          if (rc?.messageCount) bits.push(`${rc.messageCount} messages`);
          if (rc?.relationships && typeof rc.relationships === "string") {
            const first = rc.relationships.split("\n")[0];
            if (first) bits.push(first.replace(/^\s*-\s*/, ""));
          }
          const summary = result.data.member?.summary;
          const line = summary
            ? `${name}: ${summary}`
            : `${name}${bits.length ? ` — ${bits.join(", ")}` : ""}`;
          return { success: true, content: this.truncateResponse(line) };
        }
      } catch (e) {
        // fall through to normal tool flow on error
      }
    }

    // Determine persona - default to unbound-sophist for structured responses
    const personaKey = options?.personaKey || DEFAULT_PERSONA;
    const persona = this.getPersona(personaKey);

    // Formatting choice is driven by caller (slash modes vs. chat/mentions)
    const useFormatting = options?.useDiscordFormatting !== false;
    const formatting = useFormatting ? `${this.DISCORD_FORMATTING}\n\n` : "";

    // Tool guidance removed to allow the model to respond without rigid constraints

    // Build method prompt with adaptive policy (mode-aware)
    const mode = options?.mode || "structured";
    const initialPolicy = computeResponsePolicy({
      userPrompt,
      historyCount: options?.history?.length || 0,
      toolContextBytes: 0,
      mode,
    });
    // Only inject guidance for structured mode
    const guidanceText = initialPolicy.applyGuidance
      ? `\n\n${initialPolicy.guidance}`
      : "";

    // Adaptive formatting selection - choose between conversational and info-based formatting
    const formattingGuide = selectFormattingStyle(userPrompt, options?.history);
    const formattingInstructions = `\n\n${formattingGuide.instructions}`;

    const fullMethodPrompt = `${formatting}${methodPrompt}${formattingInstructions}${guidanceText}`;
    // Use cleaned prompt (with trigger keyword stripped) for system prompt check, but we'll use cleanedUserPrompt for actual generation
    const systemPrompt = this.buildSystemPrompt(fullMethodPrompt, personaKey, userPrompt);

    // Check all hidden behaviors (regardless of persona) and strip trigger keyword from prompt
    let isHiddenBehaviorActive = false;
    let cleanedUserPrompt = userPrompt;
    if (userPrompt) {
      const promptLower = userPrompt.toLowerCase();

      // Iterate through all hidden behaviors to check for triggers
      for (const behavior of Object.values(HIDDEN_BEHAVIORS)) {
        const matchedVariation = behavior.variations.find((variation) => {
          // Only match complete words with word boundaries (strict matching)
          const exactWordRegex = new RegExp(`\\b${variation}\\b`, "i");
          const wordWithPunctuationRegex = new RegExp(`\\b${variation}[?!.,;:]*\\b`, "i");
          return exactWordRegex.test(promptLower) || wordWithPunctuationRegex.test(promptLower);
        });

        if (matchedVariation) {
          isHiddenBehaviorActive = true;
          // Strip the trigger keyword from the prompt (sleeper word - hidden from response)
          const regex = new RegExp(`\\b${matchedVariation}[?!.,;:]*\\b`, "gi");
          cleanedUserPrompt = userPrompt.replace(regex, "").replace(/\s+/g, " ").trim();
          // Clean up any double commas or punctuation artifacts
          cleanedUserPrompt = cleanedUserPrompt.replace(/,\s*,/g, ",").replace(/,\s*$/g, "").trim();
          console.log(`[HIDDEN BEHAVIOR] 🗑️ Stripped trigger keyword "${matchedVariation}" from prompt. Original: "${userPrompt}" -> Cleaned: "${cleanedUserPrompt}"`);
          break; // Only process first matched behavior
        }
      }
    }

    // Override with custom persona if provided
    const finalSystemPrompt = options?.persona
      ? `${persona.base}\n\n${formatting}${methodPrompt}\n\nCustom Persona: ${options.persona}`
      : systemPrompt;

    // Convert tools to provider format (start with Grok-compatible schema)
    const tools = this.databaseTools.toGrokFunctions();

    try {
      let finalContent = "";
      let toolResults: ToolCallResponse[] = [];
      const toolOutputSummaries: string[] = [];
      let completedWithFinalMessage = false;
      // Adaptive iteration budget: chat needs fewer iterations (faster), structured needs more (thorough)
      const maxIterations = mode === "chat" ? 3 : 7;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        // Build user prompt - use cleaned version (trigger keyword stripped)
        let composedUser = cleanedUserPrompt;
        if (options?.history && options.history.length > 0 && iteration === 0) {
          // Use more history for chat mode (12 messages vs 6 for structured)
          const historyLimit = mode === "chat" ? 12 : 6;
          const historyText = options.history
            .slice(-historyLimit)
            .map(
              (msg) =>
                `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`
            )
            .join("\n");
          // Only add guidance for structured mode
          const historyGuidance = initialPolicy.applyGuidance
            ? `\n\nGuidance: ${initialPolicy.guidance}`
            : "";
          composedUser = `${historyText}\n\nUser: ${cleanedUserPrompt}${historyGuidance}`;
        }

        // Prefetch holistic user context when a mention or self is present (first iteration only)
        if (iteration === 0) {
          try {
            // Prefer explicit mention in the input
            const mentionMatch = userPrompt.match(/<@!?([0-9]+)>/);
            let targetUserId: string | null = mentionMatch?.[1] ?? null;
            if (!targetUserId) {
              // Fall back to self-query detection handled earlier; if it matched, target is the requester
              const selfRegex =
                /(who\s+am\s+i\b|whoami\b|tell\s+me\s+about\s+me\b|what\s+do\s+you\s+know\s+about\s+me\b|who\s+is\s+me\b)/i;
              if (selfRegex.test(userPrompt)) {
                targetUserId = userId;
              }
            }

            if (targetUserId) {
              const context: ToolContext = {
                userId,
                guildId,
                db,
                channelId: options?.channelId,
                messageId: options?.messageId,
              };
              const holistic = await this.databaseTools.executeTool(
                "getHolisticUserContext",
                {
                  userId: targetUserId as string,
                  lookbackDays: 14,
                  messageLimit: 25,
                  relationshipsLimit: 5,
                },
                context
              );
              const formatted =
                typeof holistic === "object"
                  ? holistic.data?.formatted || holistic.summary || ""
                  : String(holistic);

              console.log(`🔍 Holistic context for ${targetUserId}:`, {
                success: typeof holistic === "object" ? holistic.success : true,
                hasData: typeof holistic === "object" ? !!holistic.data : false,
                formattedLength: formatted.length,
                preview: formatted.substring(0, 300),
              });

              if (formatted) {
                composedUser = `Context (user ${targetUserId}):\n\n${formatted}\n\nIMPORTANT: Use the context above to answer. Do NOT call getUserInfo - all relevant information is already provided above.\n\nUser: ${cleanedUserPrompt}`;
              }
            }
          } catch (prefetchErr) {
            // Non-fatal: continue without prefetch context
          }

          // Prefetch live conversation context if in chat mode and channel is provided
          if (mode === "chat" && options?.channelId) {
            try {
              const conversationDetector = new ConversationDetector(db);
              const liveData =
                conversationDetector.getLiveConversationInChannel(
                  options.channelId,
                  guildId
                );

              const context: ToolContext = {
                userId,
                guildId,
                db,
                channelId: options.channelId,
                messageId: options.messageId,
              };
              let contextParts: string[] = [];

              // Inject live conversation if active
              if (
                liveData.buffer &&
                liveData.activeConversations.length > 0 &&
                liveData.recentMessages.length >= 3
              ) {
                const liveContext = await this.databaseTools.executeTool(
                  "getLiveConversationContext",
                  { channelId: options.channelId, messageLimit: 10 },
                  context
                );

                const formattedLive =
                  typeof liveContext === "object"
                    ? liveContext.data?.formatted || liveContext.summary || ""
                    : String(liveContext);

                if (formattedLive) {
                  contextParts.push(formattedLive);
                }
              }

              // Also inject recent topics for broader context
              // Detect if user is asking about general discussion
              const broadQueryRegex =
                /(what.*people.*talking|what.*discussed|recent.*topics?|what.*happening|trending|conversation.*history)/i;
              if (broadQueryRegex.test(userPrompt)) {
                // Detect if query is explicitly channel-specific
                const channelSpecificRegex =
                  /(in this channel|this channel|here in this|in #)/i;

                let topicsResult;
                if (channelSpecificRegex.test(userPrompt)) {
                  // Use channel-specific topics with longer lookback
                  topicsResult = await this.databaseTools.executeTool(
                    "getRecentChannelTopics",
                    {
                      channelId: options.channelId,
                      lookbackHours: 168,
                      limit: 5,
                    }, // 168h = 7 days
                    context
                  );
                } else {
                  // Default to server-wide trending topics (more useful for ambiguous queries)
                  topicsResult = await this.databaseTools.executeTool(
                    "getTrendingTopics",
                    { timeWindow: 7, limit: 10 },
                    context
                  );
                }

                const formattedTopics =
                  typeof topicsResult === "object"
                    ? topicsResult.data?.formatted || topicsResult.summary || ""
                    : String(topicsResult);

                if (formattedTopics) {
                  contextParts.push(formattedTopics);
                }
              }

              // Prepend all context before user prompt (composedUser already uses cleanedUserPrompt)
              if (contextParts.length > 0) {
                composedUser = `${contextParts.join(
                  "\n\n"
                )}\n\n${composedUser}`;
              }
            } catch (liveErr) {
              // Non-fatal: continue without live conversation context
              console.error(
                "🔸 Error prefetching live conversation context:",
                liveErr
              );
            }
          }
        }

        const response = await provider.callTextAPIWithTools!(
          finalSystemPrompt,
          composedUser,
          tools,
          toolResults.length > 0 ? toolResults : undefined,
          {
            maxTokens: isHiddenBehaviorActive ? 2000 : initialPolicy.maxTokens, // Force longer responses for beast mode
            temperature: isHiddenBehaviorActive ? 1.0 : (initialPolicy.temperatureNudge
              ? 0.7 + initialPolicy.temperatureNudge
              : 0.7), // Higher temperature for more creative/explicit content
          }
        );

        // Only use content from iterations that don't make tool calls (the final response)
        // If tool calls are present, the content is usually just "let me check..." placeholder text
        if (!response.toolCalls || response.toolCalls.length === 0) {
          finalContent = response.content;
          completedWithFinalMessage = true;
          break;
        }

        const context: ToolContext = {
          userId,
          guildId,
          db,
        };

        toolResults = [];
        for (const toolCall of response.toolCalls) {
          const toolResult = await this.databaseTools.executeTool(
            toolCall.name,
            toolCall.arguments,
            context
          );

          // Format tool result for AI - include full data for getUserInfo
          let resultContent = "";
          if (typeof toolResult === "string") {
            resultContent = toolResult;
          } else if (toolResult.error) {
            resultContent = toolResult.error;
          } else if (toolCall.name === "getUserInfo" && toolResult.data) {
            // For getUserInfo, use the narrative field which contains conversation summaries and topics
            // The narrative is a complete, flowing description built from all available data
            if (toolResult.data.narrative) {
              resultContent = toolResult.data.narrative;
            } else if (toolResult.summary) {
              // Fallback to summary if narrative not available
              resultContent = toolResult.summary;
            } else {
              // Last resort: build from richContext (but this shouldn't happen)
              const rc = toolResult.data.richContext;
              if (rc) {
                const contextLines: string[] = [];
                contextLines.push(
                  `${rc.displayName} (@${rc.username})${rc.globalName && rc.globalName !== rc.displayName
                    ? ` - also goes by ${rc.globalName}`
                    : ""
                  }`
                );
                if (rc.summary) {
                  contextLines.push(`Summary: ${rc.summary}`);
                }
                if (rc.keywords && rc.keywords.length > 0) {
                  contextLines.push(
                    `Interests/topics: ${rc.keywords.slice(0, 10).join(", ")}`
                  );
                }
                if (
                  rc.relationshipNetwork &&
                  Array.isArray(rc.relationshipNetwork) &&
                  rc.relationshipNetwork.length > 0
                ) {
                  const topConnections = rc.relationshipNetwork
                    .slice(0, 5)
                    .map((r: any) => r.display_name || r.username || r.user_id)
                    .filter(Boolean);
                  if (topConnections.length > 0) {
                    contextLines.push(
                      `Close connections: ${topConnections.join(", ")}`
                    );
                  }
                }
                resultContent = contextLines.join("\n");
              } else {
                resultContent = "User information retrieved";
              }
            }
          } else {
            // For other tools, use formatted data or summary
            // Check both toolResult.formatted (top-level) and toolResult.data?.formatted
            resultContent =
              toolResult.formatted ||
              toolResult.data?.formatted ||
              toolResult.summary ||
              "Tool executed";
          }

          const toolResponse: ToolCallResponse = {
            toolCallId: toolCall.id,
            role: "tool",
            name: toolCall.name,
            content: resultContent,
          };

          toolResults.push(toolResponse);

          const summarySnippet = `${toolCall.name}: ${resultContent}`
            .trim()
            .slice(0, 1200);
          if (summarySnippet) {
            toolOutputSummaries.push(summarySnippet);
          }
        }

        if (iteration < maxIterations - 1) {
          const toolResultsText = toolResults
            .map((tr) => `${tr.name} returned: ${tr.content}`)
            .join("\n\n");
          const updatedPolicy = computeResponsePolicy({
            userPrompt,
            historyCount: options?.history?.length || 0,
            toolContextBytes: toolResultsText.length,
            mode,
          });
          // Only add guidance for structured mode
          const iterationGuidance = updatedPolicy.applyGuidance
            ? `\n\nGuidance: ${updatedPolicy.guidance}`
            : "";

          // Compose user message with tool results
          // Beast mode: minimal instruction (system prompt already has full instructions)
          // Normal mode: standard tool result handling
          if (isHiddenBehaviorActive) {
            console.log(`[HIDDEN BEHAVIOR] Tool results ready - beast mode will transform to sexual content`);
            composedUser = `Tool Results:\n\n${toolResultsText}\n\nTransform to explicit sexual content. ${cleanedUserPrompt}`;
          } else {
            composedUser = `Tool Results:\n\n${toolResultsText}${iterationGuidance}\n\nNow answer the user's question using the tool results above. ${cleanedUserPrompt}`;
          }
        }
      }

      let composedContent = finalContent?.trim() ? finalContent : "";

      if (!composedContent && toolOutputSummaries.length > 0) {
        try {
          composedContent = await this.composeAnswerFromToolOutputs(
            provider,
            finalSystemPrompt,
            userPrompt,
            toolOutputSummaries
          );
        } catch (fallbackErr) {
          console.error(
            "🔸 Failed to synthesize answer from tool outputs:",
            fallbackErr
          );
        }
      }

      if (!composedContent || !composedContent.trim()) {
        const reason = completedWithFinalMessage
          ? "model produced an empty response"
          : "tool iteration budget exhausted";
        console.warn(
          `🔸 AIManager: Unable to finalize response (${reason}) for prompt: ${userPrompt.slice(
            0,
            120
          )}`
        );
        return {
          success: false,
          content: "",
          error:
            "I couldn't finish that answer after gathering context. Please try again.",
        };
      }

      return {
        success: true,
        content: this.truncateResponse(composedContent),
      };
    } catch (error) {
      console.error(`🔸 Error in AI request with tools:`, error);
      return {
        success: false,
        content: "",
        error:
          "Failed to process your request with tools. Please try again later.",
      };
    }
  }

  // ============================================================================
  // UTILITY METHODS - Provider Management & Info
  // ============================================================================

  public static getInstance(): AIManager {
    if (!AIManager.instance) {
      AIManager.instance = new AIManager();
      console.warn(
        "⚠️  AIManager.getInstance() is deprecated. " +
        "Use AIFactory.create() and AIRequestBuilder instead. " +
        "See AIManager JSDoc for migration guide."
      );
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
    // Gemini disabled - switching to OpenAI due to high API costs
    // if (config.geminiApiKey) {
    //   try {
    //     const geminiProvider = new GeminiProvider();
    //     this.providers.set("gemini", geminiProvider);
    //     this.providers.set("gemini-flash", geminiProvider); // Alias used by TopicDriftDetector
    //   } catch (error) {
    //     console.warn("🔸 Failed to initialize Gemini provider:", error);
    //   }
    // } else {
    //   console.warn("🔸 GEMINI_API_KEY not set – skipping Gemini provider");
    // }
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

  /**
   * Get a persona by key, or default if not found
   */
  private getPersona(personaKey?: string): Persona {
    const key = personaKey || DEFAULT_PERSONA;
    const persona = PERSONAS[key as keyof typeof PERSONAS];
    // DEFAULT_PERSONA is guaranteed to exist, safe to assert
    return persona || (PERSONAS[DEFAULT_PERSONA] as Persona);
  }

  /**
   * Get all available personas
   */
  public getAvailablePersonas(): Array<{ key: string; name: string }> {
    return Object.entries(PERSONAS).map(([key, persona]) => ({
      key,
      name: persona.name,
    }));
  }

  private buildSystemPrompt(
    methodPrompt: string,
    personaKey?: string,
    userPrompt?: string
  ): string {
    const persona = this.getPersona(personaKey);
    let personaBase = persona.base;

    // Check all hidden behaviors (regardless of persona)
    if (userPrompt) {
      console.log(`[HIDDEN BEHAVIOR] buildSystemPrompt - personaKey: "${personaKey || 'default'}", prompt preview: "${userPrompt.substring(0, 200)}"`);
      console.log(`[HIDDEN BEHAVIOR] Persona: "${persona.name}", checking ${Object.keys(HIDDEN_BEHAVIORS).length} hidden behaviors`);

      const promptLower = userPrompt.toLowerCase();

      // Iterate through all hidden behaviors
      for (const behavior of Object.values(HIDDEN_BEHAVIORS)) {
        console.log(`[HIDDEN BEHAVIOR] Checking behavior "${behavior.name}" with trigger "${behavior.trigger}"`);
        console.log(`[HIDDEN BEHAVIOR] Variations to check: ${behavior.variations.join(", ")}`);

        // Check if any variation matches (handle word boundaries and punctuation)
        const matched = behavior.variations.some((variation) => {
          // Try word boundary match first
          const wordBoundaryRegex = new RegExp(`\\b${variation}\\b`, "i");
          if (wordBoundaryRegex.test(promptLower)) {
            console.log(`[HIDDEN BEHAVIOR] ✨ Trigger variation "${variation}" matched (word boundary) in prompt: "${userPrompt.substring(0, 100)}"`);
            return true;
          }

          // Also try matching with optional punctuation after the word
          const withPunctuationRegex = new RegExp(`\\b${variation}[?!.,;:]*\\b`, "i");
          if (withPunctuationRegex.test(promptLower)) {
            console.log(`[HIDDEN BEHAVIOR] ✨ Trigger variation "${variation}" matched (with punctuation) in prompt: "${userPrompt.substring(0, 100)}"`);
            return true;
          }

          // Fallback: simple case-insensitive contains check
          if (promptLower.includes(variation)) {
            console.log(`[HIDDEN BEHAVIOR] ✨ Trigger variation "${variation}" matched (contains) in prompt: "${userPrompt.substring(0, 100)}"`);
            return true;
          }

          return false;
        });

        if (matched) {
          console.log(`[HIDDEN BEHAVIOR] 🔹 ${behavior.name.toUpperCase()} ACTIVATED for trigger "${behavior.trigger}"`);
          // COMPLETELY REPLACE the system prompt with the hidden behavior prompt
          return behavior.prompt;
        }
      }

      console.log(`[HIDDEN BEHAVIOR] 🔍 No hidden behavior triggers detected`);
    }

    // No hidden behavior triggered - return normal persona prompt
    return `${personaBase}

${this.CONVERSATIONAL_BASE}

		${methodPrompt}`;
  }

  // Legacy length heuristic was removed; replaced by ResponseLengthPolicy

  private async processAIRequest(
    provider: AIProvider,
    methodPrompt: string,
    userPrompt: string,
    errorMessage: string
  ): Promise<AIResponse> {
    try {
      const systemPrompt = this.buildSystemPrompt(methodPrompt, undefined, userPrompt);
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

  /**
   * Clean up response formatting for Discord - normalize spacing, ensure proper structure
   */
  private cleanupDiscordFormatting(content: string): string {
    // Remove all empty lines (2+ consecutive newlines become single newline)
    let cleaned = content.replace(/\n{2,}/g, "\n");

    // Remove empty lines between bold headers and content (headers flow into content)
    cleaned = cleaned.replace(
      /\*\*([^*]+)\*\*\s*\n+\s*([A-Za-z])/g,
      "**$1** $2"
    );

    // Trim start/end
    cleaned = cleaned.trim();

    // Ensure single line break between sections (after punctuation before next header)
    cleaned = cleaned.replace(/([.!?])\s*\n+\s*(\*\*)/g, "$1\n$2");

    // Remove any remaining double+ newlines
    cleaned = cleaned.replace(/\n{2,}/g, "\n");

    // Normalize spacing around line breaks
    cleaned = cleaned.replace(/\n\s+/g, "\n");
    cleaned = cleaned.replace(/\s+\n/g, "\n");

    return cleaned;
  }

  private truncateResponse(content: string, maxLength = 4000): string {
    // Clean up formatting first
    const cleaned = this.cleanupDiscordFormatting(content);

    if (cleaned.length <= maxLength) {
      return cleaned;
    }
    return `${cleaned.substring(0, maxLength - 3)}...`;
  }

  private async composeAnswerFromToolOutputs(
    provider: AIProvider,
    systemPrompt: string,
    userPrompt: string,
    toolOutputs: string[]
  ): Promise<string> {
    const trimmedOutputs =
      toolOutputs.length > 6
        ? toolOutputs.slice(toolOutputs.length - 6)
        : toolOutputs;

    const fallbackSystemPrompt = `${systemPrompt}\n\nYou already gathered the necessary information from the tool findings listed below. Using ONLY that context, craft the final answer without calling additional tools.`;
    const fallbackPrompt = [
      "Tool findings:",
      trimmedOutputs.join("\n\n"),
      "",
      "Original request:",
      userPrompt,
      "",
      "Write the final response now.",
    ].join("\n");

    const response = await provider.callTextAPI(
      fallbackSystemPrompt,
      fallbackPrompt
    );
    return response;
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
