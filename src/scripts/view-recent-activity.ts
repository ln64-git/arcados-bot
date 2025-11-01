import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

interface ConversationSegment {
	id: string;
	guild_id: string;
	channel_id: string;
	channel_name?: string;
	participants: string[];
	participant_names?: string[];
	start_time: Date;
	end_time: Date;
	message_count: number;
	summary?: string;
}

interface RelationshipEdge {
	user_a: string;
	user_b: string;
	user_a_name?: string;
	user_b_name?: string;
	msg_a_to_b: number;
	msg_b_to_a: number;
	mentions: number;
	replies: number;
	reactions: number;
	total: number;
	last_interaction: Date;
}

async function viewRecentActivity() {
	const db = new PostgreSQLManager();

	try {
		console.log("🔹 Connecting to database...");
		const connected = await db.connect();
		if (!connected) {
			console.error("🔸 Failed to connect");
			return;
		}

		console.log("✅ Connected\n");

		const guildId = process.argv[2] || process.env.GUILD_ID;

		if (!guildId) {
			console.error("🔸 Usage: npm run view:recent <guild_id>");
			console.error("   Or set GUILD_ID in .env");
			return;
		}

		const twentyFourHoursAgo = new Date();
		twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log(`  Recent Activity (Last 24 Hours) - Guild: ${guildId}`);
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

		// Get conversation segments from last 24 hours
		console.log("💬 Recent Conversation Segments:\n");
		const segmentsResult = await db.query(
			`SELECT 
				cs.id,
				cs.guild_id,
				cs.channel_id,
				c.name as channel_name,
				cs.participants,
				cs.start_time,
				cs.end_time,
				cs.message_count,
				cs.summary
			FROM conversation_segments cs
			LEFT JOIN channels c ON c.id = cs.channel_id
			WHERE cs.guild_id = $1
				AND cs.start_time >= $2
			ORDER BY cs.start_time DESC
			LIMIT 50`,
			[guildId, twentyFourHoursAgo]
		);

		if (!segmentsResult.success || !segmentsResult.data) {
			console.error("🔸 Failed to fetch segments:", segmentsResult.error);
			return;
		}

		const segments = segmentsResult.data as ConversationSegment[];

		// Get participant names
		const allUserIds = new Set<string>();
		segments.forEach((seg) => {
			seg.participants.forEach((uid) => allUserIds.add(uid));
		});

		const userIds = Array.from(allUserIds);
		const nameMap = new Map<string, string>();

		if (userIds.length > 0) {
			const namesResult = await db.query(
				`SELECT user_id, display_name, username
				FROM members
				WHERE guild_id = $1 AND user_id = ANY($2::TEXT[]) AND active = true`,
				[guildId, userIds]
			);

			if (namesResult.success && namesResult.data) {
				for (const row of namesResult.data) {
					const displayName = row.display_name || row.username || row.user_id;
					nameMap.set(row.user_id, displayName);
				}
			}
		}

		if (segments.length === 0) {
			console.log("   No conversation segments in the last 24 hours\n");
		} else {
			for (const segment of segments) {
				// Deduplicate participants for display
				const uniqueParticipants = Array.from(
					new Set(
						Array.isArray(segment.participants)
							? segment.participants
							: []
					)
				);
				const participantNames = uniqueParticipants
					.map((uid) => nameMap.get(uid) || uid)
					.join(", ");

				const duration =
					(new Date(segment.end_time).getTime() -
						new Date(segment.start_time).getTime()) /
					1000 /
					60;

				console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
				console.log(`📍 ${segment.channel_name || segment.channel_id}`);
				console.log(`   Participants: ${participantNames}`);
				console.log(
					`   ${segment.message_count} messages • ${duration.toFixed(1)} minutes`
				);
				console.log(
					`   ${new Date(segment.start_time).toLocaleString()} → ${new Date(segment.end_time).toLocaleString()}`
				);
				console.log();

				// Fetch and display actual messages
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
					ORDER BY m.created_at ASC`,
					[segment.id]
				);

				if (messagesResult.success && messagesResult.data) {
					const messages = messagesResult.data;
					console.log(`   Conversation:`);
					for (const msg of messages) {
						const authorName = msg.display_name || msg.username || msg.author_id;
						const timestamp = new Date(msg.created_at).toLocaleTimeString();
						const content = msg.content || "(no content)";
						const isReply = msg.referenced_message_id ? "↪️ " : "";

						// Truncate long messages
						const displayContent =
							content.length > 200
								? content.substring(0, 200) + "..."
								: content;

						console.log(`   ${timestamp} ${isReply}@${authorName}: ${displayContent}`);
					}
				} else {
					console.log(`   (Unable to fetch messages)`);
				}

				if (segment.summary) {
					console.log(`\n   Summary: ${segment.summary}`);
				}
				console.log();
			}
		}

		// Get recent relationship edges (updated in last 24 hours)
		console.log("🔗 Recent Relationship Activity:\n");
		const edgesResult = await db.query(
			`SELECT 
				re.user_a,
				re.user_b,
				re.msg_a_to_b,
				re.msg_b_to_a,
				re.mentions,
				re.replies,
				re.reactions,
				re.total,
				re.last_interaction
			FROM relationship_edges re
			WHERE re.guild_id = $1
				AND re.last_interaction >= $2
			ORDER BY re.last_interaction DESC
			LIMIT 100`,
			[guildId, twentyFourHoursAgo]
		);

		if (!edgesResult.success || !edgesResult.data) {
			console.error("🔸 Failed to fetch edges:", edgesResult.error);
			return;
		}

		const edges = edgesResult.data as RelationshipEdge[];

		// Get names for all users in edges
		const edgeUserIds = new Set<string>();
		edges.forEach((edge) => {
			edgeUserIds.add(edge.user_a);
			edgeUserIds.add(edge.user_b);
		});

		const edgeUserIdsArray = Array.from(edgeUserIds);
		if (edgeUserIdsArray.length > 0) {
			const edgeNamesResult = await db.query(
				`SELECT user_id, display_name, username
				FROM members
				WHERE guild_id = $1 AND user_id = ANY($2::TEXT[]) AND active = true`,
				[guildId, edgeUserIdsArray]
			);

			if (edgeNamesResult.success && edgeNamesResult.data) {
				for (const row of edgeNamesResult.data) {
					const displayName = row.display_name || row.username || row.user_id;
					nameMap.set(row.user_id, displayName);
				}
			}
		}

		// Group edges by pair and sum interactions
		const pairMap = new Map<
			string,
			{
				userA: string;
				userB: string;
				total: number;
				mentions: number;
				replies: number;
				reactions: number;
				lastInteraction: Date;
			}
		>();

		for (const edge of edges) {
			const [uMin, uMax] =
				edge.user_a < edge.user_b
					? [edge.user_a, edge.user_b]
					: [edge.user_b, edge.user_a];
			const key = `${uMin}:${uMax}`;

			if (!pairMap.has(key)) {
				pairMap.set(key, {
					userA: uMin,
					userB: uMax,
					total: 0,
					mentions: 0,
					replies: 0,
					reactions: 0,
					lastInteraction: new Date(0),
				});
			}

			const pair = pairMap.get(key)!;
			pair.total += edge.total || 0;
			pair.mentions += edge.mentions || 0;
			pair.replies += edge.replies || 0;
			pair.reactions += edge.reactions || 0;

			const edgeTime = new Date(edge.last_interaction);
			if (edgeTime > pair.lastInteraction) {
				pair.lastInteraction = edgeTime;
			}
		}

		const pairs = Array.from(pairMap.values()).sort(
			(a, b) => b.total - a.total
		);

		if (pairs.length === 0) {
			console.log("   No relationship activity in the last 24 hours\n");
		} else {
			console.log(`   Top ${Math.min(20, pairs.length)} most active pairs:\n`);
			for (const pair of pairs.slice(0, 20)) {
				const userAName = nameMap.get(pair.userA) || pair.userA;
				const userBName = nameMap.get(pair.userB) || pair.userB;

				console.log(`   ${userAName} ↔ ${userBName}`);
				console.log(`      Total: ${pair.total} | Mentions: ${pair.mentions} | Replies: ${pair.replies} | Reactions: ${pair.reactions}`);
				console.log(
					`      Last: ${pair.lastInteraction.toLocaleString()}`
				);
				console.log();
			}
		}

		// Summary statistics
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log("📊 Summary (Last 24 Hours):");
		console.log(`   💬 Conversation segments: ${segments.length}`);
		console.log(`   🔗 Active relationship pairs: ${pairs.length}`);
		const totalInteractions = pairs.reduce((sum, p) => sum + p.total, 0);
		console.log(`   📈 Total interactions: ${totalInteractions}`);
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

viewRecentActivity();
