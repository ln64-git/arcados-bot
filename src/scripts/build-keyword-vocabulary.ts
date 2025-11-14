/**
 * Build TF-IDF vocabulary for guilds
 *
 * This script analyzes all conversations in a guild and builds a corpus-specific
 * vocabulary with IDF (Inverse Document Frequency) scores for keyword extraction.
 *
 * Usage:
 *   npm run keywords:build-vocabulary                    # Build for all guilds
 *   GUILD_ID=123456789 npm run keywords:build-vocabulary  # Build for specific guild
 */

import { config } from "../config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { KeywordExtractor } from "../features/keywords/KeywordExtractor";

async function main() {
	console.log("🔧 Building keyword vocabulary...\n");

	// Initialize database
	const db = new PostgreSQLManager({
		connectionString: config.postgresUrl || "postgresql://localhost:5432/arcados",
	});

	try {
		await db.connect();
		console.log("✅ Connected to PostgreSQL\n");

		// Initialize keyword extractor
		const keywordExtractor = new KeywordExtractor(db);

		// Get guild ID from environment or build for all guilds
		const targetGuildId = process.env.GUILD_ID;

		if (targetGuildId) {
			// Build vocabulary for specific guild
			console.log(`📊 Building vocabulary for guild ${targetGuildId}...\n`);
			await keywordExtractor.buildVocabulary(targetGuildId, true);

			const stats = await keywordExtractor.getVocabularyStats(targetGuildId);
			if (stats) {
				console.log("\n📈 Vocabulary Statistics:");
				console.log(`   Total terms: ${stats.total_terms}`);
				console.log(`   Stopwords: ${stats.stopword_count}`);
				console.log(`   Avg IDF: ${stats.avg_idf.toFixed(3)}`);
				console.log(`   Median IDF: ${stats.median_idf.toFixed(3)}`);
				console.log(`   90th percentile IDF: ${stats.p90_idf.toFixed(3)}`);
			}
		} else {
			// Build vocabulary for all guilds
			console.log("📊 Building vocabulary for all guilds...\n");

			const guildsResult = await db.query<{ id: string; name: string }>(
				"SELECT id, name FROM guilds WHERE active = true",
			);

			if (!guildsResult.success || !guildsResult.data) {
				console.error("❌ Failed to fetch guilds");
				process.exit(1);
			}

			const guilds = guildsResult.data;
			console.log(`Found ${guilds.length} active guilds\n`);

			for (const guild of guilds) {
				console.log(`\n📊 Building vocabulary for guild ${guild.name} (${guild.id})...`);

				try {
					await keywordExtractor.buildVocabulary(guild.id, true);

					const stats = await keywordExtractor.getVocabularyStats(guild.id);
					if (stats) {
						console.log("   ✅ Success!");
						console.log(`   Total terms: ${stats.total_terms}`);
						console.log(`   Stopwords: ${stats.stopword_count}`);
						console.log(`   Avg IDF: ${stats.avg_idf.toFixed(3)}`);
					}
				} catch (error) {
					console.error(`   ❌ Failed to build vocabulary for guild ${guild.id}:`, error);
				}
			}
		}

		console.log("\n✅ Vocabulary building complete!");
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

main();
