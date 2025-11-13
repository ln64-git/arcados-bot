import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { ConversationManager } from "../features/relationship-network/ConversationManager.js";
import { AnalysisFormatter } from "./utils/analysis-formatter.js";

// Test parameters
const CHANNEL_ID = "1254695279311978526"; // chat channel
const GUILD_ID = "1254694808228986912";
const TIME_WINDOW_HOURS = 24;

async function testEnhancedBatchMode() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		AnalysisFormatter.section("ENHANCED BATCH MODE TEST", 98);

		// Get channel name
		const channelResult = await db.query("SELECT name FROM channels WHERE id = $1", [
			CHANNEL_ID,
		]);
		const channelName = channelResult.data?.[0]?.name || CHANNEL_ID;

		AnalysisFormatter.subsection("Test Configuration", 96);
		AnalysisFormatter.metric("Channel", channelName);
		AnalysisFormatter.metric("Guild ID", GUILD_ID);
		AnalysisFormatter.metric("Time Window", `${TIME_WINDOW_HOURS} hours`);
		AnalysisFormatter.subsectionEnd(96);

		// Test the enhanced batch mode
		AnalysisFormatter.subsection("Running Enhanced Detection", 96);

		const conversationManager = new ConversationManager(db);
		const startTime = Date.now();

		const result = await conversationManager.detectConversationsOptimized(
			CHANNEL_ID,
			GUILD_ID,
			TIME_WINDOW_HOURS,
			3 // minMessages
		);

		const duration = Date.now() - startTime;

		if (!result.success) {
			AnalysisFormatter.error(`Detection failed: ${result.error}`);
			await db.disconnect();
			return;
		}

		const conversations = result.data || [];

		AnalysisFormatter.metric(
			"Conversations Detected",
			AnalysisFormatter.formatNumber(conversations.length)
		);
		AnalysisFormatter.metric("Processing Time", `${(duration / 1000).toFixed(2)}s`);

		AnalysisFormatter.subsectionEnd(96);

		// Calculate metrics
		if (conversations.length > 0) {
			AnalysisFormatter.subsection("Metrics", 96);

			const totalMessages = conversations.reduce((sum, c) => sum + c.message_count, 0);
			const avgMessagesPerConvo = totalMessages / conversations.length;
			const multiPartyConvos = conversations.filter((c) => c.participant_count > 2).length;

			// Get total messages in time window for coverage calculation
			const cutoffTime = new Date();
			cutoffTime.setHours(cutoffTime.getHours() - TIME_WINDOW_HOURS);

			const allMessagesResult = await db.query(
				`SELECT COUNT(*) as count FROM messages
				WHERE channel_id = $1 AND created_at >= $2 AND active = true`,
				[CHANNEL_ID, cutoffTime]
			);

			const totalInWindow = parseInt(allMessagesResult.data?.[0]?.count || "0");
			const coverage = totalInWindow > 0 ? (totalMessages / totalInWindow) * 100 : 0;

			AnalysisFormatter.metric("Total Messages", AnalysisFormatter.formatNumber(totalMessages));
			AnalysisFormatter.metric("Coverage", `${coverage.toFixed(1)}%`);
			AnalysisFormatter.metric("Avg Messages/Convo", avgMessagesPerConvo.toFixed(1));
			AnalysisFormatter.metric("Multi-Party Conversations", multiPartyConvos.toString());

			// Participant distribution
			const participantCounts = new Map<number, number>();
			for (const convo of conversations) {
				const count = participantCounts.get(convo.participant_count) || 0;
				participantCounts.set(convo.participant_count, count + 1);
			}

			console.log("│");
			console.log("│  Participant Distribution:");
			for (const [count, freq] of Array.from(participantCounts.entries()).sort(
				(a, b) => a[0] - b[0]
			)) {
				console.log(`│    ${count} people: ${freq} conversations`);
			}

			AnalysisFormatter.subsectionEnd(96);

			// Show sample conversations
			AnalysisFormatter.subsection("Sample Conversations", 96);

			const samplesToShow = Math.min(5, conversations.length);

			for (let i = 0; i < samplesToShow; i++) {
				const convo = conversations[i];

				console.log("│");
				console.log(
					`│  ${i + 1}. ${convo.participant_count} participants • ${convo.message_count} messages`
				);
				console.log(
					`│     Duration: ${convo.duration_minutes} min • ${new Date(convo.start_time).toLocaleString()}`
				);
				console.log(`│     Message IDs: ${convo.message_ids.slice(0, 3).join(", ")}${convo.message_ids.length > 3 ? "..." : ""}`);

				// Fetch participant names
				if (convo.message_ids.length > 0) {
					const msgsResult = await db.query(
						`SELECT DISTINCT m.author_id, u.display_name, u.username
						FROM messages m
						LEFT JOIN members u ON u.user_id = m.author_id AND u.guild_id = m.guild_id
						WHERE m.id = ANY($1::TEXT[]) AND m.active = true
						LIMIT 5`,
						[convo.message_ids.slice(0, 5)]
					);

					if (msgsResult.success && msgsResult.data) {
						const names = msgsResult.data
							.map((r: any) => r.display_name || r.username || r.author_id.substring(0, 8))
							.join(", ");
						console.log(`│     Participants: ${names}`);
					}
				}
			}

			if (conversations.length > samplesToShow) {
				console.log("│");
				console.log(`│  ... and ${conversations.length - samplesToShow} more conversations`);
			}

			AnalysisFormatter.subsectionEnd(96);
		} else {
			AnalysisFormatter.warning("No conversations detected in time window");
		}

		// Comparison with legacy method
		AnalysisFormatter.subsection("Comparison with Legacy Method (if available)", 96);
		console.log("│  Legacy detectConversations() is for 2-user analysis only");
		console.log("│  Enhanced method supports multi-party conversations");
		console.log("│  Enhanced method uses relationship-aware scoring");
		AnalysisFormatter.subsectionEnd(96);

		AnalysisFormatter.success("Test complete!");

		await db.disconnect();
	} catch (error) {
		AnalysisFormatter.error(
			`Error: ${error instanceof Error ? error.message : String(error)}`
		);
		await db.disconnect();
		process.exit(1);
	}
}

testEnhancedBatchMode();
