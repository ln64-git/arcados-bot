import type {
	AIContext,
	ConversationSummary,
	SemanticContextItem,
} from "./AIContext";
import { EmbeddingService } from "../../features/social-intelligence/semantic-analysis/EmbeddingService.js";
import { pgvector } from "../../database/PostgreSQLManager.js";

/**
 * Store interface for loading conversation summaries (mid-term memory).
 * Implementations are responsible for talking to the database/pgvector layer.
 */
export interface ConversationSummaryStore {
	getRecentSummaries(
		context: AIContext,
		options?: {
			limit?: number;
		}
	): Promise<ConversationSummary[]>;
}

/**
 * Store interface for semantic search over long-term memory.
 */
export interface SemanticMemoryStore {
	search(
		context: AIContext,
		query: string,
		options?: {
			limit?: number;
		}
	): Promise<SemanticContextItem[]>;
}

/**
 * Default PostgreSQL-backed implementation for conversation summaries.
 * Uses the conversation_segments table as the source of mid-term summaries.
 */
class PostgresConversationSummaryStore implements ConversationSummaryStore {
	async getRecentSummaries(
		context: AIContext,
		options?: { limit?: number }
	): Promise<ConversationSummary[]> {
		const db = context.db;
		if (!db || !db.isConnected()) {
			return [];
		}

		const limit = Math.min(options?.limit ?? 5, 20);

		const where: string[] = ["guild_id = $1", "summary IS NOT NULL", "summary <> ''"];
		const params: any[] = [context.guildId];
		let paramIndex = 2;

		// Prefer channel-scoped summaries when channel is known
		if (context.channelId) {
			where.push(`channel_id = $${paramIndex}`);
			params.push(context.channelId);
			paramIndex++;
		}

		// Only finalized segments to avoid noisy partials
		where.push("status = 'finalized'");

		const result = await db.query(
			`SELECT
				id,
				channel_id,
				summary,
				start_time,
				end_time,
				last_activity_at
			FROM conversation_segments
			WHERE ${where.join(" AND ")}
			ORDER BY last_activity_at DESC, end_time DESC
			LIMIT $${paramIndex}`,
			[...params, limit]
		);

		if (!result.success || !result.data || result.data.length === 0) {
			return [];
		}

		return result.data.map((row: any): ConversationSummary => {
			const ts =
				(row.last_activity_at && new Date(row.last_activity_at).getTime()) ||
				(row.end_time && new Date(row.end_time).getTime()) ||
				(row.start_time && new Date(row.start_time).getTime()) ||
				Date.now();

			return {
				id: row.id,
				type: "channel",
				text: row.summary as string,
				createdAt: ts,
			};
		});
	}
}

/**
 * Default PostgreSQL-backed implementation for semantic memory over conversations.
 * Uses pgvector over conversation_segments.embedding and reuses the EmbeddingService.
 */
class PostgresSemanticMemoryStore implements SemanticMemoryStore {
	async search(
		context: AIContext,
		query: string,
		options?: { limit?: number }
	): Promise<SemanticContextItem[]> {
		const db = context.db;
		if (!db || !db.isConnected()) {
			return [];
		}

		const trimmed = query.trim();
		if (!trimmed) {
			return [];
		}

		const limit = Math.min(options?.limit ?? 8, 20);

		let queryEmbedding: number[] | null = null;
		try {
			const embeddingService = EmbeddingService.getInstance();
			queryEmbedding = await embeddingService.generateEmbedding(trimmed);
		} catch (error) {
			console.warn("[SemanticMemory] Failed to generate query embedding:", error);
			return [];
		}

		if (!queryEmbedding) {
			return [];
		}

		// Base filters
		const where: string[] = [
			"cs.guild_id = $1",
			"cs.status = 'finalized'",
			"cs.embedding IS NOT NULL",
		];
		const params: any[] = [context.guildId];
		let paramIndex = 2;

		// Optional channel scoping for tighter relevance
		if (context.channelId) {
			where.push(`cs.channel_id = $${paramIndex}`);
			params.push(context.channelId);
			paramIndex++;
		}

		// Look back 60 days by default to keep results fresh
		const lookbackTime = new Date(
			Date.now() - 60 * 24 * 60 * 60 * 1000
		);
		where.push(`cs.start_time >= $${paramIndex}`);
		params.push(lookbackTime);
		paramIndex++;

		// Vector similarity
		params.push(pgvector.toSql(queryEmbedding));
		const embeddingParamIndex = paramIndex;
		paramIndex++;

		const result = await db.query(
			`SELECT
				cs.id,
				cs.channel_id,
				cs.summary,
				cs.start_time,
				cs.end_time,
				cs.message_count,
				c.name as channel_name,
				(cs.embedding <=> $${embeddingParamIndex}::vector) AS distance
			FROM conversation_segments cs
			LEFT JOIN channels c ON cs.channel_id = c.id
			WHERE ${where.join(" AND ")}
			ORDER BY distance ASC
			LIMIT $${paramIndex}`,
			[...params, limit]
		);

		if (!result.success || !result.data || result.data.length === 0) {
			return [];
		}

		return result.data.map((row: any): SemanticContextItem => {
			const distance = typeof row.distance === "number" ? row.distance : 0;
			const score = 1 - distance;
			const channelName = row.channel_name || row.channel_id || "unknown-channel";
			const baseSummary: string =
				(row.summary as string) ||
				`Conversation in #${channelName} with ${row.message_count || 0} messages.`;

			return {
				id: row.id,
				source: `conversation:${channelName}`,
				text: baseSummary,
				score,
			};
		});
	}
}

export const defaultConversationSummaryStore: ConversationSummaryStore =
	new PostgresConversationSummaryStore();

export const defaultSemanticMemoryStore: SemanticMemoryStore =
	new PostgresSemanticMemoryStore();



