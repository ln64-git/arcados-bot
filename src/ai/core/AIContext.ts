import type { PostgreSQLManager } from "../../database/PostgreSQLManager";

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

	// Conversation state
	history?: Array<{ role: string; content: string }>;
	sessionId?: string;

	// Domain hints - helps optimize tool selection and formatting
	domain?: "voice" | "chat" | "slash";
	isStreaming?: boolean;

	// Future context engineering hooks
	// These will allow fine-tuning context inclusion based on token budgets,
	// relevance scoring, and other advanced strategies
	contextEnrichment?: {
		includeLiveConversations?: boolean;
		includeUserProfile?: boolean;
		includeRelationships?: boolean;
		maxContextTokens?: number;
		// Future: relevanceThreshold, contextSources, etc.
	};
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
