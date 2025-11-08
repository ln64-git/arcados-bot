import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { AnalysisFormatter } from "./utils/analysis-formatter.js";

async function analyzeUser() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		const guildId = process.argv[2] || process.env.GUILD_ID;
		const userId = process.argv[3];

		if (!guildId || !userId) {
			console.error("\n❌ Error: Guild ID and User ID required");
			console.error("Usage: npm run analyze:user <guild_id> <user_id>");
			console.error("   or: npm run analyze:user <guild_id> <username>\n");
			return;
		}

		// Try to find user by ID or username
		let user;
		const userQuery = await db.query(
			`
			SELECT user_id, username, global_name, display_name, bot, joined_at, created_at
			FROM members
			WHERE guild_id = $1 AND (user_id = $2 OR username ILIKE $3 OR global_name ILIKE $3)
			LIMIT 1
			`,
			[guildId, userId, `%${userId}%`]
		);

		if (!userQuery.data || userQuery.data.length === 0) {
			AnalysisFormatter.error(`User not found: ${userId}`);
			return;
		}

		user = userQuery.data[0];
		const actualUserId = user.user_id;
		const displayName = user.global_name || user.display_name || user.username || actualUserId;
		const isBot = user.bot || false;

		AnalysisFormatter.section(`USER ANALYSIS: ${displayName}`, 80);
		console.log(`   User ID: ${actualUserId}`);
		if (isBot) {
			console.log(`   Type: Bot`);
		}
		if (user.joined_at) {
			console.log(`   Joined: ${AnalysisFormatter.formatDateTime(user.joined_at)}`);
		}
		console.log();

		// 1. Message Statistics
		AnalysisFormatter.subsection("Message Statistics", 78);
		const messageStats = await db.query(
			`
			SELECT
				COUNT(*) as total_messages,
				COUNT(CASE WHEN referenced_message_id IS NOT NULL THEN 1 END) as replies,
				COUNT(CASE WHEN content LIKE '%<@%>%' THEN 1 END) as messages_with_mentions,
				COUNT(CASE WHEN LENGTH(content) > 100 THEN 1 END) as long_messages,
				AVG(LENGTH(content)) as avg_message_length,
				MIN(created_at) as first_message,
				MAX(created_at) as last_message,
				COUNT(DISTINCT channel_id) as channels_active_in
			FROM messages
			WHERE guild_id = $1 AND author_id = $2 AND active = true
			`,
			[guildId, actualUserId]
		);

		if (messageStats.data && messageStats.data[0]) {
			const s = messageStats.data[0];
			AnalysisFormatter.metric("Total Messages", AnalysisFormatter.formatNumber(s.total_messages));
			AnalysisFormatter.metric("Replies Sent", AnalysisFormatter.formatNumber(s.replies), undefined, ` (${AnalysisFormatter.formatPercent(s.replies, s.total_messages)})`);
			AnalysisFormatter.metric("Messages with Mentions", AnalysisFormatter.formatNumber(s.messages_with_mentions));
			AnalysisFormatter.metric("Long Messages (>100 chars)", AnalysisFormatter.formatNumber(s.long_messages));
			AnalysisFormatter.metric("Avg Message Length", parseFloat(s.avg_message_length || "0").toFixed(0), undefined, " chars");
			AnalysisFormatter.metric("Channels Active In", AnalysisFormatter.formatNumber(s.channels_active_in || 0));

			if (s.first_message && s.last_message) {
				const daysSinceFirst = (new Date(s.last_message).getTime() - new Date(s.first_message).getTime()) / (1000 * 60 * 60 * 24);
				const messagesPerDay = s.total_messages / daysSinceFirst;
				console.log("│");
				AnalysisFormatter.metric("First Message", AnalysisFormatter.formatDateTime(s.first_message));
				AnalysisFormatter.metric("Last Message", AnalysisFormatter.formatRelativeTime(s.last_message));
				AnalysisFormatter.metric("Account Age", daysSinceFirst.toFixed(0), undefined, " days");
				AnalysisFormatter.metric("Messages per Day", messagesPerDay.toFixed(1));
			}
		}
		AnalysisFormatter.subsectionEnd(78);

		// 2. Top Channels
		AnalysisFormatter.subsection("Top 10 Channels by Activity", 78);
		const topChannels = await db.query(
			`
			SELECT
				c.name as channel_name,
				m.channel_id,
				COUNT(*) as message_count,
				MAX(m.created_at) as last_activity
			FROM messages m
			LEFT JOIN channels c ON c.id = m.channel_id
			WHERE m.guild_id = $1 AND m.author_id = $2 AND m.active = true
			GROUP BY m.channel_id, c.name
			ORDER BY message_count DESC
			LIMIT 10
			`,
			[guildId, actualUserId]
		);

		if (topChannels.data && topChannels.data.length > 0) {
			const columns = [
				{ header: "Rank", width: 5, align: "right" as const },
				{ header: "Channel", width: 30, align: "left" as const },
				{ header: "Messages", width: 12, align: "right" as const },
				{ header: "Last Activity", width: 15, align: "left" as const },
			];

			const rows = topChannels.data.map((channel, i) => {
				const name = (channel.channel_name || channel.channel_id).substring(0, 29);
				return [
					i + 1,
					name,
					AnalysisFormatter.formatNumber(channel.message_count),
					AnalysisFormatter.formatRelativeTime(channel.last_activity),
				];
			});

			AnalysisFormatter.table(columns, rows);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 3. Relationship Analysis - Outgoing
		AnalysisFormatter.subsection("Top 10 People This User Interacts With", 78);
		const outgoingRelationships = await db.query(
			`
			SELECT
				re.user_b as other_user_id,
				m.username,
				m.global_name,
				m.display_name,
				re.mentions,
				re.replies,
				re.reactions,
				(re.mentions + re.replies + re.reactions) as total_interactions,
				re.last_interaction
			FROM relationship_edges re
			LEFT JOIN members m ON m.user_id = re.user_b AND m.guild_id = $1
			WHERE re.guild_id = $1 AND re.user_a = $2
			ORDER BY total_interactions DESC
			LIMIT 10
			`,
			[guildId, actualUserId]
		);

		if (outgoingRelationships.data && outgoingRelationships.data.length > 0) {
			const columns = [
				{ header: "Rank", width: 5, align: "right" as const },
				{ header: "User", width: 25, align: "left" as const },
				{ header: "Mentions", width: 10, align: "right" as const },
				{ header: "Replies", width: 10, align: "right" as const },
				{ header: "Reactions", width: 10, align: "right" as const },
				{ header: "Total", width: 10, align: "right" as const },
			];

			const rows = outgoingRelationships.data.map((rel, i) => {
				const name = (rel.global_name || rel.display_name || rel.username || rel.other_user_id).substring(0, 24);
				return [
					i + 1,
					name,
					AnalysisFormatter.formatNumber(rel.mentions || 0),
					AnalysisFormatter.formatNumber(rel.replies || 0),
					AnalysisFormatter.formatNumber(rel.reactions || 0),
					AnalysisFormatter.formatNumber(rel.total_interactions),
				];
			});

			AnalysisFormatter.table(columns, rows);
		} else {
			console.log("│  No outgoing interactions found");
		}
		AnalysisFormatter.subsectionEnd(78);

		// 4. Relationship Analysis - Incoming
		AnalysisFormatter.subsection("Top 10 People Who Interact With This User", 78);
		const incomingRelationships = await db.query(
			`
			SELECT
				re.user_a as other_user_id,
				m.username,
				m.global_name,
				m.display_name,
				re.mentions,
				re.replies,
				re.reactions,
				(re.mentions + re.replies + re.reactions) as total_interactions,
				re.last_interaction
			FROM relationship_edges re
			LEFT JOIN members m ON m.user_id = re.user_a AND m.guild_id = $1
			WHERE re.guild_id = $1 AND re.user_b = $2
			ORDER BY total_interactions DESC
			LIMIT 10
			`,
			[guildId, actualUserId]
		);

		if (incomingRelationships.data && incomingRelationships.data.length > 0) {
			const columns = [
				{ header: "Rank", width: 5, align: "right" as const },
				{ header: "User", width: 25, align: "left" as const },
				{ header: "Mentions", width: 10, align: "right" as const },
				{ header: "Replies", width: 10, align: "right" as const },
				{ header: "Reactions", width: 10, align: "right" as const },
				{ header: "Total", width: 10, align: "right" as const },
			];

			const rows = incomingRelationships.data.map((rel, i) => {
				const name = (rel.global_name || rel.display_name || rel.username || rel.other_user_id).substring(0, 24);
				return [
					i + 1,
					name,
					AnalysisFormatter.formatNumber(rel.mentions || 0),
					AnalysisFormatter.formatNumber(rel.replies || 0),
					AnalysisFormatter.formatNumber(rel.reactions || 0),
					AnalysisFormatter.formatNumber(rel.total_interactions),
				];
			});

			AnalysisFormatter.table(columns, rows);
		} else {
			console.log("│  No incoming interactions found");
		}
		AnalysisFormatter.subsectionEnd(78);

		// 5. Conversation Participation
		AnalysisFormatter.subsection("Conversation Participation", 78);
		const conversationStats = await db.query(
			`
			SELECT
				COUNT(*) as total_conversations,
				AVG(message_count) as avg_messages_per_conversation,
				MAX(message_count) as max_messages_in_conversation,
				SUM(message_count) as total_messages_in_conversations
			FROM conversation_segments
			WHERE guild_id = $1 AND $2 = ANY(participants)
			`,
			[guildId, actualUserId]
		);

		if (conversationStats.data && conversationStats.data[0]) {
			const s = conversationStats.data[0];
			AnalysisFormatter.metric("Total Conversations", AnalysisFormatter.formatNumber(s.total_conversations));
			AnalysisFormatter.metric("Avg Messages/Conversation", parseFloat(s.avg_messages_per_conversation || "0").toFixed(1));
			AnalysisFormatter.metric("Max Messages in Single Conversation", AnalysisFormatter.formatNumber(s.max_messages_in_conversation || 0));
			AnalysisFormatter.metric("Total Messages in Conversations", AnalysisFormatter.formatNumber(s.total_messages_in_conversations || 0));
		}
		AnalysisFormatter.subsectionEnd(78);

		// 6. Activity by Hour
		AnalysisFormatter.subsection("Activity by Hour of Day", 78);
		const hourlyActivity = await db.query(
			`
			SELECT
				EXTRACT(HOUR FROM created_at) as hour,
				COUNT(*) as message_count
			FROM messages
			WHERE guild_id = $1 AND author_id = $2 AND active = true
			GROUP BY hour
			ORDER BY hour
			`,
			[guildId, actualUserId]
		);

		if (hourlyActivity.data && hourlyActivity.data.length > 0) {
			const maxCount = Math.max(...hourlyActivity.data.map((h: any) => parseInt(h.message_count)));
			const buckets = hourlyActivity.data.map((hour: any) => ({
				label: `${String(hour.hour).padStart(2, "0")}:00`,
				count: parseInt(hour.message_count),
				percentage: 0, // Not needed for this display
			}));
			AnalysisFormatter.distributionChart(buckets, 40);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 7. Activity by Day of Week
		AnalysisFormatter.subsection("Activity by Day of Week", 78);
		const dayActivity = await db.query(
			`
			SELECT
				EXTRACT(DOW FROM created_at) as day_of_week,
				TO_CHAR(created_at, 'Day') as day_name,
				COUNT(*) as message_count
			FROM messages
			WHERE guild_id = $1 AND author_id = $2 AND active = true
			GROUP BY day_of_week, day_name
			ORDER BY day_of_week
			`,
			[guildId, actualUserId]
		);

		if (dayActivity.data && dayActivity.data.length > 0) {
			const maxCount = Math.max(...dayActivity.data.map((d: any) => parseInt(d.message_count)));
			const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
			const buckets = dayActivity.data.map((day: any) => ({
				label: dayNames[parseInt(day.day_of_week)].substring(0, 9),
				count: parseInt(day.message_count),
				percentage: 0,
			}));
			AnalysisFormatter.distributionChart(buckets, 40);
		}
		AnalysisFormatter.subsectionEnd(78);

		// 8. Recent Activity
		AnalysisFormatter.subsection("Recent Messages (Last 5)", 78);
		const recentMessages = await db.query(
			`
			SELECT
				m.content,
				m.created_at,
				c.name as channel_name,
				m.referenced_message_id
			FROM messages m
			LEFT JOIN channels c ON c.id = m.channel_id
			WHERE m.guild_id = $1 AND m.author_id = $2 AND m.active = true
			ORDER BY m.created_at DESC
			LIMIT 5
			`,
			[guildId, actualUserId]
		);

		if (recentMessages.data && recentMessages.data.length > 0) {
			for (let i = 0; i < recentMessages.data.length; i++) {
				const msg = recentMessages.data[i];
				const content = msg.content.substring(0, 100) + (msg.content.length > 100 ? "..." : "");
				const isReply = msg.referenced_message_id ? " [REPLY]" : "";
				const time = AnalysisFormatter.formatRelativeTime(msg.created_at);
				console.log(`│  ${i + 1}. [${time}] #${msg.channel_name || "unknown"}${isReply}`);
				console.log(`│     "${content}"`);
				console.log("│");
			}
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

analyzeUser();
