import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

async function diagnoseRelationshipTracking() {
	const db = new PostgreSQLManager();

	try {
		console.log("🔹 Connecting to database...");
		await db.connect();

		const guildId = process.argv[2] || process.env.GUILD_ID;
		if (!guildId) {
			console.error("🔸 Usage: npx tsx src/scripts/diagnose-relationship-tracking.ts <guild_id>");
			return;
		}

		console.log(`\n🔍 Diagnosing relationship tracking for guild ${guildId}...\n`);
		console.log("━".repeat(80));

		// 1. Check referenced_message_id population
		console.log("\n📋 PHASE 1: Referenced Message ID Population\n");

		const totalMessages = await db.query(
			"SELECT COUNT(*) as count FROM messages WHERE guild_id = $1 AND active = true",
			[guildId]
		);

		const messagesWithReferences = await db.query(
			"SELECT COUNT(*) as count FROM messages WHERE guild_id = $1 AND active = true AND referenced_message_id IS NOT NULL",
			[guildId]
		);

		const total = totalMessages.data?.[0]?.count || 0;
		const withRef = messagesWithReferences.data?.[0]?.count || 0;
		const percentage = total > 0 ? ((withRef / total) * 100).toFixed(2) : "0";

		console.log(`Total messages: ${total}`);
		console.log(`Messages with referenced_message_id: ${withRef}`);
		console.log(`Percentage: ${percentage}%`);

		if (percentage === "0.00") {
			console.log("\n⚠️  WARNING: NO messages have referenced_message_id set!");
			console.log("   This explains why there are 0 replies detected.");
			console.log("   Possible causes:");
			console.log("   - Messages synced before referenced_message_id was captured");
			console.log("   - Foreign key constraint removing references");
			console.log("   - Discord sync not capturing reply data");
		}

		// 2. Check specific channel interactions
		console.log("\n━".repeat(80));
		console.log("\n📋 PHASE 2: Channel 1287319376462348310 Analysis\n");

		const channelMessages = await db.query(
			`SELECT
				author_id,
				referenced_message_id,
				content,
				created_at
			FROM messages
			WHERE channel_id = $1 AND active = true
			ORDER BY created_at DESC
			LIMIT 50`,
			["1287319376462348310"]
		);

		if (channelMessages.data && channelMessages.data.length > 0) {
			console.log(`Found ${channelMessages.data.length} recent messages in this channel\n`);

			// Get unique authors
			const authors = new Map<string, number>();
			let repliesCount = 0;
			let mentionsCount = 0;

			for (const msg of channelMessages.data) {
				authors.set(msg.author_id, (authors.get(msg.author_id) || 0) + 1);
				if (msg.referenced_message_id) repliesCount++;

				// Count mentions
				const mentionPattern = /<@!?(\d+)>/g;
				const mentions = msg.content?.match(mentionPattern);
				if (mentions) mentionsCount += mentions.length;
			}

			console.log("Author distribution:");
			const sortedAuthors = Array.from(authors.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10);

			for (const [authorId, count] of sortedAuthors) {
				console.log(`  ${authorId}: ${count} messages`);
			}

			console.log(`\nInteraction counts in this channel:`);
			console.log(`  Replies: ${repliesCount}`);
			console.log(`  Mentions: ${mentionsCount}`);
		} else {
			console.log("⚠️  No messages found in this channel");
		}

		// 3. Find user IDs for specific users
		console.log("\n━".repeat(80));
		console.log("\n📋 PHASE 3: Finding User IDs\n");

		const users = await db.query(
			`SELECT user_id, username, global_name
			FROM members
			WHERE guild_id = $1
			  AND (username ILIKE '%Америка%' OR username ILIKE '%Evangelos%' OR global_name ILIKE '%Америка%' OR global_name ILIKE '%Evangelos%')`,
			[guildId]
		);

		if (users.data && users.data.length > 0) {
			console.log("Found users:");
			for (const user of users.data) {
				console.log(`  ${user.username} (${user.global_name || 'N/A'}): ${user.user_id}`);
			}

			// If we found both users, check their relationship edges
			if (users.data.length >= 2) {
				const user1Id = users.data[0].user_id;
				const user2Id = users.data[1].user_id;

				console.log("\n━".repeat(80));
				console.log("\n📋 PHASE 4: Relationship Edges Analysis\n");

				const edges = await db.query(
					`SELECT * FROM relationship_edges
					WHERE guild_id = $1
					  AND ((user_a = $2 AND user_b = $3) OR (user_a = $3 AND user_b = $2))`,
					[guildId, user1Id, user2Id]
				);

				if (edges.data && edges.data.length > 0) {
					console.log(`Found ${edges.data.length} edge(s):\n`);
					for (const edge of edges.data) {
						console.log(`Edge: ${edge.user_a} → ${edge.user_b}`);
						console.log(`  msg_a_to_b: ${edge.msg_a_to_b || 0}`);
						console.log(`  msg_b_to_a: ${edge.msg_b_to_a || 0}`);
						console.log(`  mentions: ${edge.mentions || 0}`);
						console.log(`  replies: ${edge.replies || 0}`);
						console.log(`  reactions: ${edge.reactions || 0}`);
						console.log(`  last_interaction: ${edge.last_interaction ? new Date(edge.last_interaction).toLocaleString() : 'N/A'}`);
						console.log();
					}
				} else {
					console.log("⚠️  No relationship edges found for this pair");
				}
			}
		} else {
			console.log("⚠️  Could not find users matching those names");
		}

		// 5. Check overall replies column in relationship_edges
		console.log("\n━".repeat(80));
		console.log("\n📋 PHASE 5: Overall Replies Column Analysis\n");

		const replyStats = await db.query(
			`SELECT
				COUNT(*) as total_edges,
				COUNT(CASE WHEN replies > 0 THEN 1 END) as edges_with_replies,
				SUM(replies) as total_replies,
				MAX(replies) as max_replies
			FROM relationship_edges
			WHERE guild_id = $1`,
			[guildId]
		);

		if (replyStats.data && replyStats.data.length > 0) {
			const stats = replyStats.data[0];
			console.log(`Total relationship edges: ${stats.total_edges}`);
			console.log(`Edges with replies > 0: ${stats.edges_with_replies}`);
			console.log(`Total replies across all edges: ${stats.total_replies || 0}`);
			console.log(`Maximum replies on single edge: ${stats.max_replies || 0}`);

			if (stats.total_replies === 0 || stats.total_replies === null) {
				console.log("\n🚨 CRITICAL: No replies stored in ANY relationship edge!");
				console.log("   This confirms the replies tracking is completely broken.");
			}
		}

		// 6. Sample some edges with mentions to verify they exist
		console.log("\n━".repeat(80));
		console.log("\n📋 PHASE 6: Sample Edges with Mentions\n");

		const sampleEdges = await db.query(
			`SELECT user_a, user_b, mentions, replies, msg_a_to_b, msg_b_to_a
			FROM relationship_edges
			WHERE guild_id = $1 AND mentions > 0
			ORDER BY mentions DESC
			LIMIT 5`,
			[guildId]
		);

		if (sampleEdges.data && sampleEdges.data.length > 0) {
			console.log("Top 5 edges by mentions:\n");
			for (const edge of sampleEdges.data) {
				console.log(`${edge.user_a} → ${edge.user_b}`);
				console.log(`  Mentions: ${edge.mentions}, Replies: ${edge.replies || 0}`);
				console.log(`  Messages: ${edge.msg_a_to_b || 0} → ${edge.msg_b_to_a || 0}`);
				console.log();
			}
		}

		console.log("━".repeat(80));
		console.log("\n✅ Diagnosis complete\n");

		await db.disconnect();
	} catch (error) {
		console.error("🔸 Error:", error);
	}
}

diagnoseRelationshipTracking();
