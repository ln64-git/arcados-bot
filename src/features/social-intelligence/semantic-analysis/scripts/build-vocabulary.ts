#!/usr/bin/env bun
/**
 * Build Vocabulary Script
 *
 * Builds TF-IDF vocabulary for a guild by analyzing all finalized conversation segments.
 * This vocabulary is used for keyword extraction to identify contextually relevant terms.
 */

import { PostgreSQLManager } from "../../../../database/PostgreSQLManager";
import { KeywordExtractor } from "../KeywordExtractor";
import { config } from "../../../../config/index.js";

const db = new PostgreSQLManager();

async function main() {
	console.log("📚 Building Vocabulary for Keyword Extraction");
	console.log("=".repeat(80));

	const args = process.argv.slice(2);
	const forceRebuild = args.includes("--force") || args.includes("-f");

	// Get guild ID from env or config
	const guildId = process.env.GUILD_ID || config.guildId;

	if (!guildId) {
		console.error("❌ No guild ID provided");
		console.error("💡 Set GUILD_ID environment variable or in .env file");
		process.exit(1);
	}

	console.log(`Guild ID: ${guildId}`);
	console.log(`Mode: ${forceRebuild ? "FORCE REBUILD (will replace existing)" : "UPDATE (will skip if exists)"}`);
	console.log("=".repeat(80));

	const connected = await db.connect();
	if (!connected) {
		console.error("❌ Failed to connect to database");
		console.error("💡 Make sure POSTGRES_URL is set in your .env file");
		process.exit(1);
	}

	const keywordExtractor = new KeywordExtractor(db);

	try {
		console.log("\n🚀 Starting vocabulary build...\n");
		await keywordExtractor.buildVocabulary(guildId, forceRebuild);

		// Get vocabulary stats
		const stats = await keywordExtractor.getVocabularyStats(guildId);
		if (stats) {
			console.log("\n" + "=".repeat(80));
			console.log("✅ Vocabulary build complete!");
			console.log("=".repeat(80));
			console.log(`   Total terms: ${stats.total_terms.toLocaleString()}`);
			console.log(`   Stopwords: ${stats.stopword_count.toLocaleString()}`);
			console.log(`   Avg IDF: ${stats.avg_idf.toFixed(3)}`);
			console.log(`   Median IDF: ${stats.median_idf.toFixed(3)}`);
			console.log(`   P90 IDF: ${stats.p90_idf.toFixed(3)}`);
			console.log("=".repeat(80));
		} else {
			console.log("\n✅ Vocabulary build complete!");
		}
	} catch (error) {
		console.error("\n❌ Vocabulary build failed:", error);
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

