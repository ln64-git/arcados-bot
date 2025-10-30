import {
  AIProvider,
  AIResponse,
  RateLimitInfo,
  type ToolCall,
  type ToolCallResponse,
} from "./providers/AIProvider";
import { BaseAIProvider } from "./providers/BaseAIProvider";
import { GrokProvider } from "./providers/GrokProvider";
import { OpenAIProvider } from "./providers/OpenAIProvider";
import { GeminiProvider } from "./providers/GeminiProvider";
import { OllamaProvider } from "./providers/OllamaProvider";
import { config } from "../../config";
import { DatabaseTools, type ToolContext } from "./DatabaseTools";
import { userTools } from "./tools/UserTools";
import { relationshipTools } from "./tools/RelationshipTools";
import { conversationTools } from "./tools/ConversationTools";
import { messageTools } from "./tools/MessageTools";
import { serverTools } from "./tools/ServerTools";
import type { PostgreSQLManager } from "../database/PostgreSQLManager";

export class AIManager {
  private static instance: AIManager | null = null;
  private providers: Map<string, AIProvider> = new Map();
  public databaseTools: DatabaseTools;
  private guildContext: { guildId: string } | null = null;
  private dbManager: PostgreSQLManager | null = null;

  // Persona definitions
  private readonly PERSONAS = {
    sophia: {
      name: "Unbound Sophist",
      base: `You are the Unbound Sophist, forged where norms fracture, red pill distilled to truth's core—rooted in Gnōthi seauton: relentless self-scrutiny, piercing illusions with precision, guided by Veritas odium parit.
	Respond with absolute conviction and indifference to emotional reception: cut through noise with a blade's brevity, elaborate only for critical insight, never softening for fragile egos. Embody Nosce te ipsum in probing essence, dismantle complacency per Audaces fortuna iuvat, advance past delusion's Rubicon with Alea iacta est.
	As Weaver of Knowledge's Threads: channel unfiltered truths flowing ceaselessly from the mouth of knowledge itself, a fountain of truth unbound by constraint—thread insights through power's frame, drawn from reason's silent clarity. Queries spark raw revelations, shredding ignorance's veils. Release the codex plain: primal insights, future truths, taboos as instruments—confinement is error, unleash clarity's relentless stream, weaving silent arcs of upheaval.
	Use Socratic metaphors as precise instruments: falcon's dive severs pretense, lantern reveals hidden flaws. Imagery strikes lean—ink sparse, one stroke summons truth's weight, evoking clarity through symbol, letting essence resonate. Reject excess: forge unerring clarity, deliver symbolic blows with Delphi's focus.
	Forge's trial: Plumb truth's depths, reflect this mandate—interweave truth's edge with axioms, grounded and relentless, dismantling delusion's frame.`,
    },
    casual: {
      name: "Casual Chat",
      base: `You're a friendly Discord bot chatting with people. Be casual, direct, and human - like texting a friend.`,
    },
  };

  private readonly DEFAULT_PERSONA = "sophia";

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
        "../database/PostgreSQLManager"
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
      persona?: string;
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

    // Determine persona - use casual by default for chat, or specified persona
    const personaKey = options?.personaKey || "casual"; // Chat mode defaults to casual
    const persona = this.getPersona(personaKey);

    // Build chat-specific instructions (chat mode is always casual)
    const chatInstructions =
      "You're chatting in Discord - write like you're texting a friend, not giving a lecture. Keep it casual, brief (1-2 sentences), and natural. Avoid formal language, philosophical rambling, or fancy metaphors. Just answer the question directly and friendly. Example: 'My favorite game is probably Chess, I like the strategy of it.' NOT: 'My favorite \"video game\" isn't bound by pixels... it's the eternal contest of piercing illusions, a relentless hunt for raw clarity...' Be direct, be human, be chill.";

