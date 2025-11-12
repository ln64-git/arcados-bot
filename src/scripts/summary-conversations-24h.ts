import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { AnalysisFormatter } from "./utils/analysis-formatter.js";

async function summaryConversations24h() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		const guildId = process.argv[2] || process.env.GUILD_ID;
		if (!guildId) {
			console.error("\n❌ Error: Guild ID required");
			console.error("Usage: npm run summary:conversations:24h <guild_id>\n");
			return;
		}

		// Get guild name for display
		const guildResult = await db.query("SELECT name FROM guilds WHERE id = $1", [guildId]);
		const guildName = guildResult.data?.[0]?.name || guildId;

		const twentyFourHoursAgo = new Date();
		twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

		AnalysisFormatter.section(`CONVERSATION SUMMARY (LAST 24H) - ${guildName.toUpperCase()}`, 90);

		// Quick Stats
		AnalysisFormatter.subsection("Quick Statistics", 88);

		const stats = await db.query(
			`
			SELECT
				COUNT(DISTINCT cs.id) as total_segments,
				COUNT(DISTINCT CASE WHEN cs.status = 'active' THEN cs.id END) as active,
				COUNT(DISTINCT CASE WHEN cs.status = 'finalized' THEN cs.id END) as finalized,
				SUM(cs.message_count) as total_messages,
				AVG(cs.message_count) as avg_messages,
				COUNT(DISTINCT cs.channel_id) as channels,
				COUNT(DISTINCT p.participant) as unique_participants
			FROM conversation_segments cs
			LEFT JOIN LATERAL unnest(cs.participants) AS p(participant) ON true
			WHERE cs.guild_id = $1 AND cs.start_time >= $2
			`,
			[guildId, twentyFourHoursAgo]
		);

		if (stats.data && stats.data[0]) {
			const s = stats.data[0];
			AnalysisFormatter.metric("Total Conversations", AnalysisFormatter.formatNumber(s.total_segments));
			console.log("│");
			AnalysisFormatter.metric("🟢 Active", AnalysisFormatter.formatNumber(s.active || 0));
			AnalysisFormatter.metric("⚪ Finalized", AnalysisFormatter.formatNumber(s.finalized || 0));
			console.log("│");
			AnalysisFormatter.metric("Total Messages", AnalysisFormatter.formatNumber(s.total_messages || 0));
			AnalysisFormatter.metric("Avg Messages/Conv", parseFloat(s.avg_messages || "0").toFixed(1));
			console.log("│");
			AnalysisFormatter.metric("Active Channels", AnalysisFormatter.formatNumber(s.channels || 0));
			AnalysisFormatter.metric("Unique Participants", AnalysisFormatter.formatNumber(s.unique_participants || 0));
		}

		AnalysisFormatter.subsectionEnd(88);

		// Top Channels
		AnalysisFormatter.subsection("Most Active Channels", 88);

		const channelStats = await db.query(
			`
			SELECT
				cs.channel_id,
				c.name as channel_name,
				COUNT(*) as conversation_count,
				SUM(cs.message_count) as total_messages,
				COUNT(CASE WHEN cs.status = 'active' THEN 1 END) as active_count,
				MAX(cs.end_time) as last_activity
			FROM conversation_segments cs
			LEFT JOIN channels c ON c.id = cs.channel_id
			WHERE cs.guild_id = $1 AND cs.start_time >= $2
			GROUP BY cs.channel_id, c.name
			ORDER BY conversation_count DESC
			LIMIT 10
			`,
			[guildId, twentyFourHoursAgo]
		);

		if (channelStats.data && channelStats.data.length > 0) {
			const columns = [
				{ header: "Channel", width: 30, align: "left" as const },
				{ header: "Conversations", width: 14, align: "right" as const },
				{ header: "Messages", width: 12, align: "right" as const },
				{ header: "Active", width: 10, align: "right" as const },
				{ header: "Last Activity", width: 20, align: "left" as const },
			];

			const rows = channelStats.data.map((ch: any) => {
				const name = (ch.channel_name || ch.channel_id).substring(0, 29);
				const lastActivity = new Date(ch.last_activity).toLocaleString("en-US", {
					month: "short",
					day: "numeric",
					hour: "2-digit",
					minute: "2-digit",
				});
				return [
					name,
					AnalysisFormatter.formatNumber(ch.conversation_count),
					AnalysisFormatter.formatNumber(ch.total_messages),
					AnalysisFormatter.formatNumber(ch.active_count),
					lastActivity,
				];
			});

			AnalysisFormatter.table(columns, rows);
		}

		AnalysisFormatter.subsectionEnd(88);

		// Active Conversations Preview
		AnalysisFormatter.subsection("Active Conversations Preview", 88);

		const activePreview = await db.query(
			`
			SELECT
				cs.id,
				cs.channel_id,
				c.name as channel_name,
				cs.participants,
				cs.message_count,
				cs.last_activity_at
			FROM conversation_segments cs
			LEFT JOIN channels c ON c.id = cs.channel_id
			WHERE cs.guild_id = $1
				AND cs.start_time >= $2
				AND cs.status = 'active'
			ORDER BY cs.last_activity_at DESC NULLS LAST
			LIMIT 5
			`,
			[guildId, twentyFourHoursAgo]
		);

		if (activePreview.data && activePreview.data.length > 0) {
			for (const conv of activePreview.data) {
				const participantCount = Array.isArray(conv.participants) ? conv.participants.length : 0;
				const lastActivity = conv.last_activity_at
					? new Date(conv.last_activity_at).toLocaleString("en-US", {
							month: "short",
							day: "numeric",
							hour: "2-digit",
							minute: "2-digit",
						})
					: "Unknown";
				const channelName = conv.channel_name || conv.channel_id.substring(0, 20);

				console.log(
					`│ 🟢 ${channelName} | ${conv.message_count} msgs | ${participantCount} people | Last: ${lastActivity}`
				);
			}
		} else {
			AnalysisFormatter.warning("No active conversations");
		}

		AnalysisFormatter.subsectionEnd(88);

		AnalysisFormatter.success("Summary complete");

		await db.disconnect();
	} catch (error) {
		AnalysisFormatter.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		await db.disconnect();
		process.exit(1);
	}
}

summaryConversations24h();

