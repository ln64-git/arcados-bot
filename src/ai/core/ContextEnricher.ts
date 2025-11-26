import type { AIContext } from "./AIContext";
import type {
	ConversationSummaryStore,
	SemanticMemoryStore,
} from "./ContextMemory";
import {
	defaultConversationSummaryStore,
	defaultSemanticMemoryStore,
} from "./ContextMemory";

export interface ContextEnricherDeps {
	summaryStore?: ConversationSummaryStore;
	semanticStore?: SemanticMemoryStore;
}

export interface ContextEnricherOptions {
	query?: string;
}

/**
 * Lightweight, opt-in context enrichment step.
 *
 * For now this is intentionally conservative and mostly a no-op unless
 * concrete stores are provided. It gives us a single place to evolve
 * tiered memory without touching every caller.
 */
export async function enrichAIContext(
	context: AIContext,
	deps: ContextEnricherDeps = {},
	options: ContextEnricherOptions = {}
): Promise<AIContext> {
	const summaryStore: ConversationSummaryStore | undefined =
		deps.summaryStore ?? defaultConversationSummaryStore;
	const semanticStore: SemanticMemoryStore | undefined =
		deps.semanticStore ?? defaultSemanticMemoryStore;

	const enrichment = context.contextEnrichment;

	// Clone shallowly so we do not mutate callers unexpectedly
	const enriched: AIContext = {
		...context,
	};

	// Mid-term summaries
	if (summaryStore && enrichment?.includeSummaries !== false) {
		try {
			const summaries = await summaryStore.getRecentSummaries(context, {
				limit: 5,
			});
			const merged: typeof summaries = summaries ? [...summaries] : [];

			// Optionally prepend a server-level summary if available
			if (context.db && context.guildId) {
				try {
					const guildResult = await context.db.query(
						`
            SELECT name, server_summary
            FROM guilds
            WHERE id = $1
          `,
						[context.guildId]
					);

					const guildRow =
						guildResult.success && guildResult.data && guildResult.data[0]
							? guildResult.data[0]
							: null;

					if (guildRow && guildRow.server_summary) {
						const label =
							typeof guildRow.name === "string" && guildRow.name.length > 0
								? guildRow.name
								: context.guildId;
						const text = `Server ${label}: ${guildRow.server_summary}`;
						merged.unshift({
							id: `guild:${context.guildId}`,
							type: "channel",
							text,
							createdAt: Date.now(),
						});
					}
				} catch (error) {
					console.error("[ContextEnricher] Failed to load server summary:", error);
				}
			}

			if (merged.length) {
				enriched.summaries = merged;
			}
		} catch (error) {
			console.error("[ContextEnricher] Failed to load summaries:", error);
		}
	}

	// Long-term semantic context
	if (
		semanticStore &&
		options.query &&
		options.query.trim().length > 0 &&
		enrichment?.includeSemanticContext !== false
	) {
		try {
			const hits = await semanticStore.search(context, options.query, {
				limit: 8,
			});
			if (hits.length) {
				enriched.semanticContext = hits;
			}
		} catch (error) {
			console.error("[ContextEnricher] Failed to load semantic context:", error);
		}
	}

	// Dialogue-state hints (intent/topicIds) will be set by higher-level
	// components (e.g., MessageHandler or social-intelligence tools) and
	// simply passed through here.

	return enriched;
}