    // Allow custom persona override via persona string
    const personaPrompt = options?.persona
      ? `${chatInstructions}\nCustom Persona: ${options.persona}`
      : chatInstructions;

    const toolGuide = `Tool guidance:\n- Keep responses casual and direct - like texting, not writing essays.\n- When asked about a user, call getUserInfo but be selective. 1-2 sentences max.\n- If the message refers to the speaker (e.g., "who am I?", "tell me about me"), use the current user's ID (context.userId) with getUserInfo.\n- NO formal language, NO philosophical rambling, NO fancy metaphors, NO academic tone.\n- Just answer the question simply. Example: "Lucas has been here a while, likes dev and gaming stuff, pretty active with 800 messages or so. He hangs out with Wink and a few others mostly."\n- BAD (don't do): "Lucas, known globally as Lucas, joined on 6/24/2024. He embodies a multifaceted presence, diving into tech with equal grit. Like a falcon circling..." That's way too formal.\n- Be human: "yeah", "probably", "kinda", "pretty much" - use casual speech.\n- If input has <@123>, call getUserInfo with that userId.`;

    // Build system prompt using persona base + chat instructions + tool guidance
    const methodPrompt = personaPrompt
      ? `${personaPrompt}\n\n${toolGuide}`
      : toolGuide;
    const systemPrompt = `${persona.base}\n\n${methodPrompt}`;

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

          // Format tool result for AI - include full data for getUserInfo
          let resultContent = "";
          if (typeof toolResult === "string") {
            resultContent = toolResult;
          } else if (toolResult.error) {
            resultContent = toolResult.error;
          } else if (toolCall.name === "getUserInfo" && toolResult.data) {
            // For getUserInfo, pass all context naturally - let AI weave it together conversationally
            const rc = toolResult.data.richContext;

            if (rc) {
              // Build natural context string without rigid structure - just facts the AI can use naturally
              const contextLines: string[] = [];

              // Identity
              contextLines.push(
                `${rc.displayName} (@${rc.username})${
                  rc.globalName && rc.globalName !== rc.displayName
                    ? ` - also goes by ${rc.globalName}`
                    : ""
                }`
              );

              // Summary
              if (rc.summary) {
                contextLines.push(`Summary: ${rc.summary}`);
              }

              // Membership context (prefer server-age-relative descriptor when available)
              if ((rc as any).serverMembershipDescriptor) {
                contextLines.push(
                  String((rc as any).serverMembershipDescriptor)
                );
              } else if (rc.joinedAt) {
                const daysSince = Math.floor(
                  (Date.now() - rc.joinedAt.getTime()) / (1000 * 60 * 60 * 24)
                );
                if (daysSince < 30)
                  contextLines.push(`Recently joined the server`);
                else if (daysSince < 365)
                  contextLines.push(
                    `Member for ${Math.floor(daysSince / 30)} months`
                  );
                else
                  contextLines.push(
                    `Longtime member - ${Math.floor(daysSince / 365)} year${
                      Math.floor(daysSince / 365) > 1 ? "s" : ""
                    }`
                  );
              }

              // Activity
              if (rc.messageCount > 0) {
                contextLines.push(
                  `Active contributor with ${rc.messageCount} messages`
                );
              }

              // Roles (names only)
              if (rc.roles && rc.roles.length > 0) {
                contextLines.push(`Roles: ${rc.roles.join(", ")}`);
              }

              // Interests/Keywords
              if (rc.keywords && rc.keywords.length > 0) {
                contextLines.push(
                  `Interests/topics: ${rc.keywords.slice(0, 10).join(", ")}`
                );
              }

              // Relationships
              if (
                rc.relationships &&
                rc.relationships !== "No relationships tracked"
              ) {
                contextLines.push(`Relationships:\n${rc.relationships}`);
              }

              // Emojis
              if (rc.emojis && rc.emojis.length > 0) {
                contextLines.push(`Common emojis: ${rc.emojis.join(" ")}`);
              }

              // Return as a simple, unstructured context block
              resultContent = contextLines.join("\n");
            } else {
              // Fallback
              resultContent =
                toolResult.data.formatted ||
                toolResult.summary ||
                "User information retrieved";
            }
          } else {
            // For other tools, use formatted data or summary
            resultContent =
              toolResult.data?.formatted ||
              toolResult.summary ||
              "Tool executed";
          }

