#!/usr/bin/env bun
/**
 * Conversation Grouping Analysis Script
 *
 * Provides detailed analysis of how messages are grouped into conversations
 * and why certain messages remain unmapped. Useful for fine-tuning the
 * conversation detection algorithm.
 */

import { PostgreSQLManager } from "../../../../database/PostgreSQLManager";
import { config } from "../../../../config/index.js";

interface Message {
	id: string;
	content: string;
	author_id: string;
	username: string;
	channel_id: string;
	channel_name: string;
	created_at: Date;
	referenced_message_id: string | null;
	conversation_id: string | null;
	is_streaming: boolean;
}

interface ConversationAnalysis {
	id: string;
	type: "streaming" | "finalized";
	channel_name: string;
	participant_count: number;
	message_count: number;
	start_time: Date;
	end_time: Date;
	duration_minutes: number;
	has_replies: boolean;
	has_mentions: boolean;
	avg_message_gap_seconds: number;
	max_message_gap_seconds: number;
	participants: string[];
	message_ids: string[];
}

interface TimeGap {
	after_message_id: string;
	after_content: string;
	after_author: string;
	after_time: Date;
	before_message_id: string;
	before_content: string;
	before_author: string;
	before_time: Date;
	gap_seconds: number;
	gap_minutes: number;
	same_author: boolean;
}

const db = new PostgreSQLManager();

