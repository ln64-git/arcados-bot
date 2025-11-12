import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { AnalysisFormatter } from "./utils/analysis-formatter.js";

interface ConversationSegment {
	id: string;
	guild_id: string;
	channel_id: string;
	channel_name?: string;
	participants: string[];
	start_time: Date;
	end_time: Date;
	message_count: number;
	summary?: string;
	status?: string;
	features?: any;
}

async function inspectConversationsByStatus() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		const guildId = process.argv[2] || process.env.GUILD_ID;
		if (!guildId) {
			console.error("\n❌ Error: Guild ID required");
			console.error("Usage: npm run inspect:conversations:status <guild_id>\n");
			return;
		}

		// Get guild name for display
		const guildResult = await db.query("SELECT name FROM guilds WHERE id = $1", [guildId]);
		const guildName = guildResult.data?.[0]?.name || guildId;

		const twentyFourHoursAgo = new Date();
		twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

		AnalysisFormatter.section(
			`CONVERSATION STATUS INSPECTION (LAST 24 HOURS) - ${guildName.toUpperCase()}`,
			90
		);

		// Overall Statistics
		AnalysisFormatter.subsection("Overall Statistics (Last 24h)", 88);

		const overallStats = await db.query(
			`
			SELECT
				COUNT(*) as total_segments,
				COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count,
				COUNT(CASE WHEN status = 'finalized' THEN 1 END) as finalized_count,
				COUNT(CASE WHEN status = 'paused' THEN 1 END) as paused_count,
				SUM(message_count) as total_messages,
				SUM(CASE WHEN status = 'active' THEN message_count ELSE 0 END) as active_messages,
				SUM(CASE WHEN status = 'finalized' THEN message_count ELSE 0 END) as finalized_messages,
				AVG(message_count) as avg_messages,
				MAX(message_count) as max_messages,
				COUNT(DISTINCT channel_id) as active_channels,
				AVG(EXTRACT(EPOCH FROM (end_time - start_time)) / 60) as avg_duration_min
			FROM conversation_segments
			WHERE guild_id = $1 AND start_time >= $2
			`,
			[guildId, twentyFourHoursAgo]
		);

		if (overallStats.data && overallStats.data[0]) {
			const s = overallStats.data[0];
			AnalysisFormatter.metric("Total Segments", AnalysisFormatter.formatNumber(s.total_segments));
			console.log("│");
			AnalysisFormatter.metric("🟢 Active", AnalysisFormatter.formatNumber(s.active_count || 0));
			AnalysisFormatter.metric("⚪ Finalized", AnalysisFormatter.formatNumber(s.finalized_count || 0));
			if (s.paused_count > 0) {
				AnalysisFormatter.metric("⏸️  Paused", AnalysisFormatter.formatNumber(s.paused_count || 0));
			}
			console.log("│");
			AnalysisFormatter.metric("Total Messages", AnalysisFormatter.formatNumber(s.total_messages || 0));
			AnalysisFormatter.metric("Active Messages", AnalysisFormatter.formatNumber(s.active_messages || 0));
			AnalysisFormatter.metric(
				"Finalized Messages",
				AnalysisFormatter.formatNumber(s.finalized_messages || 0)
			);
			console.log("│");
			AnalysisFormatter.metric("Avg Messages/Segment", parseFloat(s.avg_messages || "0").toFixed(1));
			AnalysisFormatter.metric("Largest Segment", AnalysisFormatter.formatNumber(s.max_messages || 0));
			AnalysisFormatter.metric("Active Channels", AnalysisFormatter.formatNumber(s.active_channels || 0));
			console.log("│");
			AnalysisFormatter.metric(
				"Avg Duration",
				AnalysisFormatter.formatDuration(parseFloat(s.avg_duration_min || "0"))
			);
		}
		AnalysisFormatter.subsectionEnd(88);

		// Get participant names map
		const allSegmentsResult = await db.query(
			`SELECT DISTINCT unnest(participants) as user_id
			FROM conversation_segments
			WHERE guild_id = $1 AND start_time >= $2`,
			[guildId, twentyFourHoursAgo]
		);

		const allUserIds =
			allSegmentsResult.data?.map((row: any) => row.user_id) || [];
		const nameMap = new Map<string, string>();

		if (allUserIds.length > 0) {
			const namesResult = await db.query(
				`SELECT user_id, display_name, username, global_name
				FROM members
				WHERE guild_id = $1 AND user_id = ANY($2::TEXT[]) AND active = true`,
				[guildId, allUserIds]
			);

			if (namesResult.success && namesResult.data) {
				for (const row of namesResult.data) {
					const displayName = row.display_name || row.global_name || row.username || row.user_id;
					nameMap.set(row.user_id, displayName);
				}
			}
		}

		// ACTIVE CONVERSATIONS
		AnalysisFormatter.subsection("🟢 ACTIVE CONVERSATIONS", 88);

		const activeSegmentsResult = await db.query(
			`SELECT
				cs.id,
				cs.guild_id,
				cs.channel_id,
				c.name as channel_name,
				cs.participants,
				cs.start_time,
				cs.end_time,
				cs.message_count,
				cs.summary,
				cs.status,
				cs.features,
				cs.last_activity_at
			FROM conversation_segments cs
			LEFT JOIN channels c ON c.id = cs.channel_id
			WHERE cs.guild_id = $1
				AND cs.start_time >= $2
				AND cs.status = 'active'
			ORDER BY cs.last_activity_at DESC NULLS LAST, cs.end_time DESC`,
			[guildId, twentyFourHoursAgo]
		);

		const activeSegments = (activeSegmentsResult.data || []) as ConversationSegment[];

		if (activeSegments.length === 0) {
			AnalysisFormatter.warning("No active conversations in the last 24 hours");
		} else {
			AnalysisFormatter.metric("Active Conversations", AnalysisFormatter.formatNumber(activeSegments.length));

			for (let i = 0; i < activeSegments.length; i++) {
				const segment = activeSegments[i];
				const uniqueParticipants = Array.from(
					new Set(Array.isArray(segment.participants) ? segment.participants : [])
				);
				const participantNames = uniqueParticipants
					.map((uid) => nameMap.get(uid) || uid.substring(0, 8))
					.join(", ");

				const duration =
					(new Date(segment.end_time).getTime() - new Date(segment.start_time).getTime()) / 1000 / 60;
				const lastActivity = segment.last_activity_at
					? new Date(segment.last_activity_at).toLocaleString()
					: "Unknown";

				console.log("│");
				console.log(
					`│ ${i + 1}. ${segment.channel_name || segment.channel_id.substring(0, 20)} 🟢 ACTIVE`
				);
				console.log(`│    ID: ${segment.id}`);
				console.log(`│    Participants: ${participantNames}`);
				console.log(
					`│    ${segment.message_count} messages • ${duration.toFixed(1)} min • ${uniqueParticipants.length} people`
				);
				console.log(
					`│    Started: ${new Date(segment.start_time).toLocaleString()} | Last Activity: ${lastActivity}`
				);
				if (segment.summary) {
					console.log(`│    Summary: ${segment.summary}`);
				}

				// Show recent messages for active conversations
				const messagesResult = await db.query(
					`SELECT
						m.id,
						m.author_id,
						m.content,
						m.created_at,
						m.referenced_message_id,
						u.display_name,
						u.username
					FROM conversation_segments cs
					JOIN messages m ON m.id = ANY(cs.message_ids::TEXT[])
					LEFT JOIN members u ON u.user_id = m.author_id AND u.guild_id = m.guild_id
					WHERE cs.id = $1 AND m.active = true
					ORDER BY m.created_at DESC
					LIMIT 5`,
					[segment.id]
				);

				if (messagesResult.success && messagesResult.data && messagesResult.data.length > 0) {
					const messages = messagesResult.data as Array<{
						author_id: string;
						content: string;
						created_at: Date;
						display_name?: string;
						username?: string;
					}>;
					console.log("│    Recent Messages:");
					for (const msg of messages.reverse()) {
						const authorName =
							nameMap.get(msg.author_id) ||
							msg.display_name ||
							msg.username ||
							msg.author_id.substring(0, 8);
						const timestamp = new Date(msg.created_at).toLocaleTimeString("en-US", {
							hour: "2-digit",
							minute: "2-digit",
						});
						const content = (msg.content || "(no content)").substring(0, 100);
						console.log(`│       ${timestamp} ${authorName}: ${content}${content.length >= 100 ? "..." : ""}`);
					}
				}

				if (i < activeSegments.length - 1) {
					console.log("│    " + "─".repeat(84));
				}
			}
		}

		AnalysisFormatter.subsectionEnd(88);

		// FINALIZED CONVERSATIONS
		AnalysisFormatter.subsection("⚪ FINALIZED CONVERSATIONS", 88);

		const finalizedSegmentsResult = await db.query(
			`SELECT
				cs.id,
				cs.guild_id,
				cs.channel_id,
				c.name as channel_name,
				cs.participants,
				cs.start_time,
				cs.end_time,
				cs.message_count,
				cs.summary,
				cs.status,
				cs.features
			FROM conversation_segments cs
			LEFT JOIN channels c ON c.id = cs.channel_id
			WHERE cs.guild_id = $1
				AND cs.start_time >= $2
				AND cs.status = 'finalized'
			ORDER BY cs.end_time DESC
			LIMIT 20`,
			[guildId, twentyFourHoursAgo]
		);

		const finalizedSegments = (finalizedSegmentsResult.data || []) as ConversationSegment[];

		if (finalizedSegments.length === 0) {
			AnalysisFormatter.warning("No finalized conversations in the last 24 hours");
		} else {
			AnalysisFormatter.metric(
				"Finalized Conversations (showing top 20)",
				AnalysisFormatter.formatNumber(finalizedSegments.length)
			);

			for (let i = 0; i < finalizedSegments.length; i++) {
				const segment = finalizedSegments[i];
				const uniqueParticipants = Array.from(
					new Set(Array.isArray(segment.participants) ? segment.participants : [])
				);
				const participantNames = uniqueParticipants
					.map((uid) => nameMap.get(uid) || uid.substring(0, 8))
					.join(", ");

				const duration =
					(new Date(segment.end_time).getTime() - new Date(segment.start_time).getTime()) / 1000 / 60;
				const hoursAgo = Math.round(
					(Date.now() - new Date(segment.end_time).getTime()) / (1000 * 60 * 60)
				);

				console.log("│");
				console.log(
					`│ ${i + 1}. ${segment.channel_name || segment.channel_id.substring(0, 20)} ⚪ FINALIZED`
				);
				console.log(`│    ID: ${segment.id}`);
				console.log(`│    Participants: ${participantNames}`);
				console.log(
					`│    ${segment.message_count} messages • ${duration.toFixed(1)} min • ${uniqueParticipants.length} people`
				);
				console.log(
					`│    ${new Date(segment.start_time).toLocaleString()} → ${new Date(
						segment.end_time
					).toLocaleString()} (${hoursAgo}h ago)`
				);
				if (segment.summary) {
					console.log(`│    Summary: ${segment.summary}`);
				}

				// Show sample messages for finalized conversations
				const messagesResult = await db.query(
					`SELECT
						m.id,
						m.author_id,
						m.content,
						m.created_at,
						m.referenced_message_id,
						u.display_name,
						u.username
					FROM conversation_segments cs
					JOIN messages m ON m.id = ANY(cs.message_ids::TEXT[])
					LEFT JOIN members u ON u.user_id = m.author_id AND u.guild_id = m.guild_id
					WHERE cs.id = $1 AND m.active = true
					ORDER BY m.created_at ASC
					LIMIT 3`,
					[segment.id]
				);

				if (messagesResult.success && messagesResult.data && messagesResult.data.length > 0) {
					const messages = messagesResult.data as Array<{
						author_id: string;
						content: string;
						created_at: Date;
						display_name?: string;
						username?: string;
					}>;
					console.log("│    Sample Messages:");
					for (const msg of messages) {
						const authorName =
							nameMap.get(msg.author_id) ||
							msg.display_name ||
							msg.username ||
							msg.author_id.substring(0, 8);
						const timestamp = new Date(msg.created_at).toLocaleTimeString("en-US", {
							hour: "2-digit",
							minute: "2-digit",
						});
						const content = (msg.content || "(no content)").substring(0, 80);
						console.log(`│       ${timestamp} ${authorName}: ${content}${content.length >= 80 ? "..." : ""}`);
					}
				}

				if (i < finalizedSegments.length - 1) {
					console.log("│    " + "─".repeat(84));
				}
			}
		}

		AnalysisFormatter.subsectionEnd(88);

		// Comparison Table
		AnalysisFormatter.subsection("Status Comparison", 88);

		const comparisonResult = await db.query(
			`SELECT
				cs.status,
				COUNT(DISTINCT cs.id) as count,
				SUM(cs.message_count) as total_messages,
				AVG(cs.message_count) as avg_messages,
				AVG(EXTRACT(EPOCH FROM (cs.end_time - cs.start_time)) / 60) as avg_duration_min,
				COUNT(DISTINCT cs.channel_id) as channels,
				COUNT(DISTINCT p.participant) as unique_participants
			FROM conversation_segments cs
			LEFT JOIN LATERAL unnest(cs.participants) AS p(participant) ON true
			WHERE cs.guild_id = $1 AND cs.start_time >= $2
			GROUP BY cs.status
			ORDER BY count DESC`,
			[guildId, twentyFourHoursAgo]
		);

		if (comparisonResult.data && comparisonResult.data.length > 0) {
			const columns = [
				{ header: "Status", width: 12, align: "left" as const },
				{ header: "Count", width: 10, align: "right" as const },
				{ header: "Messages", width: 12, align: "right" as const },
				{ header: "Avg/Seg", width: 10, align: "right" as const },
				{ header: "Avg Duration", width: 14, align: "right" as const },
				{ header: "Channels", width: 10, align: "right" as const },
				{ header: "Participants", width: 13, align: "right" as const },
			];

			const rows = comparisonResult.data.map((row: any) => {
				const statusEmoji = row.status === "active" ? "🟢" : row.status === "finalized" ? "⚪" : "⏸️ ";
				return [
					`${statusEmoji} ${row.status}`,
					AnalysisFormatter.formatNumber(row.count),
					AnalysisFormatter.formatNumber(row.total_messages),
					parseFloat(row.avg_messages || "0").toFixed(1),
					AnalysisFormatter.formatDuration(parseFloat(row.avg_duration_min || "0")),
					AnalysisFormatter.formatNumber(row.channels),
					AnalysisFormatter.formatNumber(row.unique_participants),
				];
			});

			AnalysisFormatter.table(columns, rows);
		}

		AnalysisFormatter.subsectionEnd(88);

		AnalysisFormatter.success("Inspection complete");

		await db.disconnect();
	} catch (error) {
		AnalysisFormatter.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		await db.disconnect();
		process.exit(1);
	}
}

inspectConversationsByStatus();