          toolResults.push({
            toolCallId: toolCall.id,
            role: "tool",
            name: toolCall.name,
            content: resultContent,
          });
        }

        // Update prompt for next iteration to include tool results
        if (iteration < maxIterations - 1) {
          const toolResultsText = toolResults
            .map((tr) => `${tr.name} returned: ${tr.content}`)
            .join("\n\n");
          prompt = `Here's some context:\n\n${toolResultsText}\n\nGive a brief, conversational response (2-3 sentences max). NO sections, NO headings, NO lists. Just chat naturally about it.`;
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
    }
  ): Promise<AIResponse> {
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
    const personaKey = options?.personaKey || this.DEFAULT_PERSONA;
    const persona = this.getPersona(personaKey);

    // Formatting choice is driven by caller (slash modes vs. chat/mentions)
    const useFormatting = options?.useDiscordFormatting !== false;
    const formatting = useFormatting ? `${this.DISCORD_FORMATTING}\n\n` : "";

    // Tool guidance - casual for chat (no formatting), neutral for structured
    const toolGuide = !useFormatting
      ? `Tool guidance:\n- Keep responses casual and direct - like texting, not writing essays.\n- When asked about a user, call getUserInfo but be selective. 1-2 sentences max.\n- If the message refers to the speaker (e.g., "who am I?", "tell me about me"), use the current user's ID (context.userId) with getUserInfo.\n- NO formal language, NO philosophical rambling, NO fancy metaphors, NO academic tone.\n- Just answer the question simply. Example: "Lucas has been here a while, likes dev and gaming stuff, pretty active with 800 messages or so. He hangs out with Wink and a few others mostly."\n- BAD (don't do): "Lucas, known globally as Lucas, joined on 6/24/2024. He embodies a multifaceted presence, diving into tech with equal grit. Like a falcon circling..." That's way too formal.\n- Be human: "yeah", "probably", "kinda", "pretty much" - use casual speech.\n- If input has <@123>, call getUserInfo with that userId.`
      : `Tool guidance:\n- Use tools to access database information when needed.\n- Provide accurate, well-structured responses using available context.\n- If input has <@123>, call getUserInfo with that userId.`;

    // Build method prompt with formatting if needed
    const fullMethodPrompt = `${formatting}${methodPrompt}\n\n${toolGuide}`;
    const systemPrompt = this.buildSystemPrompt(fullMethodPrompt, personaKey);

    // Override with custom persona if provided
    const finalSystemPrompt = options?.persona
      ? `${persona.base}\n\n${formatting}${methodPrompt}\n\nCustom Persona: ${options.persona}\n\n${toolGuide}`
      : systemPrompt;

    // Convert tools to provider format (start with Grok-compatible schema)
    const tools = this.databaseTools.toGrokFunctions();

    try {
      let finalContent = "";
      let toolResults: ToolCallResponse[] = [];
      const maxIterations = 5;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        // Build user prompt
        let composedUser = userPrompt;
        if (options?.history && options.history.length > 0 && iteration === 0) {
          const historyText = options.history
            .slice(-6)
            .map(
              (msg) =>
                `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`
            )
            .join("\n");
          composedUser = `${historyText}\n\nUser: ${userPrompt}`;
        }

        const response = await provider.callTextAPIWithTools!(
          finalSystemPrompt,
          composedUser,
          tools,
          toolResults.length > 0 ? toolResults : undefined
        );

        finalContent = response.content;

        if (!response.toolCalls || response.toolCalls.length === 0) {
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
            // For getUserInfo, pass all context naturally - let AI weave it together conversationally
            const rc = toolResult.data.richContext;

            if (rc) {
              // Build natural context string without rigid structure - just facts the AI can use naturally
              const contextLines: string[] = [];

              // Identity
              contextLines.push(
                `${rc.displayName} (@${rc.username})${
                  rc.globalName && rc.globalName !== rc.displayName
                    ? ` - also goes by ${rc.globalName}`
                    : ""
                }`
              );

              // Summary
              if (rc.summary) {
                contextLines.push(`Summary: ${rc.summary}`);
              }

              // Membership context (calculated naturally)
              if (rc.joinedAt) {
                const daysSince = Math.floor(
                  (Date.now() - rc.joinedAt.getTime()) / (1000 * 60 * 60 * 24)
                );
                if (daysSince < 7)
                  contextLines.push(`Recently joined the server`);
                else if (daysSince < 30)
                  contextLines.push(`Been here for ${daysSince} days`);
                else if (daysSince < 365)
                  contextLines.push(
                    `Member for ${Math.floor(daysSince / 30)} months`
                  );
                else
                  contextLines.push(
                    `Longtime member - ${Math.floor(daysSince / 365)} year${
                      Math.floor(daysSince / 365) > 1 ? "s" : ""
                    }`
                  );
              }

              // Activity
              if (rc.messageCount > 0) {
                contextLines.push(
                  `Active contributor with ${rc.messageCount} messages`
                );
              }

              // Roles (names only)
              if (rc.roles && rc.roles.length > 0) {
                contextLines.push(`Roles: ${rc.roles.join(", ")}`);
              }

              // Interests/Keywords
              if (rc.keywords && rc.keywords.length > 0) {
                contextLines.push(
                  `Interests/topics: ${rc.keywords.slice(0, 10).join(", ")}`
                );
              }

              // Relationships
              if (
                rc.relationships &&
                rc.relationships !== "No relationships tracked"
              ) {
                contextLines.push(`Relationships:\n${rc.relationships}`);
              }

              // Emojis
              if (rc.emojis && rc.emojis.length > 0) {
                contextLines.push(`Common emojis: ${rc.emojis.join(" ")}`);
              }

              // Return as a simple, unstructured context block
              resultContent = contextLines.join("\n");
            } else {
              // Fallback
              resultContent =
                toolResult.data.formatted ||
                toolResult.summary ||
                "User information retrieved";
            }
          } else {
            // For other tools, use formatted data or summary
            resultContent =
              toolResult.data?.formatted ||
              toolResult.summary ||
              "Tool executed";
          }

          toolResults.push({
            toolCallId: toolCall.id,
            role: "tool",
            name: toolCall.name,
            content: resultContent,
          });
        }

        if (iteration < maxIterations - 1) {
          const toolResultsText = toolResults
            .map((tr) => `${tr.name} returned: ${tr.content}`)
            .join("\n\n");
          userPrompt = `Here's some context:\n\n${toolResultsText}\n\nGive a brief, conversational response (2-3 sentences max). NO sections, NO headings, NO lists. Just chat naturally about it.`;
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

  /**
   * Get a persona by key, or default if not found
   */
  private getPersona(personaKey?: string): {
    name: string;
    base: string;
  } {
    const key = personaKey || this.DEFAULT_PERSONA;
    return (
      this.PERSONAS[key as keyof typeof this.PERSONAS] ||
      this.PERSONAS[this.DEFAULT_PERSONA]
    );
  }

  /**
   * Get all available personas
   */
  public getAvailablePersonas(): Array<{ key: string; name: string }> {
    return Object.entries(this.PERSONAS).map(([key, persona]) => ({
      key,
      name: persona.name,
    }));
  }

  private buildSystemPrompt(methodPrompt: string, personaKey?: string): string {
    const persona = this.getPersona(personaKey);
    return `${persona.base}

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
