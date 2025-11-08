import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { AnalysisFormatter } from "./utils/analysis-formatter.js";

interface RelationshipStats {
	total_edges: number;
	edges_with_mentions: number;
	edges_with_replies: number;
	edges_with_reactions: number;
	total_mentions: number;
	total_replies: number;
	total_reactions: number;
	avg_interactions_per_edge: number;
	max_interactions: number;
	unique_users: number;
}

interface UserRank {
	user_id: string;
	username?: string;
	global_name?: string;
	total_interactions: number;
	connections: number;
	outgoing: number;
	incoming: number;
}

interface RelationshipPair {
	user1: string;
	user2: string;
	user1_name?: string;
	user1_global?: string;
	user2_name?: string;
	user2_global?: string;
	total_interactions: number;
	mentions: number;
	replies: number;
	reactions: number;
	last_interaction: Date;
}

async function analyzeRelationships() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		const guildId = process.argv[2] || process.env.GUILD_ID;
		if (!guildId) {
			console.error("\n❌ Error: Guild ID required");
			console.error("Usage: npm run analyze:relationships <guild_id>\n");
			return;
		}

		// Get guild name for display
		const guildResult = await db.query(
			"SELECT name FROM guilds WHERE id = $1",
			[guildId]
		);
		const guildName = guildResult.data?.[0]?.name || guildId;

		AnalysisFormatter.section(`RELATIONSHIP NETWORK ANALYSIS - ${guildName.toUpperCase()}`, 80);

		// 1. Overall Statistics
		AnalysisFormatter.subsection("Network Overview", 78);
		const stats = await db.query<RelationshipStats>(
			`SELECT
				COUNT(*) as total_edges,
				COUNT(CASE WHEN mentions > 0 THEN 1 END) as edges_with_mentions,
				COUNT(CASE WHEN replies > 0 THEN 1 END) as edges_with_replies,
				COUNT(CASE WHEN reactions > 0 THEN 1 END) as edges_with_reactions,
				SUM(mentions) as total_mentions,
				SUM(replies) as total_replies,
				SUM(reactions) as total_reactions,
				AVG(mentions + replies + reactions) as avg_interactions_per_edge,
				MAX(mentions + replies + reactions) as max_interactions,
				COUNT(DISTINCT user_a) + COUNT(DISTINCT user_b) - COUNT(DISTINCT CASE WHEN user_a = user_b THEN user_a END) as unique_users
			FROM relationship_edges
			WHERE guild_id = $1`,
			[guildId]
		);

		if (stats.data && stats.data[0]) {
			const s = stats.data[0];
			const totalInteractions = (s.total_mentions || 0) + (s.total_replies || 0) + (s.total_reactions || 0);
			const uniqueUsers = s.unique_users || 0;

			AnalysisFormatter.metric("Total Relationship Edges", AnalysisFormatter.formatNumber(s.total_edges));
			AnalysisFormatter.metric("Unique Users in Network", AnalysisFormatter.formatNumber(uniqueUsers));
			AnalysisFormatter.metric("Total Interactions", AnalysisFormatter.formatNumber(totalInteractions));
			console.log("│");
			console.log("│  Interaction Breakdown:");
			const mentionsPct = AnalysisFormatter.formatPercent(s.total_mentions || 0, totalInteractions);
			const repliesPct = AnalysisFormatter.formatPercent(s.total_replies || 0, totalInteractions);
			const reactionsPct = AnalysisFormatter.formatPercent(s.total_reactions || 0, totalInteractions);
			AnalysisFormatter.metric("  └─ Mentions", AnalysisFormatter.formatNumber(s.total_mentions || 0), undefined, ` (${mentionsPct})`);
			AnalysisFormatter.metric("  └─ Replies", AnalysisFormatter.formatNumber(s.total_replies || 0), undefined, ` (${repliesPct})`);
			AnalysisFormatter.metric("  └─ Reactions", AnalysisFormatter.formatNumber(s.total_reactions || 0), undefined, ` (${reactionsPct})`);
			console.log("│");
			AnalysisFormatter.metric("Avg Interactions per Edge", parseFloat(s.avg_interactions_per_edge || "0").toFixed(1));
			AnalysisFormatter.metric("Strongest Connection", AnalysisFormatter.formatNumber(s.max_interactions || 0), undefined, " interactions");
			if (uniqueUsers > 0) {
				const avgConnections = (s.total_edges * 2) / uniqueUsers;
				AnalysisFormatter.metric("Avg Connections per User", avgConnections.toFixed(1));
			}
		}
		AnalysisFormatter.subsectionEnd(78);

		// 2. Top Users
		AnalysisFormatter.subsection("Top 15 Most Active Users", 78);
		const topUsers = await db.query<UserRank>(
			`WITH user_totals AS (
				SELECT user_a as user_id,
					SUM(mentions + replies + reactions) as total_interactions,
					COUNT(*) as connection_count,
					SUM(mentions + replies + reactions) as outgoing
				FROM relationship_edges WHERE guild_id = $1 GROUP BY user_a
				UNION ALL
				SELECT user_b as user_id,
					SUM(mentions + replies + reactions) as total_interactions,
					COUNT(*) as connection_count,
					0 as outgoing
				FROM relationship_edges WHERE guild_id = $1 GROUP BY user_b
			)
			SELECT ut.user_id, m.username, m.global_name,
				SUM(ut.total_interactions) as total_interactions,
				SUM(ut.connection_count) as connections,
				SUM(CASE WHEN ut.outgoing > 0 THEN ut.outgoing ELSE 0 END) as outgoing,
				SUM(CASE WHEN ut.outgoing = 0 THEN ut.total_interactions ELSE 0 END) as incoming
			FROM user_totals ut
			LEFT JOIN members m ON m.user_id = ut.user_id AND m.guild_id = $1
			GROUP BY ut.user_id, m.username, m.global_name
			ORDER BY total_interactions DESC
			LIMIT 15`,
			[guildId]
		);

		if (topUsers.data && topUsers.data.length > 0) {
			const columns = [
				{ header: "Rank", width: 5, align: "right" as const },
				{ header: "User", width: 25, align: "left" as const },
				{ header: "Total", width: 10, align: "right" as const },
				{ header: "Connections", width: 12, align: "right" as const },
				{ header: "Out/In", width: 12, align: "right" as const },
				{ header: "Avg/Conn", width: 10, align: "right" as const },
			];

			const rows = topUsers.data.map((user, i) => {
				const name = (user.global_name || user.username || user.user_id).substring(0, 24);
				const avgPerConnection = user.connections > 0 ? (user.total_interactions / user.connections).toFixed(1) : "0.0";
				const outIn = `${user.outgoing || 0}/${user.incoming || 0}`;
				return [
					i + 1,
					name,
					AnalysisFormatter.formatNumber(user.total_interactions),
					AnalysisFormatter.formatNumber(user.connections),
					outIn,
					avgPerConnection,
				];
			});

			AnalysisFormatter.table(columns, rows);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 3. Strongest Bidirectional Relationships
		AnalysisFormatter.subsection("Strongest Mutual Relationships", 78);
		const strongestPairs = await db.query<RelationshipPair>(
			`WITH pair_totals AS (
				SELECT
					LEAST(user_a, user_b) as user1,
					GREATEST(user_a, user_b) as user2,
					SUM(mentions + replies + reactions) as total_interactions,
					SUM(mentions) as mentions,
					SUM(replies) as replies,
					SUM(reactions) as reactions,
					MAX(last_interaction) as last_interaction
				FROM relationship_edges
				WHERE guild_id = $1
				GROUP BY LEAST(user_a, user_b), GREATEST(user_a, user_b)
				HAVING COUNT(*) = 2
			)
			SELECT pt.*, m1.username as user1_name, m1.global_name as user1_global,
				m2.username as user2_name, m2.global_name as user2_global
			FROM pair_totals pt
			LEFT JOIN members m1 ON m1.user_id = pt.user1 AND m1.guild_id = $1
			LEFT JOIN members m2 ON m2.user_id = pt.user2 AND m2.guild_id = $1
			ORDER BY total_interactions DESC
			LIMIT 15`,
			[guildId]
		);

		if (strongestPairs.data && strongestPairs.data.length > 0) {
			const columns = [
				{ header: "Rank", width: 5, align: "right" as const },
				{ header: "User 1", width: 22, align: "left" as const },
				{ header: "User 2", width: 22, align: "left" as const },
				{ header: "Total", width: 8, align: "right" as const },
				{ header: "M/R/Re", width: 12, align: "right" as const },
				{ header: "Last", width: 12, align: "left" as const },
			];

			const rows = strongestPairs.data.map((pair, i) => {
				const name1 = (pair.user1_global || pair.user1_name || pair.user1).substring(0, 21);
				const name2 = (pair.user2_global || pair.user2_name || pair.user2).substring(0, 21);
				const interactions = `${pair.mentions || 0}/${pair.replies || 0}/${pair.reactions || 0}`;
				const lastInteraction = AnalysisFormatter.formatRelativeTime(pair.last_interaction);
				return [
					i + 1,
					name1,
					name2,
					AnalysisFormatter.formatNumber(pair.total_interactions),
					interactions,
					lastInteraction,
				];
			});

			AnalysisFormatter.table(columns, rows);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 4. Reciprocity Analysis
		AnalysisFormatter.subsection("Relationship Reciprocity", 78);
		const reciprocity = await db.query(
			`WITH pair_counts AS (
				SELECT
					LEAST(user_a, user_b) as user1,
					GREATEST(user_a, user_b) as user2,
					COUNT(*) as direction_count
				FROM relationship_edges WHERE guild_id = $1
				GROUP BY LEAST(user_a, user_b), GREATEST(user_a, user_b)
			)
			SELECT
				COUNT(CASE WHEN direction_count = 1 THEN 1 END) as one_way,
				COUNT(CASE WHEN direction_count = 2 THEN 1 END) as two_way,
				COUNT(*) as total_pairs
			FROM pair_counts`,
			[guildId]
		);

		if (reciprocity.data && reciprocity.data[0]) {
			const r = reciprocity.data[0];
			const oneWayPct = AnalysisFormatter.formatPercent(r.one_way, r.total_pairs);
			const twoWayPct = AnalysisFormatter.formatPercent(r.two_way, r.total_pairs);

			AnalysisFormatter.metric("Total Unique Pairs", AnalysisFormatter.formatNumber(r.total_pairs));
			console.log("│");
			AnalysisFormatter.metric("One-way relationships", AnalysisFormatter.formatNumber(r.one_way), undefined, ` (${oneWayPct})`);
			AnalysisFormatter.metric("Two-way relationships", AnalysisFormatter.formatNumber(r.two_way), undefined, ` (${twoWayPct})`);
			console.log("│");
			const reciprocityScore = parseFloat(twoWayPct);
			AnalysisFormatter.metric(
				"Reciprocity Score",
				twoWayPct + " mutual",
				reciprocityScore > 30 ? "good" : reciprocityScore > 20 ? "warning" : "bad"
			);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 5. Interaction Strength Distribution
		AnalysisFormatter.subsection("Interaction Strength Distribution", 78);
		const buckets = await db.query(
			`WITH bucketed AS (
				SELECT
					CASE
						WHEN (mentions + replies + reactions) <= 2 THEN '1-2'
						WHEN (mentions + replies + reactions) <= 5 THEN '3-5'
						WHEN (mentions + replies + reactions) <= 10 THEN '6-10'
						WHEN (mentions + replies + reactions) <= 20 THEN '11-20'
						WHEN (mentions + replies + reactions) <= 50 THEN '21-50'
						ELSE '50+'
					END as bucket
				FROM relationship_edges WHERE guild_id = $1
			)
			SELECT bucket, COUNT(*) as edge_count
			FROM bucketed GROUP BY bucket
			ORDER BY
				CASE bucket
					WHEN '1-2' THEN 1 WHEN '3-5' THEN 2 WHEN '6-10' THEN 3
					WHEN '11-20' THEN 4 WHEN '21-50' THEN 5 ELSE 6
				END`,
			[guildId]
		);

		if (buckets.data && buckets.data.length > 0) {
			const total = buckets.data.reduce((sum, b) => sum + parseInt(String(b.edge_count)), 0);
			const distributionData = buckets.data.map((bucket: any) => ({
				label: bucket.bucket,
				count: parseInt(String(bucket.edge_count)),
				percentage: (parseInt(String(bucket.edge_count)) / total) * 100,
			}));
			AnalysisFormatter.distributionChart(distributionData, 40);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 6. Network Health Metrics
		if (stats.data && stats.data[0] && reciprocity.data && reciprocity.data[0]) {
			AnalysisFormatter.subsection("Network Health Indicators", 78);
			const s = stats.data[0];
			const r = reciprocity.data[0];
			const totalInteractions = (s.total_mentions || 0) + (s.total_replies || 0) + (s.total_reactions || 0);
			const replyRate = s.total_mentions && s.total_replies
				? ((s.total_replies / (s.total_mentions + s.total_replies)) * 100)
				: 0;
			const reciprocityRate = ((r.two_way / r.total_pairs) * 100);
			const avgConnections = s.total_edges && r.total_pairs ? (s.total_edges / r.total_pairs) : 0;

			AnalysisFormatter.metric(
				"Reply Engagement",
				replyRate.toFixed(1) + "%",
				replyRate > 60 ? "good" : replyRate > 40 ? "warning" : "bad"
			);
			AnalysisFormatter.metric(
				"Mutual Connections",
				reciprocityRate.toFixed(1) + "%",
				reciprocityRate > 30 ? "good" : reciprocityRate > 20 ? "warning" : "bad"
			);
			AnalysisFormatter.metric(
				"Avg Edges per Pair",
				avgConnections.toFixed(1),
				avgConnections > 1.3 ? "good" : "warning"
			);
			if (s.unique_users && s.unique_users > 0) {
				const networkDensity = (s.total_edges / ((s.unique_users * (s.unique_users - 1)) / 2)) * 100;
				AnalysisFormatter.metric(
					"Network Density",
					networkDensity.toFixed(2) + "%",
					networkDensity > 5 ? "good" : networkDensity > 2 ? "warning" : "bad"
				);
			}
			AnalysisFormatter.subsectionEnd(78);
		}

		// 7. Recent Activity (last 7 days)
		AnalysisFormatter.subsection("Recent Activity (Last 7 Days)", 78);
		const sevenDaysAgo = new Date();
		sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

		const recentActivity = await db.query(
			`SELECT
				COUNT(*) as active_edges,
				SUM(mentions + replies + reactions) as recent_interactions
			FROM relationship_edges
			WHERE guild_id = $1 AND last_interaction >= $2`,
			[guildId, sevenDaysAgo]
		);

		if (recentActivity.data && recentActivity.data[0]) {
			const ra = recentActivity.data[0];
			AnalysisFormatter.metric("Active Edges", AnalysisFormatter.formatNumber(ra.active_edges || 0));
			AnalysisFormatter.metric("Recent Interactions", AnalysisFormatter.formatNumber(ra.recent_interactions || 0));
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

analyzeRelationships();
