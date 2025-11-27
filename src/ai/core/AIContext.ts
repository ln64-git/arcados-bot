import type { PostgreSQLManager } from "../../database/PostgreSQLManager";

/**
 * High-level intent classification for a user turn.
 * Used to bias context and tool selection.
 */
export type AIIntent =
	| "open_question"
	| "follow_up"
	| "correction"
	| "command"
	| "chit_chat";

/**
 * Mid-term memory: compact conversation summaries.
 */
export interface ConversationSummary {
	id: string;
	type: "channel" | "user";
	text: string;
	createdAt: number;
}

/**
 * Long-term semantic memory item (e.g., from pgvector search).
 */
export interface SemanticContextItem {
	id: string;
	source: string;
	text: string;
	score: number;
}

/**
 * AIContext - Centralized context management for all AI operations
 *
 * This interface provides a clean, type-safe way to pass context through
 * the AI stack. It's designed to be future-proof, allowing gradual addition
 * of context engineering features like token budgets and relevance scoring.
 */
export interface AIContext {
	// Required context - every AI call needs these
	userId: string;
	guildId: string;

	// Optional enrichment - additional context for better responses
	channelId?: string;
	messageId?: string;

	// Database access (lazy loaded)
	db?: PostgreSQLManager;

	// Conversation state (short-term window)
	history?: Array<{ role: string; content: string }>;
	sessionId?: string;

	// Tiered memory layers
	summaries?: ConversationSummary[];
	semanticContext?: SemanticContextItem[];

	// Dialogue state hints
	intent?: AIIntent;
	topicIds?: string[];

	// Domain hints - helps optimize tool selection and formatting
	domain?: "voice" | "chat" | "slash";
	isStreaming?: boolean;

	// Context engineering hooks and budgets
	// These allow fine-tuning context inclusion based on token budgets,
	// relevance scoring, and other advanced strategies.
	contextEnrichment?: {
		includeLiveConversations?: boolean;
		includeUserProfile?: boolean;
		includeRelationships?: boolean;
		includeSummaries?: boolean;
		includeSemanticContext?: boolean;
		maxContextTokens?: number;
		// Future: relevanceThreshold, contextSources, etc.
	};

	// Communication mode for yin/yang system
	communicationMode?: "yin" | "yang";
}

/**
 * AIContextBuilder - Fluent API for building AIContext objects
 *
 * Usage:
 *   const ctx = new AIContextBuilder()
 *     .user(userId)
 *     .guild(guildId)
 *     .channel(channelId)
 *     .domain('voice')
 *     .build();
 */
export class AIContextBuilder {
	private context: Partial<AIContext> = {};

	/**
	 * Set the user ID (required)
	 */
	user(userId: string): this {
		this.context.userId = userId;
		return this;
	}

	/**
	 * Set the guild ID (required)
	 */
	guild(guildId: string): this {
		this.context.guildId = guildId;
		return this;
	}

	/**
	 * Set the channel ID (optional)
	 */
	channel(channelId: string): this {
		this.context.channelId = channelId;
		return this;
	}

	/**
	 * Set the message ID (optional)
	 */
	message(messageId: string): this {
		this.context.messageId = messageId;
		return this;
	}

	/**
	 * Set conversation history (optional)
	 */
	withHistory(history: Array<{ role: string; content: string }>): this {
		this.context.history = history;
		return this;
	}

	/**
	 * Set database instance (optional, usually auto-provided)
	 */
	withDatabase(db: PostgreSQLManager): this {
		this.context.db = db;
		return this;
	}

	/**
	 * Set session ID (optional)
	 */
	session(sessionId: string): this {
		this.context.sessionId = sessionId;
		return this;
	}

	/**
	 * Set domain hint (optional)
	 */
	domain(domain: "voice" | "chat" | "slash"): this {
		this.context.domain = domain;
		return this;
	}

	/**
	 * Mark as streaming (optional)
	 */
	streaming(isStreaming = true): this {
		this.context.isStreaming = isStreaming;
		return this;
	}

	/**
	 * Configure context enrichment (optional)
	 */
	enrichment(config: AIContext["contextEnrichment"]): this {
		this.context.contextEnrichment = config;
		return this;
	}

	/**
	 * Set communication mode (yin/yang)
	 */
	communicationMode(mode: "yin" | "yang"): this {
		this.context.communicationMode = mode;
		return this;
	}

	/**
	 * Build and validate the AIContext
	 * @throws Error if required fields are missing
	 */
	build(): AIContext {
		// Validate required fields
		if (!this.context.userId) {
			throw new Error("AIContext requires userId");
		}
		if (!this.context.guildId) {
			throw new Error("AIContext requires guildId");
		}

		return this.context as AIContext;
	}
}
