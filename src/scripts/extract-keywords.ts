#!/usr/bin/env bun
/**
 * Extract Keywords Script
 *
 * Extracts keywords for all finalized conversation segments in a guild.
 * Uses hybrid TF-IDF + semantic extraction to identify contextually relevant terms.
 */

import { PostgreSQLManager } from "../database/PostgreSQLManager";
import { KeywordExtractor } from "../features/social-intelligence/semantic-analysis/KeywordExtractor";
import type { KeywordMessage } from "../features/social-intelligence/semantic-analysis/types";
import { config } from "../config/index.js";

const db = new PostgreSQLManager();

async function main() {
	console.log("🔑 Extracting Keywords for Conversations");
	console.log("=".repeat(80));

	const args = process.argv.slice(2);
	const regenerate = args.includes("--regenerate") || args.includes("-r");
	const batchSize = args.find((arg) => arg.startsWith("--batch="))
		? Number.parseInt(args.find((arg) => arg.startsWith("--batch="))!.split("=")[1] || "100", 10)
		: 100;

	// Get guild ID from env or config
	const guildId = process.env.GUILD_ID || config.guildId;

	if (!guildId) {
		console.error("❌ No guild ID provided");
		console.error("💡 Set GUILD_ID environment variable or in .env file");
		process.exit(1);
	}

	console.log(`Guild ID: ${guildId}`);
	console.log(`Mode: ${regenerate ? "REGENERATE (will replace existing keywords)" : "UPDATE (will skip segments with keywords)"}`);
	console.log(`Batch size: ${batchSize}`);
	console.log("=".repeat(80));

	const connected = await db.connect();
	if (!connected) {
		console.error("❌ Failed to connect to database");
		console.error("💡 Make sure POSTGRES_URL is set in your .env file");
		process.exit(1);
	}

	const keywordExtractor = new KeywordExtractor(db);

	try {
		console.log("\n🚀 Starting keyword extraction...\n");

		// Query segments that need keywords
		const condition = regenerate
			? "TRUE" // Regenerate all
			: `(features IS NULL OR features::text = '{}' OR NOT (features ? 'keywords'))`;

		const segmentsResult = await db.query(
			`
			SELECT id, message_ids
			FROM conversation_segments
			WHERE guild_id = $1
				AND status = 'finalized'
				AND message_count >= 2
				AND ${condition}
			ORDER BY created_at DESC
		`,
			[guildId]
		);

		if (!segmentsResult.success || !segmentsResult.data) {
			console.error("❌ Failed to query conversation segments");
			process.exit(1);
		}

		const segments = segmentsResult.data as Array<{ id: string; message_ids: string[] }>;
		const totalSegments = segments.length;

		if (totalSegments === 0) {
			console.log("ℹ️  No segments need keyword extraction");
			await db.disconnect();
			process.exit(0);
		}

		console.log(`Found ${totalSegments.toLocaleString()} segments to process\n`);

		let processed = 0;
		let updated = 0;
		let skipped = 0;
		let errors = 0;

		// Process in batches
		for (let i = 0; i < segments.length; i += batchSize) {
			const batch = segments.slice(i, i + batchSize);
			const batchNum = Math.floor(i / batchSize) + 1;
			const totalBatches = Math.ceil(segments.length / batchSize);

			console.log(`[Batch ${batchNum}/${totalBatches}] Processing ${batch.length} segments...`);

			for (const segment of batch) {
				try {
					// Fetch messages for this segment
					if (!segment.message_ids || segment.message_ids.length === 0) {
						skipped++;
						continue;
					}

					const messagesResult = await db.query(
						`
						SELECT id, author_id, content, embedding
						FROM messages
						WHERE id = ANY($1::TEXT[])
							AND content IS NOT NULL
							AND content != ''
						ORDER BY created_at ASC
					`,
						[segment.message_ids]
					);

					if (!messagesResult.success || !messagesResult.data || messagesResult.data.length === 0) {
						skipped++;
						continue;
					}

					const messages = messagesResult.data as Array<{
						id: string;
						author_id: string;
						content: string;
						embedding: unknown;
					}>;

					// Convert to KeywordMessage format
					const keywordMessages: KeywordMessage[] = messages.map((m) => ({
						id: m.id,
						content: m.content || "",
						author_id: m.author_id,
						embedding: Array.isArray(m.embedding) ? m.embedding : undefined,
					}));

					// Extract keywords
					const keywords = await keywordExtractor.extractKeywords(keywordMessages, guildId, {
						method: "hybrid",
						topN: 10,
					});

					// Get existing features
					const featuresResult = await db.query(
						`SELECT features FROM conversation_segments WHERE id = $1`,
						[segment.id]
					);

					let existingFeatures: Record<string, any> = {};
					if (featuresResult.success && featuresResult.data && featuresResult.data.length > 0) {
						const featuresRaw = featuresResult.data[0]?.features;
						if (featuresRaw) {
							existingFeatures =
								typeof featuresRaw === "string" ? JSON.parse(featuresRaw) : featuresRaw;
						}
					}

					// Update features with keywords
					existingFeatures.keywords = keywords;

					// Update database
					await db.query(
						`UPDATE conversation_segments SET features = $1 WHERE id = $2`,
						[JSON.stringify(existingFeatures), segment.id]
					);

					updated++;
					processed++;

					// Log progress every 10 segments
					if (processed % 10 === 0) {
						process.stdout.write(`\r   Processed: ${processed}/${totalSegments} (${updated} updated, ${skipped} skipped, ${errors} errors)`);
					}
				} catch (error) {
					errors++;
					processed++;
					console.error(`\n   ⚠️  Error processing segment ${segment.id.slice(0, 8)}:`, error);
				}
			}

			console.log(`\n   Batch ${batchNum} complete: ${updated} updated, ${skipped} skipped, ${errors} errors`);
		}

		console.log("\n" + "=".repeat(80));
		console.log("✅ Keyword extraction complete!");
		console.log("=".repeat(80));
		console.log(`   Total processed: ${processed.toLocaleString()}`);
		console.log(`   Updated: ${updated.toLocaleString()}`);
		console.log(`   Skipped: ${skipped.toLocaleString()}`);
		console.log(`   Errors: ${errors.toLocaleString()}`);
		console.log("=".repeat(80));
	} catch (error) {
		console.error("\n❌ Keyword extraction failed:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
		console.log("\n🔹 Disconnected from PostgreSQL");
	}
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});

