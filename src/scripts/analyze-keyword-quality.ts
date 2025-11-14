/**
 * Analyze keyword extraction quality
 *
 * This script provides insights into the quality and distribution of extracted keywords
 * across conversation segments. Useful for evaluating and tuning the keyword extraction system.
 *
 * Usage:
 *   npm run keywords:analyze                         # Analyze all guilds
 *   GUILD_ID=123456789 npm run keywords:analyze      # Analyze specific guild
 */

import { config } from "../config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

interface KeywordAnalytics {
	totalSegments: number;
	segmentsWithKeywords: number;
	segmentsWithoutKeywords: number;
	avgKeywordsPerSegment: number;
	totalUniqueKeywords: number;
	mostCommonKeywords: Array<{ keyword: string; count: number }>;
	keywordScoreDistribution: {
		high: number; // score > 0.7
		medium: number; // score 0.4-0.7
		low: number; // score < 0.4
	};
}

async function main() {
	console.log("📊 Analyzing keyword extraction quality...\n");

	// Initialize database
	const db = new PostgreSQLManager({
		connectionString: config.postgresUrl || "postgresql://localhost:5432/arcados",
	});

	try {
		await db.connect();
		console.log("✅ Connected to PostgreSQL\n");

		const targetGuildId = process.env.GUILD_ID;

		let query = `
      SELECT
        cs.id,
        cs.guild_id,
        cs.features
      FROM conversation_segments cs
      WHERE cs.status = 'finalized'
        AND cs.message_count >= 2
    `;

		const params: string[] = [];
		if (targetGuildId) {
			query += " AND cs.guild_id = $1";
			params.push(targetGuildId);
		}

		const segmentsResult = await db.query<{
			id: string;
			guild_id: string;
			features: any;
		}>(query, params);

		if (!segmentsResult.success || !segmentsResult.data) {
			console.error("❌ Failed to fetch conversation segments");
			process.exit(1);
		}

		const segments = segmentsResult.data;
		console.log(`Analyzing ${segments.length} conversation segments...\n`);

		const analytics: KeywordAnalytics = {
			totalSegments: segments.length,
			segmentsWithKeywords: 0,
			segmentsWithoutKeywords: 0,
			avgKeywordsPerSegment: 0,
			totalUniqueKeywords: 0,
			mostCommonKeywords: [],
			keywordScoreDistribution: {
				high: 0,
				medium: 0,
				low: 0,
			},
		};

		const keywordFrequency = new Map<string, number>();
		let totalKeywordCount = 0;

		for (const segment of segments) {
			const keywords = segment.features?.keywords?.terms;

			if (keywords && Array.isArray(keywords) && keywords.length > 0) {
				analytics.segmentsWithKeywords++;
				totalKeywordCount += keywords.length;

				for (const kw of keywords) {
					const word = kw.word?.toLowerCase();
					if (word) {
						keywordFrequency.set(word, (keywordFrequency.get(word) || 0) + 1);
					}

					// Analyze score distribution
					const score = kw.score || 0;
					if (score > 0.7) {
						analytics.keywordScoreDistribution.high++;
					} else if (score >= 0.4) {
						analytics.keywordScoreDistribution.medium++;
					} else {
						analytics.keywordScoreDistribution.low++;
					}
				}
			} else {
				analytics.segmentsWithoutKeywords++;
			}
		}

		analytics.avgKeywordsPerSegment =
			analytics.segmentsWithKeywords > 0
				? totalKeywordCount / analytics.segmentsWithKeywords
				: 0;

		analytics.totalUniqueKeywords = keywordFrequency.size;

		// Get top 20 most common keywords
		analytics.mostCommonKeywords = Array.from(keywordFrequency.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 20)
			.map(([keyword, count]) => ({ keyword, count }));

		// Print analytics
		console.log("═══════════════════════════════════════════════════");
		console.log("              KEYWORD QUALITY ANALYSIS             ");
		console.log("═══════════════════════════════════════════════════\n");

		console.log("📈 Overall Statistics:");
		console.log(`   Total segments: ${analytics.totalSegments}`);
		console.log(`   Segments with keywords: ${analytics.segmentsWithKeywords} (${((analytics.segmentsWithKeywords / analytics.totalSegments) * 100).toFixed(1)}%)`);
		console.log(`   Segments without keywords: ${analytics.segmentsWithoutKeywords} (${((analytics.segmentsWithoutKeywords / analytics.totalSegments) * 100).toFixed(1)}%)`);
		console.log(`   Average keywords per segment: ${analytics.avgKeywordsPerSegment.toFixed(2)}`);
		console.log(`   Total unique keywords: ${analytics.totalUniqueKeywords}`);

		console.log("\n📊 Keyword Score Distribution:");
		const totalScored =
			analytics.keywordScoreDistribution.high +
			analytics.keywordScoreDistribution.medium +
			analytics.keywordScoreDistribution.low;

		console.log(`   High confidence (>0.7): ${analytics.keywordScoreDistribution.high} (${((analytics.keywordScoreDistribution.high / totalScored) * 100).toFixed(1)}%)`);
		console.log(`   Medium confidence (0.4-0.7): ${analytics.keywordScoreDistribution.medium} (${((analytics.keywordScoreDistribution.medium / totalScored) * 100).toFixed(1)}%)`);
		console.log(`   Low confidence (<0.4): ${analytics.keywordScoreDistribution.low} (${((analytics.keywordScoreDistribution.low / totalScored) * 100).toFixed(1)}%)`);

		console.log("\n🔥 Top 20 Most Common Keywords:");
		for (const { keyword, count } of analytics.mostCommonKeywords) {
			const percentage = ((count / analytics.segmentsWithKeywords) * 100).toFixed(1);
			const bar = "█".repeat(Math.min(50, Math.floor((count / analytics.mostCommonKeywords[0]!.count) * 50)));
			console.log(`   ${keyword.padEnd(20)} ${bar} ${count} (${percentage}%)`);
		}

		// Analyze keywords by extraction method
		const methodDistribution = {
			tfidf: 0,
			semantic: 0,
			hybrid: 0,
			other: 0,
		};

		for (const segment of segments) {
			const method = segment.features?.keywords?.method;
			if (method === "tfidf") methodDistribution.tfidf++;
			else if (method === "semantic") methodDistribution.semantic++;
			else if (method === "hybrid") methodDistribution.hybrid++;
			else if (method) methodDistribution.other++;
		}

		console.log("\n🔬 Extraction Method Distribution:");
		console.log(`   TF-IDF: ${methodDistribution.tfidf} (${((methodDistribution.tfidf / analytics.segmentsWithKeywords) * 100).toFixed(1)}%)`);
		console.log(`   Semantic: ${methodDistribution.semantic} (${((methodDistribution.semantic / analytics.segmentsWithKeywords) * 100).toFixed(1)}%)`);
		console.log(`   Hybrid: ${methodDistribution.hybrid} (${((methodDistribution.hybrid / analytics.segmentsWithKeywords) * 100).toFixed(1)}%)`);
		console.log(`   Other: ${methodDistribution.other}`);

		console.log("\n═══════════════════════════════════════════════════");
		console.log("✅ Analysis complete!");
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

main();
