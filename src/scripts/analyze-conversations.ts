import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { AnalysisFormatter } from "./utils/analysis-formatter.js";

async function analyzeConversations() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		const guildId = process.argv[2] || process.env.GUILD_ID;
		if (!guildId) {
			console.error("\n❌ Error: Guild ID required");
			console.error("Usage: npm run analyze:conversations <guild_id>\n");
			return;
		}

		// Get guild name for display
		const guildResult = await db.query(
			"SELECT name FROM guilds WHERE id = $1",
			[guildId]
		);
		const guildName = guildResult.data?.[0]?.name || guildId;

		AnalysisFormatter.section(`CONVERSATION SEGMENTS ANALYSIS - ${guildName.toUpperCase()}`, 80);

		// 1. Overall Statistics
		AnalysisFormatter.subsection("Overall Statistics", 78);
		const stats = await db.query(
			`
			SELECT
				COUNT(*) as total_segments,
				COUNT(CASE WHEN status = 'active' THEN 1 END) as active_segments,
				COUNT(CASE WHEN status = 'finalized' THEN 1 END) as finalized_segments,
				AVG(message_count) as avg_messages,
				MAX(message_count) as max_messages,
				MIN(message_count) as min_messages,
				AVG(EXTRACT(EPOCH FROM (end_time - start_time)) / 60) as avg_duration_minutes,
				MAX(EXTRACT(EPOCH FROM (end_time - start_time)) / 60) as max_duration_minutes,
				MIN(EXTRACT(EPOCH FROM (end_time - start_time)) / 60) as min_duration_minutes,
				AVG(array_length(participants, 1)) as avg_participants,
				MAX(array_length(participants, 1)) as max_participants,
				SUM(message_count) as total_messages_in_segments
			FROM conversation_segments
			WHERE guild_id = $1
				`,
			[guildId]
		);

		if (stats.data && stats.data[0]) {
			const s = stats.data[0];
			AnalysisFormatter.metric("Total Segments", AnalysisFormatter.formatNumber(s.total_segments));
			if (s.active_segments > 0) {
				AnalysisFormatter.metric("Active Segments", AnalysisFormatter.formatNumber(s.active_segments));
			}
			AnalysisFormatter.metric("Finalized Segments", AnalysisFormatter.formatNumber(s.finalized_segments || 0));
			console.log("│");
			AnalysisFormatter.metric("Total Messages in Segments", AnalysisFormatter.formatNumber(s.total_messages_in_segments || 0));
			AnalysisFormatter.metric("Average Messages/Segment", parseFloat(s.avg_messages || "0").toFixed(1));
			AnalysisFormatter.metric("Message Range", `${s.min_messages} - ${s.max_messages}`);
			console.log("│");
			AnalysisFormatter.metric("Average Duration", AnalysisFormatter.formatDuration(parseFloat(s.avg_duration_minutes || "0")));
			AnalysisFormatter.metric("Max Duration", AnalysisFormatter.formatDuration(parseFloat(s.max_duration_minutes || "0")));
			AnalysisFormatter.metric("Min Duration", AnalysisFormatter.formatDuration(parseFloat(s.min_duration_minutes || "0")));
			console.log("│");
			AnalysisFormatter.metric("Average Participants", parseFloat(s.avg_participants || "0").toFixed(1));
			AnalysisFormatter.metric("Max Participants", AnalysisFormatter.formatNumber(s.max_participants || 0));
		}
		AnalysisFormatter.subsectionEnd(78);

		// 2. Segment Size Distribution
		AnalysisFormatter.subsection("Segment Size Distribution", 78);
		const sizeDistribution = await db.query(
			`
			SELECT
				bucket,
				COUNT(*) as segment_count
			FROM (
				SELECT
					CASE
						WHEN message_count <= 5 THEN '1-5'
						WHEN message_count <= 10 THEN '6-10'
						WHEN message_count <= 20 THEN '11-20'
						WHEN message_count <= 50 THEN '21-50'
						WHEN message_count <= 100 THEN '51-100'
						ELSE '100+'
					END as bucket
				FROM conversation_segments
				WHERE guild_id = $1
			) bucketed
			GROUP BY bucket
			ORDER BY
				CASE bucket
					WHEN '1-5' THEN 1
					WHEN '6-10' THEN 2
					WHEN '11-20' THEN 3
					WHEN '21-50' THEN 4
					WHEN '51-100' THEN 5
					ELSE 6
				END
			`,
			[guildId]
		);

		if (sizeDistribution.data && sizeDistribution.data.length > 0) {
			const total = sizeDistribution.data.reduce((sum, b) => sum + parseInt(b.segment_count), 0);
			const distributionData = sizeDistribution.data.map((bucket: any) => ({
				label: bucket.bucket,
				count: parseInt(bucket.segment_count),
				percentage: (parseInt(bucket.segment_count) / total) * 100,
			}));
			AnalysisFormatter.distributionChart(distributionData, 40);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 3. Duration Distribution
		AnalysisFormatter.subsection("Duration Distribution", 78);
		const durationDistribution = await db.query(
			`
			SELECT
				bucket,
				COUNT(*) as segment_count
			FROM (
				SELECT
					CASE
						WHEN EXTRACT(EPOCH FROM (end_time - start_time)) / 60 <= 15 THEN '0-15 min'
						WHEN EXTRACT(EPOCH FROM (end_time - start_time)) / 60 <= 60 THEN '15-60 min'
						WHEN EXTRACT(EPOCH FROM (end_time - start_time)) / 60 <= 240 THEN '1-4 hours'
						WHEN EXTRACT(EPOCH FROM (end_time - start_time)) / 60 <= 1440 THEN '4-24 hours'
						ELSE '24+ hours'
					END as bucket
				FROM conversation_segments
				WHERE guild_id = $1
			) bucketed
			GROUP BY bucket
			ORDER BY
				CASE bucket
					WHEN '0-15 min' THEN 1
					WHEN '15-60 min' THEN 2
					WHEN '1-4 hours' THEN 3
					WHEN '4-24 hours' THEN 4
					ELSE 5
				END
			`,
			[guildId]
		);

		if (durationDistribution.data && durationDistribution.data.length > 0) {
			const total = durationDistribution.data.reduce((sum, b) => sum + parseInt(b.segment_count), 0);
			const distributionData = durationDistribution.data.map((bucket: any) => ({
				label: bucket.bucket,
				count: parseInt(bucket.segment_count),
				percentage: (parseInt(bucket.segment_count) / total) * 100,
			}));
			AnalysisFormatter.distributionChart(distributionData, 40);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 4. Top 15 Largest Conversations
		AnalysisFormatter.subsection("Top 15 Largest Conversations", 78);
		const largestConvos = await db.query(
			`
			SELECT
				cs.id,
				cs.message_count,
				array_length(cs.participants, 1) as participant_count,
				EXTRACT(EPOCH FROM (cs.end_time - cs.start_time)) / 60 as duration_minutes,
				cs.start_time,
				cs.channel_id,
				c.name as channel_name,
				cs.status
			FROM conversation_segments cs
			LEFT JOIN channels c ON c.id = cs.channel_id
			WHERE cs.guild_id = $1
			ORDER BY cs.message_count DESC
			LIMIT 15
			`,
			[guildId]
		);

		if (largestConvos.data && largestConvos.data.length > 0) {
			const columns = [
				{ header: "Rank", width: 5, align: "right" as const },
				{ header: "Messages", width: 10, align: "right" as const },
				{ header: "Participants", width: 12, align: "right" as const },
				{ header: "Duration", width: 12, align: "left" as const },
				{ header: "Channel", width: 20, align: "left" as const },
				{ header: "Status", width: 10, align: "left" as const },
			];

			const rows = largestConvos.data.map((conv, i) => {
				const channelName = (conv.channel_name || conv.channel_id).substring(0, 19);
				return [
					i + 1,
					AnalysisFormatter.formatNumber(conv.message_count),
					AnalysisFormatter.formatNumber(conv.participant_count),
					AnalysisFormatter.formatDuration(parseFloat(conv.duration_minutes)),
					channelName,
					conv.status || "finalized",
				];
			});

			AnalysisFormatter.table(columns, rows);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 5. Channel Activity
		AnalysisFormatter.subsection("Channel Activity (Top 15)", 78);
		const channelActivity = await db.query(
			`
			SELECT
				cs.channel_id,
				c.name as channel_name,
				COUNT(*) as segment_count,
				SUM(cs.message_count) as total_messages,
				AVG(cs.message_count) as avg_messages_per_segment,
				MAX(cs.message_count) as max_messages_in_segment
			FROM conversation_segments cs
			LEFT JOIN channels c ON c.id = cs.channel_id
			WHERE cs.guild_id = $1
			GROUP BY cs.channel_id, c.name
			ORDER BY segment_count DESC
			LIMIT 15
			`,
			[guildId]
		);

		if (channelActivity.data && channelActivity.data.length > 0) {
			const columns = [
				{ header: "Rank", width: 5, align: "right" as const },
				{ header: "Channel", width: 25, align: "left" as const },
				{ header: "Segments", width: 10, align: "right" as const },
				{ header: "Total Msgs", width: 12, align: "right" as const },
				{ header: "Avg/Segment", width: 12, align: "right" as const },
				{ header: "Max/Segment", width: 12, align: "right" as const },
			];

			const rows = channelActivity.data.map((channel, i) => {
				const name = (channel.channel_name || channel.channel_id).substring(0, 24);
				return [
					i + 1,
					name,
					AnalysisFormatter.formatNumber(channel.segment_count),
					AnalysisFormatter.formatNumber(channel.total_messages),
					parseFloat(channel.avg_messages_per_segment || "0").toFixed(1),
					AnalysisFormatter.formatNumber(channel.max_messages_in_segment || 0),
				];
			});

			AnalysisFormatter.table(columns, rows);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 6. Participant Count Distribution
		AnalysisFormatter.subsection("Participant Count Distribution", 78);
		const participantDistribution = await db.query(
			`
			SELECT
				bucket,
				COUNT(*) as segment_count
			FROM (
				SELECT
					CASE
						WHEN array_length(participants, 1) <= 2 THEN '2'
						WHEN array_length(participants, 1) <= 3 THEN '3'
						WHEN array_length(participants, 1) <= 5 THEN '4-5'
						WHEN array_length(participants, 1) <= 10 THEN '6-10'
						ELSE '10+'
					END as bucket
				FROM conversation_segments
				WHERE guild_id = $1
			) bucketed
			GROUP BY bucket
			ORDER BY
				CASE bucket
					WHEN '2' THEN 1
					WHEN '3' THEN 2
					WHEN '4-5' THEN 3
					WHEN '6-10' THEN 4
					ELSE 5
				END
			`,
			[guildId]
		);

		if (participantDistribution.data && participantDistribution.data.length > 0) {
			const total = participantDistribution.data.reduce((sum, b) => sum + parseInt(b.segment_count), 0);
			const distributionData = participantDistribution.data.map((bucket: any) => ({
				label: bucket.bucket + " people",
				count: parseInt(bucket.segment_count),
				percentage: (parseInt(bucket.segment_count) / total) * 100,
			}));
			AnalysisFormatter.distributionChart(distributionData, 40);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 7. Time-based patterns
		AnalysisFormatter.subsection("Conversation Activity by Hour of Day", 78);
		const hourlyPattern = await db.query(
			`
			SELECT
				EXTRACT(HOUR FROM start_time) as hour,
				COUNT(*) as segment_count,
				AVG(message_count) as avg_messages
			FROM conversation_segments
			WHERE guild_id = $1
			GROUP BY hour
			ORDER BY hour
			`,
			[guildId]
		);

		if (hourlyPattern.data && hourlyPattern.data.length > 0) {
			const maxCount = Math.max(...hourlyPattern.data.map((h: any) => parseInt(h.segment_count)));
			const buckets = hourlyPattern.data.map((hour: any) => ({
				label: `${String(hour.hour).padStart(2, "0")}:00`,
				count: parseInt(hour.segment_count),
				percentage: 0,
			}));
			AnalysisFormatter.distributionChart(buckets, 40);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 8. Recent Activity (last 7 days)
		AnalysisFormatter.subsection("Recent Activity (Last 7 Days)", 78);
		const sevenDaysAgo = new Date();
		sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

		const recentActivity = await db.query(
			`
			SELECT
				COUNT(*) as recent_segments,
				SUM(message_count) as recent_messages,
				AVG(message_count) as avg_recent_messages
			FROM conversation_segments
			WHERE guild_id = $1 AND start_time >= $2
			`,
			[guildId, sevenDaysAgo]
		);

		if (recentActivity.data && recentActivity.data[0]) {
			const ra = recentActivity.data[0];
			AnalysisFormatter.metric("Segments Started", AnalysisFormatter.formatNumber(ra.recent_segments || 0));
			AnalysisFormatter.metric("Messages in Recent Segments", AnalysisFormatter.formatNumber(ra.recent_messages || 0));
			AnalysisFormatter.metric("Avg Messages per Recent Segment", parseFloat(ra.avg_recent_messages || "0").toFixed(1));
		}
		AnalysisFormatter.subsectionEnd(78);

		AnalysisFormatter.success("Analysis complete");

		await db.disconnect();
	} catch (error) {
		AnalysisFormatter.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		await db.disconnect();
		process.exit(1);
	}
}

analyzeConversations();
