#!/usr/bin/env bun
/**
 * Deep Sorting Analysis Script
 *
 * Provides granular analysis of message sorting and grouping logic.
 * Shows exactly how the conversation detection algorithm processes each message,
 * which grouping strategies are applied, and why messages are included/excluded.
 */

import { PostgreSQLManager } from "../../../../database/PostgreSQLManager";
import { ConversationDetector } from "../ConversationDetector";
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
	has_replies: boolean;
	has_mentions: boolean;
	content_length: number;
	time_since_prev_ms: number;
	time_to_next_ms: number;
	same_author_prev: boolean;
	same_author_next: boolean;
	conversation_id: string | null;
}

interface GroupingWindow {
	start_time: Date;
	end_time: Date;
	duration_minutes: number;
	messages: Message[];
	participant_count: number;
	has_replies: boolean;
	has_mentions: boolean;
	min_gap_seconds: number;
	max_gap_seconds: number;
	avg_gap_seconds: number;
	density: number; // messages per minute
}

const db = new PostgreSQLManager();

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.substring(0, maxLen - 3) + "...";
}

function formatTime(date: Date): string {
	return date.toLocaleTimeString("en-US", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

async function main() {
	const args = process.argv.slice(2);
	const hoursBack = args[0] ? Number.parseInt(args[0], 10) : 24;
	const channelFilter = args.find((a) => a.startsWith("--channel="))?.split("=")[1];
	const showAllMessages = args.includes("--all-messages");
	const showGroupingDetails = args.includes("--grouping-details");
	const showValidation = args.includes("--validation");

	console.log("🔬 Deep Sorting Analysis");
	console.log("=".repeat(80));
	console.log(`Time window: Past ${hoursBack} hours`);
	if (channelFilter) console.log(`Channel filter: #${channelFilter}`);
	console.log(`Show all messages: ${showAllMessages ? "YES" : "NO"}`);
	console.log(`Show grouping details: ${showGroupingDetails ? "YES" : "NO"}`);
	console.log(`Show validation: ${showValidation ? "YES" : "NO"}`);
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

	// Fetch all messages with detailed metadata
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
      -- Check if this message has replies pointing to it
      EXISTS(
        SELECT 1 FROM messages m2
        WHERE m2.referenced_message_id = m.id
        AND m2.guild_id = m.guild_id
      ) as has_replies,
      -- Check if this message mentions others
      (m.content LIKE '%@%') as has_mentions
    FROM messages m
    LEFT JOIN message_conversations mc ON m.id = mc.id
    LEFT JOIN channels c ON m.channel_id = c.id
    LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
    WHERE m.guild_id = $1
      AND m.created_at > NOW() - INTERVAL '${hoursBack} hours'
      AND m.active = true
      AND COALESCE(mem.bot, false) = false
      AND COALESCE(c.name, '') NOT IN ('vc-logs', 'mod-logs', 'server-logs', 'audit-logs')
      ${channelFilter ? `AND c.name = '${channelFilter}'` : ""}
    ORDER BY m.created_at ASC
    `,
		[guildId]
	);

	if (!messagesResult.success) {
		console.error("❌ Failed to fetch messages");
		await db.disconnect();
		process.exit(1);
	}

	const rawMessages = messagesResult.data || [];
	const messages: Message[] = rawMessages.map((row: any, idx: number) => {
		const prevMsg = idx > 0 ? rawMessages[idx - 1] : null;
		const nextMsg = idx < rawMessages.length - 1 ? rawMessages[idx + 1] : null;

		return {
			id: row.id,
			content: row.content || "",
			author_id: row.author_id,
			username: row.username,
			channel_id: row.channel_id,
			channel_name: row.channel_name,
			created_at: new Date(row.created_at),
			referenced_message_id: row.referenced_message_id,
			has_replies: row.has_replies,
			has_mentions: row.has_mentions,
			content_length: (row.content || "").length,
			time_since_prev_ms: prevMsg
				? new Date(row.created_at).getTime() -
					new Date(prevMsg.created_at).getTime()
				: 0,
			time_to_next_ms: nextMsg
				? new Date(nextMsg.created_at).getTime() -
					new Date(row.created_at).getTime()
				: 0,
			same_author_prev: prevMsg ? prevMsg.author_id === row.author_id : false,
			same_author_next: nextMsg ? nextMsg.author_id === row.author_id : false,
			conversation_id: row.conversation_id,
		};
	});

	console.log(`\n🔹 Loaded ${messages.length} messages\n`);

	// === SECTION 1: MESSAGE FLOW ANALYSIS ===
	console.log("📝 MESSAGE FLOW ANALYSIS");
	console.log("=".repeat(80));

	// Group messages by channel for analysis
	const byChannel = new Map<string, Message[]>();
	for (const msg of messages) {
		const msgs = byChannel.get(msg.channel_name) || [];
		msgs.push(msg);
		byChannel.set(msg.channel_name, msgs);
	}

	for (const [channel, channelMsgs] of byChannel.entries()) {
		console.log(`\n📺 #${channel} (${channelMsgs.length} messages)`);
		console.log("─".repeat(80));

		// Detect natural conversation windows (gaps > 10 min = new window)
		const windows: GroupingWindow[] = [];
		let currentWindow: Message[] = [];
		const GAP_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

		for (let i = 0; i < channelMsgs.length; i++) {
			const msg = channelMsgs[i]!;

			if (currentWindow.length === 0) {
				currentWindow.push(msg);
			} else {
				const lastMsg = currentWindow[currentWindow.length - 1]!;
				const gap = msg.created_at.getTime() - lastMsg.created_at.getTime();

				if (gap > GAP_THRESHOLD_MS) {
					// Finalize current window
					if (currentWindow.length >= 2) {
						windows.push(analyzeWindow(currentWindow));
					}
					currentWindow = [msg];
				} else {
					currentWindow.push(msg);
				}
			}
		}

		// Finalize last window
		if (currentWindow.length >= 2) {
			windows.push(analyzeWindow(currentWindow));
		}

		console.log(`\nDetected ${windows.length} natural conversation windows (gaps > 10 min):\n`);

		for (let i = 0; i < windows.length; i++) {
			const window = windows[i]!;
			const windowNum = i + 1;

			console.log(`Window ${windowNum}:`);
			console.log(`  Time: ${formatTime(window.start_time)} → ${formatTime(window.end_time)} (${window.duration_minutes} min)`);
			console.log(`  Messages: ${window.messages.length}`);
			console.log(`  Participants: ${window.participant_count} users`);
			console.log(`  Density: ${window.density.toFixed(2)} msgs/min`);
			console.log(`  Features: ${window.has_replies ? "✓ replies" : "✗ replies"} | ${window.has_mentions ? "✓ mentions" : "✗ mentions"}`);
			console.log(`  Gaps: avg ${window.avg_gap_seconds}s, max ${window.max_gap_seconds}s`);

			// Show how these messages were grouped
			const grouped = window.messages.filter((m) => m.conversation_id);
			const ungrouped = window.messages.filter((m) => !m.conversation_id);
			console.log(`  Grouping: ${grouped.length} mapped, ${ungrouped.length} unmapped`);

			if (grouped.length > 0) {
				const convIds = new Set(grouped.map((m) => m.conversation_id));
				console.log(`  → Split into ${convIds.size} conversation(s)`);

				for (const convId of convIds) {
					const convMsgs = grouped.filter((m) => m.conversation_id === convId);
					console.log(`     • Conv ${convId?.substring(0, 12)}...: ${convMsgs.length} messages`);
				}
			}

			if (showAllMessages) {
				console.log("\n  Message details:");
				for (const msg of window.messages) {
					const status = msg.conversation_id ? "✓" : "✗";
					const prevGap = msg.time_since_prev_ms / 1000;
					const signals = [];
					if (msg.referenced_message_id) signals.push("reply");
					if (msg.has_mentions) signals.push("mention");
					if (msg.has_replies) signals.push("is-replied-to");

					console.log(`    ${status} ${formatTime(msg.created_at)} @${msg.username.padEnd(15)} (${prevGap.toFixed(0)}s) ${signals.length > 0 ? `[${signals.join(", ")}]` : ""}`);
					console.log(`       "${truncate(msg.content, 70)}"`);
				}
			}

			console.log();
		}
	}

	// === SECTION 2: GROUPING DECISION ANALYSIS ===
	if (showGroupingDetails) {
		console.log("\n\n🧩 GROUPING DECISION ANALYSIS");
		console.log("=".repeat(80));

		// Analyze why specific messages were grouped or not
		const mapped = messages.filter((m) => m.conversation_id);
		const unmapped = messages.filter((m) => !m.conversation_id);

		console.log("\nMapped vs Unmapped Comparison:");
		console.log("─".repeat(80));

		const compareMetric = (
			name: string,
			mappedValues: number[],
			unmappedValues: number[]
		) => {
			const mappedAvg = mappedValues.reduce((a, b) => a + b, 0) / mappedValues.length;
			const unmappedAvg = unmappedValues.reduce((a, b) => a + b, 0) / unmappedValues.length;
			const diff = ((mappedAvg - unmappedAvg) / unmappedAvg) * 100;

			console.log(`\n${name}:`);
			console.log(`  Mapped:   ${mappedAvg.toFixed(2)}`);
			console.log(`  Unmapped: ${unmappedAvg.toFixed(2)}`);
			console.log(`  Difference: ${diff > 0 ? "+" : ""}${diff.toFixed(1)}%`);
		};

		compareMetric(
			"Average content length",
			mapped.map((m) => m.content_length),
			unmapped.map((m) => m.content_length)
		);

		compareMetric(
			"Average time to next message (seconds)",
			mapped.map((m) => m.time_to_next_ms / 1000),
			unmapped.map((m) => m.time_to_next_ms / 1000)
		);

		console.log("\n\nFeature presence:");
		const mappedWithReplies = mapped.filter((m) => m.referenced_message_id).length;
		const unmappedWithReplies = unmapped.filter((m) => m.referenced_message_id).length;
		console.log(`  Has reply reference:`);
		console.log(`    Mapped:   ${mappedWithReplies}/${mapped.length} (${((mappedWithReplies / mapped.length) * 100).toFixed(0)}%)`);
		console.log(`    Unmapped: ${unmappedWithReplies}/${unmapped.length} (${((unmappedWithReplies / unmapped.length) * 100).toFixed(0)}%)`);

		const mappedWithMentions = mapped.filter((m) => m.has_mentions).length;
		const unmappedWithMentions = unmapped.filter((m) => m.has_mentions).length;
		console.log(`  Has mentions:`);
		console.log(`    Mapped:   ${mappedWithMentions}/${mapped.length} (${((mappedWithMentions / mapped.length) * 100).toFixed(0)}%)`);
		console.log(`    Unmapped: ${unmappedWithMentions}/${unmapped.length} (${((unmappedWithMentions / unmapped.length) * 100).toFixed(0)}%)`);

		const mappedIsRepliedTo = mapped.filter((m) => m.has_replies).length;
		const unmappedIsRepliedTo = unmapped.filter((m) => m.has_replies).length;
		console.log(`  Is replied to:`);
		console.log(`    Mapped:   ${mappedIsRepliedTo}/${mapped.length} (${((mappedIsRepliedTo / mapped.length) * 100).toFixed(0)}%)`);
		console.log(`    Unmapped: ${unmappedIsRepliedTo}/${unmapped.length} (${((unmappedIsRepliedTo / unmapped.length) * 100).toFixed(0)}%)`);
	}

	// === SECTION 3: EDGE CASES ===
	console.log("\n\n🔍 EDGE CASES & ANOMALIES");
	console.log("=".repeat(80));

	// Find unmapped messages with strong signals
	const unmappedWithSignals = messages.filter(
		(m) =>
			!m.conversation_id &&
			(m.referenced_message_id || m.has_mentions || m.has_replies)
	);

	if (unmappedWithSignals.length > 0) {
		console.log(`\n⚠️  ${unmappedWithSignals.length} unmapped messages with connection signals:\n`);

		for (const msg of unmappedWithSignals.slice(0, 20)) {
			const signals = [];
			if (msg.referenced_message_id) signals.push("replies to message");
			if (msg.has_mentions) signals.push("has mentions");
			if (msg.has_replies) signals.push("is replied to");

			console.log(`  ${formatTime(msg.created_at)} @${msg.username} (#${msg.channel_name})`);
			console.log(`    Signals: ${signals.join(", ")}`);
			console.log(`    Content: "${truncate(msg.content, 70)}"`);
			console.log(`    Gap before: ${(msg.time_since_prev_ms / 1000).toFixed(0)}s`);
			console.log();
		}
	}

	// Find very short gaps between unmapped messages
	const shortGaps: Array<{ msg1: Message; msg2: Message; gap_seconds: number }> = [];
	for (let i = 1; i < messages.length; i++) {
		const msg1 = messages[i - 1]!;
		const msg2 = messages[i]!;

		if (
			!msg1.conversation_id &&
			!msg2.conversation_id &&
			msg1.channel_id === msg2.channel_id
		) {
			const gap = (msg2.created_at.getTime() - msg1.created_at.getTime()) / 1000;
			if (gap < 120) {
				// < 2 minutes
				shortGaps.push({ msg1, msg2, gap_seconds: gap });
			}
		}
	}

	if (shortGaps.length > 0) {
		console.log(`\n⚠️  ${shortGaps.length} pairs of unmapped messages < 2 min apart:\n`);

		for (const gap of shortGaps.slice(0, 15)) {
			console.log(`  Gap: ${gap.gap_seconds.toFixed(0)}s (#${gap.msg1.channel_name})`);
			console.log(`    ${formatTime(gap.msg1.created_at)} @${gap.msg1.username}: "${truncate(gap.msg1.content, 50)}"`);
			console.log(`    ${formatTime(gap.msg2.created_at)} @${gap.msg2.username}: "${truncate(gap.msg2.content, 50)}"`);
			console.log();
		}
	}

	// Find mapped messages with large time gaps
	const largeGapsInConversations: Array<{
		conv_id: string;
		msg1: Message;
		msg2: Message;
		gap_minutes: number;
	}> = [];

	const convGroups = new Map<string, Message[]>();
	for (const msg of messages.filter((m) => m.conversation_id)) {
		const convMsgs = convGroups.get(msg.conversation_id!) || [];
		convMsgs.push(msg);
		convGroups.set(msg.conversation_id!, convMsgs);
	}

	for (const [convId, convMsgs] of convGroups.entries()) {
		const sorted = [...convMsgs].sort(
			(a, b) => a.created_at.getTime() - b.created_at.getTime()
		);

		for (let i = 1; i < sorted.length; i++) {
			const msg1 = sorted[i - 1]!;
			const msg2 = sorted[i]!;
			const gapMs = msg2.created_at.getTime() - msg1.created_at.getTime();
			const gapMinutes = gapMs / (1000 * 60);

			if (gapMinutes > 5) {
				largeGapsInConversations.push({
					conv_id: convId,
					msg1,
					msg2,
					gap_minutes: gapMinutes,
				});
			}
		}
	}

	if (largeGapsInConversations.length > 0) {
		console.log(`\n⚠️  ${largeGapsInConversations.length} large gaps (> 5 min) within conversations:\n`);

		for (const gap of largeGapsInConversations.slice(0, 10)) {
			console.log(`  Gap: ${gap.gap_minutes.toFixed(1)} min (Conv ${gap.conv_id.substring(0, 12)}...)`);
			console.log(`    ${formatTime(gap.msg1.created_at)} @${gap.msg1.username}: "${truncate(gap.msg1.content, 50)}"`);
			console.log(`    ⏱  ${gap.gap_minutes.toFixed(1)} minutes`);
			console.log(`    ${formatTime(gap.msg2.created_at)} @${gap.msg2.username}: "${truncate(gap.msg2.content, 50)}"`);
			console.log();
		}
	}

	// === SECTION 4: SORTING PARAMETERS ===
	console.log("\n\n⚙️  CURRENT SORTING PARAMETERS");
	console.log("=".repeat(80));

	console.log("\nFrom ConversationDetector.ts:");
	console.log("  INACTIVITY_MS: 10 minutes (base timeout)");
	console.log("  INACTIVITY_MS_WITH_REPLIES: 20 minutes (with active replies)");
	console.log("  MIN_MESSAGES: 3 (minimum messages per conversation)");
	console.log("  MAX_MESSAGE_GAP_MS: 8 hours (max gap between consecutive messages)");
	console.log("  MAX_CONVERSATION_DURATION_MS: 24 hours (max conversation duration)");

	console.log("\nFrom mergeOverlappingGroups():");
	console.log("  Time gap for overlapping participants: 15 minutes");
	console.log("  Time gap for non-overlapping participants: 5 minutes");

	console.log("\nFrom ConversationValidator:");
	console.log("  Requires: 2+ participants");
	console.log("  Requires: Explicit connections (replies OR mentions)");
	console.log("  Requires: No gaps > 8 hours");
	console.log("  Requires: Total duration < 24 hours");

	console.log("\n" + "=".repeat(80));
	console.log("🔹 Analysis complete\n");

	await db.disconnect();
}

function analyzeWindow(messages: Message[]): GroupingWindow {
	const sortedMsgs = [...messages].sort(
		(a, b) => a.created_at.getTime() - b.created_at.getTime()
	);

	const startTime = sortedMsgs[0]!.created_at;
	const endTime = sortedMsgs[sortedMsgs.length - 1]!.created_at;
	const durationMs = endTime.getTime() - startTime.getTime();
	const durationMinutes = Math.round(durationMs / (1000 * 60));

	const participants = new Set(messages.map((m) => m.author_id));
	const hasReplies = messages.some((m) => m.referenced_message_id);
	const hasMentions = messages.some((m) => m.has_mentions);

	// Calculate gaps
	const gaps: number[] = [];
	for (let i = 1; i < sortedMsgs.length; i++) {
		const gapMs =
			sortedMsgs[i]!.created_at.getTime() -
			sortedMsgs[i - 1]!.created_at.getTime();
		gaps.push(gapMs / 1000);
	}

	const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
	const minGap = gaps.length > 0 ? Math.min(...gaps) : 0;
	const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;

	const density = durationMinutes > 0 ? messages.length / durationMinutes : 0;

	return {
		start_time: startTime,
		end_time: endTime,
		duration_minutes: durationMinutes,
		messages: sortedMsgs,
		participant_count: participants.size,
		has_replies: hasReplies,
		has_mentions: hasMentions,
		min_gap_seconds: Math.round(minGap),
		max_gap_seconds: Math.round(maxGap),
		avg_gap_seconds: Math.round(avgGap),
		density,
	};
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});
