/**
 * Quick 24-hour conversation analysis for tuning optimization
 */

import { config } from "../config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { KeywordExtractor } from "../features/keywords/KeywordExtractor";

async function main() {
	console.log("📊 Analyzing past 24 hours for tuning optimization...\n");

	const db = new PostgreSQLManager({
		connectionString: config.postgresUrl || "postgresql://localhost:5432/arcados",
	});

	try {
		await db.connect();
		const guildId = process.env.GUILD_ID;
		if (!guildId) {
			console.error("❌ GUILD_ID required");
			process.exit(1);
		}

		const keywordExtractor = new KeywordExtractor(db);
		const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

		// Fetch 24h conversations
		const result = await db.query<{
			id: string;
			channel_id: string;
			participants: string[];
			message_ids: string[];
			message_count: number;
			start_time: Date;
			end_time: Date;
			features: any;
		}>(`
      SELECT id, channel_id, participants, message_ids, message_count,
             start_time, end_time, features
      FROM conversation_segments
      WHERE guild_id = $1 AND created_at >= $2 AND status = 'finalized'
      ORDER BY created_at DESC
    `, [guildId, cutoff]);

		if (!result.success || !result.data) {
			console.error("Failed to fetch data");
			process.exit(1);
		}

		const conversations = result.data;
		console.log(`Found ${conversations.length} conversations in past 24h\n`);

		// Get actual messages for time gap analysis
		const allMessageIds = conversations.flatMap((c) => c.message_ids);
		const messagesResult = await db.query<{
			id: string;
			channel_id: string;
			author_id: string;
			content: string;
			created_at: Date;
			referenced_message_id: string | null;
		}>(`
      SELECT id, channel_id, author_id, content, created_at,
             referenced_message_id
      FROM messages
      WHERE id = ANY($1)
      ORDER BY created_at
    `, [allMessageIds]);

		const messages = messagesResult.success ? messagesResult.data || [] : [];
		const messageMap = new Map(messages.map((m) => [m.id, m]));

		// Analysis metrics
		const orphans = conversations.filter((c) => c.message_count <= 2);
		const fullConvos = conversations.filter((c) => c.message_count > 2);
		const withKeywords = conversations.filter(
			(c) => c.features?.keywords?.terms?.length > 0,
		);

		// Calculate internal gaps
		const gapStats: number[] = [];
		for (const conv of conversations) {
			const convMessages = conv.message_ids
				.map((id) => messageMap.get(id))
				.filter((m) => m)
				.sort(
					(a, b) =>
						new Date(a!.created_at).getTime() -
						new Date(b!.created_at).getTime(),
				);

			for (let i = 1; i < convMessages.length; i++) {
				const gap =
					new Date(convMessages[i]!.created_at).getTime() -
					new Date(convMessages[i - 1]!.created_at).getTime();
				gapStats.push(gap / 1000 / 60); // minutes
			}
		}

		// Reply analysis
		let hasReplyChain = 0;
		for (const conv of conversations) {
			const convMessages = conv.message_ids.map((id: string) => messageMap.get(id));
			if (convMessages.some((m) => m?.referenced_message_id)) hasReplyChain++;
		}

		// Duration analysis
		const durations = conversations.map(
			(c) =>
				(new Date(c.end_time).getTime() -
					new Date(c.start_time).getTime()) /
				1000 /
				60,
		);

		// Print results
		console.log("═══════════════════════════════════════════════════");
		console.log("           24-HOUR CONVERSATION METRICS            ");
		console.log("═══════════════════════════════════════════════════\n");

		console.log("📈 Distribution:");
		console.log(`   Total conversations: ${conversations.length}`);
		console.log(
			`   Orphans (≤2 msgs): ${orphans.length} (${((orphans.length / conversations.length) * 100).toFixed(1)}%)`,
		);
		console.log(
			`   Full conversations (3+ msgs): ${fullConvos.length} (${((fullConvos.length / conversations.length) * 100).toFixed(1)}%)`,
		);

		console.log("\n📊 Message Counts:");
		const msgCounts = new Map<number, number>();
		for (const c of conversations) {
			msgCounts.set(c.message_count, (msgCounts.get(c.message_count) || 0) + 1);
		}
		for (const [count, num] of [...msgCounts.entries()].sort((a, b) => a[0] - b[0]).slice(0, 10)) {
			console.log(`   ${count} messages: ${num} conversations`);
		}

		console.log("\n⏱️  Duration Stats:");
		durations.sort((a, b) => a - b);
		console.log(`   Average: ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)} minutes`);
		console.log(`   Median: ${durations[Math.floor(durations.length / 2)]?.toFixed(1)} minutes`);
		console.log(`   90th percentile: ${durations[Math.floor(durations.length * 0.9)]?.toFixed(1)} minutes`);

		console.log("\n⏳ Internal Message Gaps:");
		gapStats.sort((a, b) => a - b);
		console.log(`   Average gap: ${(gapStats.reduce((a, b) => a + b, 0) / gapStats.length).toFixed(1)} minutes`);
		console.log(`   Median gap: ${gapStats[Math.floor(gapStats.length / 2)]?.toFixed(1)} minutes`);
		console.log(`   90th percentile: ${gapStats[Math.floor(gapStats.length * 0.9)]?.toFixed(1)} minutes`);
		console.log(`   Max gap: ${Math.max(...gapStats).toFixed(1)} minutes`);

		console.log("\n🔗 Interaction Signals:");
		console.log(
			`   With reply chains: ${hasReplyChain} (${((hasReplyChain / conversations.length) * 100).toFixed(1)}%)`,
		);

		console.log("\n🔤 Keyword Coverage:");
		console.log(
			`   With keywords: ${withKeywords.length} (${((withKeywords.length / conversations.length) * 100).toFixed(1)}%)`,
		);
		console.log(
			`   Without keywords: ${conversations.length - withKeywords.length}`,
		);

		// Find potential issues
		console.log("\n⚠️  Potential Issues:");

		// Orphans with keyword matches
		const orphansWithKeywords = orphans.filter(
			(o) => o.features?.keywords?.terms?.length > 0,
		);
		let mergeable = 0;
		for (const orphan of orphansWithKeywords) {
			for (const conv of fullConvos) {
				if (
					conv.channel_id === orphan.channel_id &&
					conv.features?.keywords
				) {
					const overlap = keywordExtractor.calculateKeywordOverlap(
						orphan.features.keywords,
						conv.features.keywords,
						true,
					);
					if (overlap >= 0.4) {
						mergeable++;
						break;
					}
				}
			}
		}
		console.log(`   Orphans potentially mergeable: ${mergeable}`);

		// Long conversations with big gaps
		const overMerged = conversations.filter((c) => {
			const duration =
				(new Date(c.end_time).getTime() -
					new Date(c.start_time).getTime()) /
				1000 /
				60;
			return duration > 30 && c.message_count >= 5;
		});
		console.log(`   Possibly over-merged (>30min duration): ${overMerged.length}`);

		// Show examples
		console.log("\n📋 Sample Orphans:");
		for (const orphan of orphans.slice(0, 3)) {
			const msgs = orphan.message_ids.map((id: string) => messageMap.get(id));
			const keywords =
				orphan.features?.keywords?.terms?.map((t: any) => t.word).join(", ") ||
				"none";
			console.log(`   ${orphan.id.substring(0, 8)}... - ${orphan.message_count} msgs`);
			console.log(`      Keywords: ${keywords}`);
			const firstMsg = msgs.find((m: any) => m);
			console.log(
				`      Content: ${firstMsg?.content.substring(0, 60) || "N/A"}...`,
			);
		}

		console.log("\n📋 Sample Long Conversations:");
		const longConvos = conversations
			.sort(
				(a, b) =>
					new Date(b.end_time).getTime() -
					new Date(b.start_time).getTime() -
					(new Date(a.end_time).getTime() -
						new Date(a.start_time).getTime()),
			)
			.slice(0, 3);
		for (const conv of longConvos) {
			const duration =
				(new Date(conv.end_time).getTime() -
					new Date(conv.start_time).getTime()) /
				1000 /
				60;
			const keywords =
				conv.features?.keywords?.terms?.map((t: any) => t.word).join(", ") ||
				"none";
			console.log(
				`   ${conv.id.substring(0, 8)}... - ${conv.message_count} msgs over ${duration.toFixed(0)}min`,
			);
			console.log(`      Participants: ${conv.participants.length}`);
			console.log(`      Keywords: ${keywords}`);
		}

		console.log("\n═══════════════════════════════════════════════════\n");
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	} finally {
		await db.disconnect();
	}
}

main();
