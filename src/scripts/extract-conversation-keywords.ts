/**
 * Extract keywords for existing conversation segments (retroactive)
 *
 * This script processes all existing conversation segments and extracts keywords
 * using TF-IDF and semantic analysis. Useful for adding keywords to conversations
 * that were created before the keyword extraction feature was implemented.
 *
 * Usage:
 *   npm run keywords:extract-all                         # Extract for all conversations
 *   GUILD_ID=123456789 npm run keywords:extract-all      # Extract for specific guild
 *   LIMIT=100 npm run keywords:extract-all               # Process only first 100 conversations
 */

import { config } from "../config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { KeywordExtractor } from "../features/keywords/KeywordExtractor";
import type { KeywordMessage } from "../features/keywords/types";

async function main() {
	console.log("🔧 Extracting keywords for existing conversations...\n");

	// Initialize database
	const db = new PostgreSQLManager({
		connectionString: config.postgresUrl || "postgresql://localhost:5432/arcados",
	});

	try {
		await db.connect();
		console.log("✅ Connected to PostgreSQL\n");

		// Initialize keyword extractor
		const keywordExtractor = new KeywordExtractor(db);

		// Get parameters from environment
		const targetGuildId = process.env.GUILD_ID;
		const limit = process.env.LIMIT ? Number.parseInt(process.env.LIMIT, 10) : undefined;

		// Build query to fetch conversation segments
		let query = `
      SELECT cs.id, cs.guild_id, cs.message_ids, cs.features
      FROM conversation_segments cs
      WHERE cs.status = 'finalized'
        AND cs.message_count >= 2
    `;

		const params: (string | number)[] = [];
		let paramIndex = 1;

		if (targetGuildId) {
			query += ` AND cs.guild_id = $${paramIndex}`;
			params.push(targetGuildId);
			paramIndex++;
		}

		query += " ORDER BY cs.created_at DESC";

		if (limit) {
			query += ` LIMIT $${paramIndex}`;
			params.push(limit);
		}

		console.log(`📊 Fetching conversation segments${targetGuildId ? ` for guild ${targetGuildId}` : ""}${limit ? ` (limit ${limit})` : ""}...\n`);

		const segmentsResult = await db.query<{
			id: string;
			guild_id: string;
			message_ids: string[];
			features: any;
		}>(query, params);

		if (!segmentsResult.success || !segmentsResult.data) {
			console.error("❌ Failed to fetch conversation segments");
			process.exit(1);
		}

		const segments = segmentsResult.data;
		console.log(`Found ${segments.length} conversation segments to process\n`);

		if (segments.length === 0) {
			console.log("No segments to process");
			return;
		}

		let processed = 0;
		let updated = 0;
		let skipped = 0;
		let errors = 0;

		for (const segment of segments) {
			processed++;

			// Check if keywords already exist
			if (
				segment.features?.keywords?.terms &&
				Array.isArray(segment.features.keywords.terms) &&
				segment.features.keywords.terms.length > 0
			) {
				skipped++;
				if (processed % 10 === 0) {
					console.log(`   Progress: ${processed}/${segments.length} (${skipped} skipped, ${updated} updated, ${errors} errors)`);
				}
				continue;
			}

			try {
				// Fetch messages for this segment
				const messagesResult = await db.query<{
					id: string;
					content: string;
					author_id: string;
					embedding: any;
				}>(`
          SELECT id, content, author_id, embedding
          FROM messages
          WHERE id = ANY($1)
            AND content IS NOT NULL
            AND content != ''
          ORDER BY created_at ASC
        `, [segment.message_ids]);

				if (!messagesResult.success || !messagesResult.data || messagesResult.data.length === 0) {
					console.warn(`   ⚠️  No messages found for segment ${segment.id}`);
					errors++;
					continue;
				}

				// Convert to KeywordMessage format
				const keywordMessages: KeywordMessage[] = messagesResult.data.map((m) => ({
					id: m.id,
					content: m.content,
					author_id: m.author_id,
					embedding: m.embedding,
				}));

				// Extract keywords
				const keywords = await keywordExtractor.extractKeywords(
					keywordMessages,
					segment.guild_id,
					{ topN: 10, method: "hybrid" },
				);

				// Update segment features with keywords
				const updatedFeatures = {
					...(segment.features || {}),
					keywords,
				};

				await db.query(
					`UPDATE conversation_segments SET features = $1 WHERE id = $2`,
					[JSON.stringify(updatedFeatures), segment.id],
				);

				updated++;

				if (processed % 10 === 0) {
					console.log(`   Progress: ${processed}/${segments.length} (${skipped} skipped, ${updated} updated, ${errors} errors)`);
				}
			} catch (error) {
				console.error(`   ❌ Error processing segment ${segment.id}:`, error);
				errors++;
			}
		}

		console.log("\n✅ Keyword extraction complete!");
		console.log(`   Total processed: ${processed}`);
		console.log(`   Updated: ${updated}`);
		console.log(`   Skipped (already had keywords): ${skipped}`);
		console.log(`   Errors: ${errors}`);
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

main();
