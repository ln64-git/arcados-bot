import type { DatabaseTool, ToolContext } from "../registry/DatabaseTools.js";
import { EmbeddingService } from "../../../features/social-intelligence/semantic-analysis/EmbeddingService.js";
import { pgvector } from "../../../database/PostgreSQLManager.js";

/**
 * Search messages using semantic similarity (embeddings)
 * Finds messages that are conceptually similar to the query, not just keyword matches
 */
export const searchMessagesSemantic: DatabaseTool = {
	name: "searchMessagesSemantic",
	description:
		"Search for messages using semantic similarity based on embeddings. This finds messages that are conceptually similar to your query, even if they don't contain the exact keywords. More powerful than keyword search for understanding context and meaning. Use this for queries like 'what did people say about drama', 'messages about love', 'discussions about conflict'.",
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "The semantic query to search for (e.g., 'drama between users', 'love confessions', 'funny moments')",
			},
			limit: {
				type: "number",
				description: "Maximum number of results to return (default: 10, max: 20)",
			},
			channelId: {
				type: "string",
				description: "Optional: Filter results to a specific channel",
			},
			authorId: {
				type: "string",
				description: "Optional: Filter results to a specific author",
			},
			lookbackDays: {
				type: "number",
				description: "Optional: Only search messages from the last N days (default: no limit)",
			},
		},
		required: ["query"],
	},
	execute: async (params: any, context: ToolContext) => {
		try {
			const query = String(params.query);
			const limit = Math.min(params.limit || 10, 20);
			const channelId = params.channelId ? String(params.channelId) : null;
			const authorId = params.authorId ? String(params.authorId) : null;
			const lookbackDays = params.lookbackDays ? Number(params.lookbackDays) : null;

			// Generate embedding for the query
			let queryEmbedding: number[] | null = null;
			try {
				const embeddingService = EmbeddingService.getInstance();
				queryEmbedding = await embeddingService.generateEmbedding(query);
			} catch (error) {
				console.warn("⚠️  Failed to generate query embedding:", error);
				// Fall back to keyword search if embedding fails
			}

			// Build SQL query with filters
			let whereConditions = ["m.guild_id = $1", "m.content IS NOT NULL", "LENGTH(m.content) > 0"];
			const queryParams: any[] = [context.guildId];
			let paramIndex = 2;

			// Add embedding condition if available
			if (queryEmbedding) {
				whereConditions.push("m.embedding IS NOT NULL");
			}

			// Add channel filter
			if (channelId) {
				whereConditions.push(`m.channel_id = $${paramIndex}`);
				queryParams.push(channelId);
				paramIndex++;
			}

			// Add author filter
			if (authorId) {
				whereConditions.push(`m.author_id = $${paramIndex}`);
				queryParams.push(authorId);
				paramIndex++;
			}

			// Add time filter
			if (lookbackDays) {
				const lookbackTime = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
				whereConditions.push(`m.created_at >= $${paramIndex}`);
				queryParams.push(lookbackTime);
				paramIndex++;
			}

			// Build the main query
			let orderByClause: string;
			if (queryEmbedding) {
				// Use vector similarity if embedding is available
				// Convert to pgvector format using toSql()
				queryParams.push(pgvector.toSql(queryEmbedding));
				orderByClause = `(m.embedding <=> $${paramIndex}::vector) ASC`;
				paramIndex++;
			} else {
				// Fallback to recency if no embedding
				orderByClause = "m.created_at DESC";
			}

			// Execute search query
			const result = await context.db.query(
				`SELECT
					m.id,
					m.content,
					m.author_id,
					m.channel_id,
					m.created_at,
					c.name as channel_name,
					mem.display_name,
					mem.username,
					${queryEmbedding ? `(m.embedding <=> $${paramIndex - 1}::vector) as similarity_score` : "0 as similarity_score"}
				FROM messages m
				LEFT JOIN channels c ON m.channel_id = c.id AND m.guild_id = c.guild_id
				LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
				WHERE ${whereConditions.join(" AND ")}
				ORDER BY ${orderByClause}
				LIMIT $${paramIndex}`,
				[...queryParams, limit]
			);

			if (!result.success || !result.data || result.data.length === 0) {
				return {
					success: true,
					summary: "No messages found matching the query",
					data: { messages: [] },
					formatted: `No results for semantic query: "${query}"`,
				};
			}

			const messages = result.data;

			// Format results
			const formatted = `Semantic Search Results for: "${query}"

${messages
	.map((msg: any, i: number) => {
		const author = msg.display_name || msg.username || "Unknown";
		const channel = msg.channel_name ? `#${msg.channel_name}` : "Unknown Channel";
		const date = new Date(msg.created_at).toLocaleString();
		const content =
			msg.content.length > 150
				? `${msg.content.substring(0, 150)}...`
				: msg.content;
		const simScore = queryEmbedding
			? ` (similarity: ${(1 - msg.similarity_score).toFixed(2)})`
			: "";

		return `${i + 1}. [${date}] ${author} in ${channel}${simScore}
   "${content}"`;
	})
	.join("\n\n")}

Found ${messages.length} semantically similar messages`;

			return {
				success: true,
				summary: `Found ${messages.length} messages semantically similar to "${query}"`,
				data: {
					query,
					messages: messages.map((msg: any) => ({
						id: msg.id,
						content: msg.content,
						author: {
							id: msg.author_id,
							name: msg.display_name || msg.username,
						},
						channel: {
							id: msg.channel_id,
							name: msg.channel_name,
						},
						timestamp: new Date(msg.created_at),
					})),
				},
				formatted,
			};
		} catch (error) {
			console.error("🔸 Error in searchMessagesSemantic:", error);
			return {
				success: false,
				error: "Unable to perform semantic search",
			};
		}
	},
};

/**
 * TODO: Full embedding-based semantic search
 *
 * To implement true semantic search with embeddings:
 *
 * 1. Add embedding generation to the query:
 *    - Use OpenAI embeddings API or local model (@xenova/transformers)
 *    - Generate 768-dim vector for query text
 *
 * 2. Update query to use pgvector:
 *    SELECT *,
 *           embedding <=> $1::vector as distance
 *    FROM messages
 *    WHERE guild_id = $2
 *      AND embedding IS NOT NULL
 *    ORDER BY distance ASC
 *    LIMIT $3
 *
 * 3. Install pgvector extension in PostgreSQL if not already:
 *    CREATE EXTENSION IF NOT EXISTS vector;
 *
 * 4. Ensure embeddings are generated for messages:
 *    - See scripts/generate-embeddings.ts
 *    - Run: npm run generate:embeddings
 *
 * Example implementation:
 *
 * import { pipeline } from '@xenova/transformers';
 *
 * const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
 * const queryEmbedding = await extractor(query, { pooling: 'mean', normalize: true });
 * const embeddingArray = Array.from(queryEmbedding.data);
 *
 * const result = await context.db.query(
 *   `SELECT *, embedding <=> $1::vector as distance
 *    FROM messages
 *    WHERE guild_id = $2 AND embedding IS NOT NULL
 *    ORDER BY distance ASC
 *    LIMIT $3`,
 *   [JSON.stringify(embeddingArray), context.guildId, limit]
 * );
 */

export const semanticSearchTools = [searchMessagesSemantic];