async function main() {
	const args = process.argv.slice(2);
	const hoursBack = args[0] ? Number.parseInt(args[0], 10) : 24;
	const verbose = args.includes("--verbose") || args.includes("-v");

	console.log("🔬 Conversation Grouping Analysis");
	console.log("=".repeat(80));
	console.log(`Time window: Past ${hoursBack} hours`);
	console.log(`Verbose mode: ${verbose ? "ON" : "OFF"}`);
	console.log("=".repeat(80));

	const connected = await db.connect();
	if (!connected) {
		console.error("❌ Failed to connect to database");
		process.exit(1);
	}

	const guildId = config.guildId;
	if (!guildId) {
		console.error("❌ No guild ID configured");
		await db.disconnect();
		process.exit(1);
	}

	// Fetch all messages with conversation mappings
	const messagesResult = await db.query(
		`
    WITH message_conversations AS (
      SELECT
        m.id,
        sc.id as conversation_id,
        true as is_streaming
      FROM messages m
      JOIN streaming_conversations sc ON sc.guild_id = m.guild_id
      WHERE m.id = ANY(sc.message_ids)
        AND m.guild_id = $1
        AND m.created_at > NOW() - INTERVAL '${hoursBack} hours'

      UNION ALL

      SELECT
        m.id,
        cs.id as conversation_id,
        false as is_streaming
      FROM messages m
      JOIN conversation_segments cs ON cs.guild_id = m.guild_id
      WHERE m.id = ANY(cs.message_ids)
        AND m.guild_id = $1
        AND m.created_at > NOW() - INTERVAL '${hoursBack} hours'
    )
    SELECT
      m.id,
      m.content,
      m.author_id,
      m.referenced_message_id,
      COALESCE(mem.username, m.author_id) as username,
      m.channel_id,
      COALESCE(c.name, m.channel_id) as channel_name,
      m.created_at,
      mc.conversation_id,
      COALESCE(mc.is_streaming, false) as is_streaming
    FROM messages m
    LEFT JOIN message_conversations mc ON m.id = mc.id
    LEFT JOIN channels c ON m.channel_id = c.id
    LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
    WHERE m.guild_id = $1
      AND m.created_at > NOW() - INTERVAL '${hoursBack} hours'
      AND m.active = true
      AND COALESCE(mem.bot, false) = false
      AND COALESCE(c.name, '') NOT IN ('vc-logs', 'mod-logs', 'server-logs', 'audit-logs')
    ORDER BY m.created_at ASC
    `,
		[guildId]
	);

	// Fetch conversation details
	const conversationsResult = await db.query(
		`
    SELECT
      sc.id,
      'streaming' as type,
      COALESCE(c.name, sc.channel_id) as channel_name,
      sc.participants,
      sc.message_ids,
      sc.message_count,
      sc.start_time,
      sc.last_activity as end_time
    FROM streaming_conversations sc
    LEFT JOIN channels c ON sc.channel_id = c.id
    WHERE sc.guild_id = $1
      AND sc.start_time > NOW() - INTERVAL '${hoursBack} hours'

    UNION ALL

    SELECT
      cs.id,
      'finalized' as type,
      COALESCE(c.name, cs.channel_id) as channel_name,
      cs.participants,
      cs.message_ids,
      cs.message_count,
      cs.start_time,
      cs.end_time
    FROM conversation_segments cs
    LEFT JOIN channels c ON cs.channel_id = c.id
    WHERE cs.guild_id = $1
      AND cs.start_time > NOW() - INTERVAL '${hoursBack} hours'

    ORDER BY start_time ASC
    `,
		[guildId]
	);

	if (!messagesResult.success || !conversationsResult.success) {
		console.error("❌ Failed to fetch data");
		await db.disconnect();
		process.exit(1);
	}

	const messages: Message[] = messagesResult.data || [];
	const conversations: ConversationAnalysis[] =
		(conversationsResult.data || []).map((row: any) => ({
			id: row.id,
			type: row.type,
			channel_name: row.channel_name,
			participant_count: Array.isArray(row.participants)
				? row.participants.length
				: 0,
			message_count: row.message_count,
			start_time: new Date(row.start_time),
			end_time: new Date(row.end_time),
			duration_minutes: Math.round(
				(new Date(row.end_time).getTime() -
					new Date(row.start_time).getTime()) /
					(1000 * 60)
			),
			participants: row.participants || [],
			message_ids: row.message_ids || [],
			has_replies: false,
			has_mentions: false,
			avg_message_gap_seconds: 0,
			max_message_gap_seconds: 0,
		})) || [];

	const mappedMessages = messages.filter((m) => m.conversation_id);
	const unmappedMessages = messages.filter((m) => !m.conversation_id);

	// Calculate detailed conversation metrics
	for (const conv of conversations) {
		const convMessages = messages.filter((m) =>
			conv.message_ids.includes(m.id)
		);

		// Check for replies and mentions
		conv.has_replies = convMessages.some((m) => m.referenced_message_id);
		conv.has_mentions = convMessages.some((m) =>
			m.content.includes("@")
		);

		// Calculate message gaps
		if (convMessages.length > 1) {
			const sortedMsgs = [...convMessages].sort(
				(a, b) => a.created_at.getTime() - b.created_at.getTime()
			);
			const gaps: number[] = [];
			for (let i = 1; i < sortedMsgs.length; i++) {
				const gap =
					(sortedMsgs[i]!.created_at.getTime() -
						sortedMsgs[i - 1]!.created_at.getTime()) /
					1000;
				gaps.push(gap);
			}
			conv.avg_message_gap_seconds =
				gaps.reduce((a, b) => a + b, 0) / gaps.length;
			conv.max_message_gap_seconds = Math.max(...gaps);
		}
	}

	// === SECTION 1: OVERVIEW ===
	console.log("\n📊 OVERVIEW");
	console.log("=".repeat(80));
	console.log(`Total Messages: ${messages.length}`);
	console.log(`  ✓ Mapped to conversations: ${mappedMessages.length}`);
	console.log(`  ✗ Unmapped: ${unmappedMessages.length}`);
	console.log(
		`  Coverage: ${((mappedMessages.length / messages.length) * 100).toFixed(1)}%`
	);
	console.log(`\nTotal Conversations: ${conversations.length}`);
	console.log(
		`  - Streaming (active): ${conversations.filter((c) => c.type === "streaming").length}`
	);
	console.log(
		`  - Finalized: ${conversations.filter((c) => c.type === "finalized").length}`
	);

	// === SECTION 2: CONVERSATION METRICS ===
	console.log("\n\n📈 CONVERSATION METRICS");
	console.log("=".repeat(80));

	if (conversations.length > 0) {
		const durations = conversations.map((c) => c.duration_minutes);
		const messageCounts = conversations.map((c) => c.message_count);
		const participantCounts = conversations.map((c) => c.participant_count);
		const avgGaps = conversations.map((c) => c.avg_message_gap_seconds);
		const maxGaps = conversations.map((c) => c.max_message_gap_seconds);

		console.log("\nDuration (minutes):");
		console.log(
			`  Average: ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)}`
		);
		console.log(`  Min: ${Math.min(...durations)}`);
		console.log(`  Max: ${Math.max(...durations)}`);
		console.log(
			`  Median: ${durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)]}`
		);

		console.log("\nMessages per Conversation:");
		console.log(
			`  Average: ${(messageCounts.reduce((a, b) => a + b, 0) / messageCounts.length).toFixed(1)}`
		);
		console.log(`  Min: ${Math.min(...messageCounts)}`);
		console.log(`  Max: ${Math.max(...messageCounts)}`);

		console.log("\nParticipants per Conversation:");
		console.log(
			`  Average: ${(participantCounts.reduce((a, b) => a + b, 0) / participantCounts.length).toFixed(1)}`
		);
		console.log(`  Min: ${Math.min(...participantCounts)}`);
		console.log(`  Max: ${Math.max(...participantCounts)}`);

		console.log("\nMessage Gaps (seconds):");
		console.log(
			`  Average gap: ${(avgGaps.reduce((a, b) => a + b, 0) / avgGaps.length).toFixed(0)}s (${((avgGaps.reduce((a, b) => a + b, 0) / avgGaps.length) / 60).toFixed(1)} min)`
		);
		console.log(
			`  Largest gap: ${Math.max(...maxGaps).toFixed(0)}s (${(Math.max(...maxGaps) / 60).toFixed(1)} min)`
		);

		console.log("\nConversation Features:");
		const withReplies = conversations.filter((c) => c.has_replies).length;
		const withMentions = conversations.filter((c) => c.has_mentions).length;
		console.log(
			`  With replies: ${withReplies}/${conversations.length} (${((withReplies / conversations.length) * 100).toFixed(0)}%)`
		);
		console.log(
			`  With mentions: ${withMentions}/${conversations.length} (${((withMentions / conversations.length) * 100).toFixed(0)}%)`
		);
	}

	// === SECTION 3: UNMAPPED MESSAGE ANALYSIS ===
	console.log("\n\n🔍 UNMAPPED MESSAGE ANALYSIS");
	console.log("=".repeat(80));

	if (unmappedMessages.length > 0) {
		// Group by channel
		const byChannel = new Map<string, Message[]>();
		for (const msg of unmappedMessages) {
			const msgs = byChannel.get(msg.channel_name) || [];
			msgs.push(msg);
			byChannel.set(msg.channel_name, msgs);
		}

		console.log(`\nUnmapped messages by channel:`);
		const sortedChannels = Array.from(byChannel.entries()).sort(
			(a, b) => b[1].length - a[1].length
		);
		for (const [channel, msgs] of sortedChannels) {
			console.log(`  #${channel}: ${msgs.length} messages`);
		}

		// Analyze why messages might be unmapped
		const hasReplies = unmappedMessages.filter(
			(m) => m.referenced_message_id
		).length;
		const hasMentions = unmappedMessages.filter((m) =>
			m.content.includes("@")
		).length;
		const isShort = unmappedMessages.filter(
			(m) => m.content.trim().length < 10
		).length;
		const isVeryShort = unmappedMessages.filter(
			(m) => m.content.trim().length < 3
		).length;

		console.log(`\nUnmapped message characteristics:`);
		console.log(
			`  With replies: ${hasReplies} (${((hasReplies / unmappedMessages.length) * 100).toFixed(0)}%)`
		);
		console.log(
			`  With mentions: ${hasMentions} (${((hasMentions / unmappedMessages.length) * 100).toFixed(0)}%)`
		);
		console.log(
			`  Short (<10 chars): ${isShort} (${((isShort / unmappedMessages.length) * 100).toFixed(0)}%)`
		);
		console.log(
			`  Very short (<3 chars): ${isVeryShort} (${((isVeryShort / unmappedMessages.length) * 100).toFixed(0)}%)`
		);

		// Find time gaps between unmapped messages
		if (verbose && unmappedMessages.length > 1) {
			console.log(`\n\nTime gaps between consecutive unmapped messages:`);
			const sortedUnmapped = [...unmappedMessages].sort(
				(a, b) => a.created_at.getTime() - b.created_at.getTime()
			);

			const gaps: TimeGap[] = [];
			for (let i = 1; i < sortedUnmapped.length; i++) {
				const prev = sortedUnmapped[i - 1]!;
				const curr = sortedUnmapped[i]!;
				const gapMs =
					curr.created_at.getTime() - prev.created_at.getTime();
				const gapSeconds = gapMs / 1000;

				if (gapSeconds < 600) {
					// Only show gaps < 10 minutes
					gaps.push({
						after_message_id: prev.id,
						after_content: prev.content.substring(0, 50),
						after_author: prev.username,
						after_time: prev.created_at,
						before_message_id: curr.id,
						before_content: curr.content.substring(0, 50),
						before_author: curr.username,
						before_time: curr.created_at,
						gap_seconds: gapSeconds,
						gap_minutes: gapSeconds / 60,
						same_author: prev.author_id === curr.author_id,
					});
				}
			}

			if (gaps.length > 0) {
				console.log(`\n  Found ${gaps.length} gaps < 10 minutes:\n`);
				for (const gap of gaps.slice(0, 20)) {
					// Show first 20
					console.log(
						`  ${gap.after_time.toLocaleTimeString()} @${gap.after_author}`
					);
					console.log(`    "${gap.after_content}"`);
					console.log(
						`  ⏱  ${gap.gap_minutes.toFixed(1)} min gap ${gap.same_author ? "(same author)" : "(different author)"}`
					);
					console.log(
						`  ${gap.before_time.toLocaleTimeString()} @${gap.before_author}`
					);
					console.log(`    "${gap.before_content}"`);
					console.log();
				}
				if (gaps.length > 20) {
					console.log(`  ... and ${gaps.length - 20} more gaps`);
				}
			}
		}
	}

	// === SECTION 4: CONVERSATION SPLITTING ANALYSIS ===
	console.log("\n\n✂️  CONVERSATION SPLITTING ANALYSIS");
	console.log("=".repeat(80));

	// Find conversations that are close together in time
	const convPairs: Array<{
		conv1: ConversationAnalysis;
		conv2: ConversationAnalysis;
		gap_minutes: number;
		same_channel: boolean;
		shared_participants: number;
	}> = [];

	for (let i = 0; i < conversations.length - 1; i++) {
		const conv1 = conversations[i]!;
		const conv2 = conversations[i + 1]!;

		const gapMs = conv2.start_time.getTime() - conv1.end_time.getTime();
		const gapMinutes = gapMs / (1000 * 60);

		if (gapMinutes < 30 && gapMinutes >= 0) {
			// Conversations within 30 minutes
			const participants1 = new Set(conv1.participants);
			const participants2 = new Set(conv2.participants);
			const sharedParticipants = Array.from(participants1).filter((p) =>
				participants2.has(p)
			).length;

			convPairs.push({
				conv1,
				conv2,
				gap_minutes: gapMinutes,
				same_channel: conv1.channel_name === conv2.channel_name,
				shared_participants: sharedParticipants,
			});
		}
	}

	if (convPairs.length > 0) {
		console.log(
			`\nFound ${convPairs.length} conversation pairs within 30 minutes:\n`
		);

		const potentialMerges = convPairs.filter(
			(p) =>
				p.gap_minutes < 10 &&
				p.same_channel &&
				p.shared_participants > 0
		);
		console.log(
			`  Potential merge candidates (< 10 min gap, same channel, shared participants): ${potentialMerges.length}\n`
		);

		for (const pair of convPairs.slice(0, 15)) {
			console.log(
				`  Conv ${conversations.indexOf(pair.conv1) + 1} → Conv ${conversations.indexOf(pair.conv2) + 1}`
			);
			console.log(
				`    Gap: ${pair.gap_minutes.toFixed(1)} min | Same channel: ${pair.same_channel ? "✓" : "✗"} | Shared participants: ${pair.shared_participants}`
			);
			console.log(`    Conv 1: #${pair.conv1.channel_name}`);
			console.log(
				`      ${pair.conv1.end_time.toLocaleTimeString()} | ${pair.conv1.message_count} msgs | ${pair.conv1.participant_count} users`
			);
			console.log(`    Conv 2: #${pair.conv2.channel_name}`);
			console.log(
				`      ${pair.conv2.start_time.toLocaleTimeString()} | ${pair.conv2.message_count} msgs | ${pair.conv2.participant_count} users`
			);
			console.log();
		}

		if (convPairs.length > 15) {
			console.log(`  ... and ${convPairs.length - 15} more pairs`);
		}
	} else {
		console.log("\nNo conversations found within 30 minutes of each other");
	}

	// === SECTION 5: CHANNEL BREAKDOWN ===
	console.log("\n\n📺 CHANNEL BREAKDOWN");
	console.log("=".repeat(80));

	const channelStats = new Map<
		string,
		{
			total_messages: number;
			mapped_messages: number;
			conversations: number;
			avg_conv_size: number;
		}
	>();

	for (const msg of messages) {
		const stats = channelStats.get(msg.channel_name) || {
			total_messages: 0,
			mapped_messages: 0,
			conversations: 0,
			avg_conv_size: 0,
		};
		stats.total_messages++;
		if (msg.conversation_id) stats.mapped_messages++;
		channelStats.set(msg.channel_name, stats);
	}

	for (const conv of conversations) {
		const stats = channelStats.get(conv.channel_name);
		if (stats) {
			stats.conversations++;
		}
	}

	for (const [channel, stats] of channelStats.entries()) {
		if (stats.conversations > 0) {
			stats.avg_conv_size = stats.mapped_messages / stats.conversations;
		}
	}

	console.log("\nChannel statistics:");
	const sortedStats = Array.from(channelStats.entries()).sort(
		(a, b) => b[1].total_messages - a[1].total_messages
	);

	for (const [channel, stats] of sortedStats) {
		const coverage = (
			(stats.mapped_messages / stats.total_messages) *
			100
		).toFixed(0);
		console.log(`\n  #${channel}:`);
		console.log(
			`    Messages: ${stats.total_messages} (${stats.mapped_messages} mapped, ${coverage}%)`
		);
		console.log(`    Conversations: ${stats.conversations}`);
		if (stats.conversations > 0) {
			console.log(
				`    Avg conversation size: ${stats.avg_conv_size.toFixed(1)} messages`
			);
		}
	}

	// === SECTION 6: RECOMMENDATIONS ===
	console.log("\n\n💡 TUNING RECOMMENDATIONS");
	console.log("=".repeat(80));

	const recommendations: string[] = [];

	// Check unmapped percentage
	const unmappedPercent =
		(unmappedMessages.length / messages.length) * 100;
	if (unmappedPercent > 40) {
		recommendations.push(
			`📉 High unmapped rate (${unmappedPercent.toFixed(0)}%): Consider relaxing validation requirements`
		);
		recommendations.push(
			"   → ConversationValidator.validateConnections() is too strict"
		);
		recommendations.push(
			"   → Consider allowing conversations without explicit replies/mentions"
		);
	}

	// Check for potential merges
	const closePairs = convPairs.filter(
		(p) =>
			p.gap_minutes < 5 && p.same_channel && p.shared_participants > 0
	);
	if (closePairs.length > 0) {
		recommendations.push(
			`✂️  Found ${closePairs.length} conversation pairs < 5 min apart with shared participants`
		);
		recommendations.push(
			"   → Increase time gap threshold in mergeOverlappingGroups()"
		);
		recommendations.push(
			"   → Current: 15 min for overlapping participants"
		);
	}

	// Check conversation sizes
	const avgMsgCount =
		conversations.length > 0
			? conversations.reduce((acc, c) => acc + c.message_count, 0) /
				conversations.length
			: 0;
	if (avgMsgCount < 5) {
		recommendations.push(
			`📏 Small average conversation size (${avgMsgCount.toFixed(1)} messages)`
		);
		recommendations.push(
			"   → Conversations might be splitting too aggressively"
		);
		recommendations.push("   → Review temporal grouping thresholds");
	}

	// Check for unmapped messages with connections
	const unmappedWithConnections = unmappedMessages.filter(
		(m) => m.referenced_message_id || m.content.includes("@")
	).length;
	if (unmappedWithConnections > 5) {
		recommendations.push(
			`🔗 ${unmappedWithConnections} unmapped messages have replies/mentions`
		);
		recommendations.push(
			"   → These should likely be grouped into conversations"
		);
		recommendations.push(
			"   → Review MIN_MESSAGES threshold (currently 3)"
		);
	}

	if (recommendations.length > 0) {
		console.log();
		for (const rec of recommendations) {
			console.log(rec);
		}
	} else {
		console.log("\n✅ Grouping appears well-tuned!");
	}

	console.log("\n" + "=".repeat(80));
	console.log("✅ Analysis complete\n");

	await db.disconnect();
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});
