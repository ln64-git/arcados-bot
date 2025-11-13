import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

interface DailyStats {
	date: string;
	messageCount: number;
	tokenCount: number;
	uniqueAuthors: number;
	channelCount: number;
}

/**
 * Estimate token count for text content
 * Uses a simple approximation: ~4 characters per token for English text
 */
function estimateTokens(text: string): number {
	if (!text || text.length === 0) return 0;
	// Average of 4 characters per token is a common approximation
	return Math.ceil(text.length / 4);
}

async function analyzeWeeklyMessageStats() {
	const db = new PostgreSQLManager();

	try {
		console.log("🔹 Connecting to database...");
		const connected = await db.connect();
		if (!connected) {
			console.error("🔸 Failed to connect to database");
			return;
		}

		console.log("✅ Connected\n");

		const guildId = process.argv[2] || process.env.GUILD_ID;

		if (!guildId) {
			console.error("🔸 Usage: npm run script src/scripts/analyze-weekly-message-stats.ts <guild_id>");
			console.error("   Or set GUILD_ID in .env");
			return;
		}

		// Calculate date range for the past week
		const now = new Date();
		const oneWeekAgo = new Date(now);
		oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log(`  Weekly Message Statistics - Guild: ${guildId}`);
		console.log(`  ${oneWeekAgo.toLocaleDateString()} → ${now.toLocaleDateString()}`);
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

		// Query messages grouped by day
		const result = await db.query(
			`
			SELECT 
				DATE(created_at) as message_date,
				COUNT(*) as message_count,
				COUNT(DISTINCT author_id) as unique_authors,
				COUNT(DISTINCT channel_id) as channel_count,
				ARRAY_AGG(content) as contents
			FROM messages
			WHERE guild_id = $1
				AND created_at >= $2
				AND created_at <= $3
				AND active = true
			GROUP BY DATE(created_at)
			ORDER BY message_date ASC
			`,
			[guildId, oneWeekAgo, now]
		);

		if (!result.success || !result.data || result.data.length === 0) {
			console.log("❌ No messages found for the past week");
			if (result.error) {
				console.error("   Error:", result.error);
			}
			return;
		}

		const dailyStats: DailyStats[] = [];
		let totalMessages = 0;
		let totalTokens = 0;

		// Process each day's data
		for (const row of result.data) {
			const contents = row.contents as string[];
			let dayTokens = 0;

			// Calculate tokens for all messages that day
			for (const content of contents) {
				if (content) {
					dayTokens += estimateTokens(content);
				}
			}

			const stats: DailyStats = {
				date: new Date(row.message_date).toLocaleDateString(),
				messageCount: parseInt(row.message_count),
				tokenCount: dayTokens,
				uniqueAuthors: parseInt(row.unique_authors),
				channelCount: parseInt(row.channel_count),
			};

			dailyStats.push(stats);
			totalMessages += stats.messageCount;
			totalTokens += stats.tokenCount;
		}

		// Display daily statistics
		console.log("📅 Daily Breakdown:\n");
		console.log(
			"┌─────────────────┬──────────┬────────────┬──────────┬──────────┐"
		);
		console.log(
			"│      Date       │ Messages │   Tokens   │ Authors  │ Channels │"
		);
		console.log(
			"├─────────────────┼──────────┼────────────┼──────────┼──────────┤"
		);

		for (const stats of dailyStats) {
			const date = stats.date.padEnd(15);
			const messages = stats.messageCount.toString().padStart(8);
			const tokens = stats.tokenCount.toLocaleString().padStart(10);
			const authors = stats.uniqueAuthors.toString().padStart(8);
			const channels = stats.channelCount.toString().padStart(8);

			console.log(
				`│ ${date} │ ${messages} │ ${tokens} │ ${authors} │ ${channels} │`
			);
		}

		console.log(
			"└─────────────────┴──────────┴────────────┴──────────┴──────────┘"
		);

		// Display summary statistics
		console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log("📊 Weekly Summary:");
		console.log(`   📨 Total Messages: ${totalMessages.toLocaleString()}`);
		console.log(`   🔤 Total Tokens: ${totalTokens.toLocaleString()}`);
		console.log(
			`   📈 Average per Day: ${Math.round(totalMessages / dailyStats.length).toLocaleString()} messages, ${Math.round(totalTokens / dailyStats.length).toLocaleString()} tokens`
		);

		if (dailyStats.length > 0) {
			const avgTokensPerMessage = Math.round(totalTokens / totalMessages);
			console.log(
				`   💬 Average Tokens per Message: ${avgTokensPerMessage}`
			);

			// Find busiest day
			const busiestDay = dailyStats.reduce((max, current) =>
				current.messageCount > max.messageCount ? current : max
			);
			console.log(
				`   🔥 Busiest Day: ${busiestDay.date} (${busiestDay.messageCount.toLocaleString()} messages, ${busiestDay.tokenCount.toLocaleString()} tokens)`
			);

			// Find quietest day
			const quietestDay = dailyStats.reduce((min, current) =>
				current.messageCount < min.messageCount ? current : min
			);
			console.log(
				`   😴 Quietest Day: ${quietestDay.date} (${quietestDay.messageCount.toLocaleString()} messages, ${quietestDay.tokenCount.toLocaleString()} tokens)`
			);
		}

		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

		// Token cost estimation (optional)
		console.log("💰 Estimated API Costs (if using all messages as context):");
		console.log(
			`   Note: Estimates use ~4 chars/token approximation`
		);
		console.log(
			`   • GPT-4 Turbo (input):  $${(totalTokens / 1_000_000) * 10} @ $10/1M tokens`
		);
		console.log(
			`   • GPT-4o (input):       $${(totalTokens / 1_000_000) * 2.5} @ $2.50/1M tokens`
		);
		console.log(
			`   • Claude 3.5 (input):   $${(totalTokens / 1_000_000) * 3} @ $3/1M tokens`
		);
		console.log("\n");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

analyzeWeeklyMessageStats();

