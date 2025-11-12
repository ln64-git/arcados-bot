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
	message_ids: string[];
}

interface Message {
	id: string;
	author_id: string;
	content: string;
	created_at: Date;
	referenced_message_id?: string;
	display_name?: string;
	username?: string;
	global_name?: string;
}

async function analyzeConversationSegment() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		// Get segment ID or index from command line
		// Handle both: "1" (index) or "abc123" (segment ID)
		// Also check for --from-status flag (may be in any position due to npm flag handling)
		const args = process.argv.slice(2);
		const fromStatusFlag = args.find((arg) => arg === "--from-status" || arg === "-s");
		const input = args.find((arg) => arg !== "--from-status" && arg !== "-s" && !arg.startsWith("-"));

		if (!input) {
			console.error("\n❌ Error: Segment ID or conversation index required");
			console.error("Usage: npm run analyze:segment <segment_id>");
			console.error("   OR: npm run analyze:segment <index>");
			console.error("   OR: npm run analyze:segment -- --from-status <index>");
			console.error("\nExample:");
			console.error("  npm run analyze:segment abc123def456");
			console.error("  npm run analyze:segment 1  # Analyzes conversation #1 from status inspection (auto-detected)");
			console.error("  npm run analyze:segment -- --from-status 1\n");
			return;
		}

		// Auto-detect: if input is a small number (1-100), treat as index
		// Otherwise treat as segment ID
		const parsedIndex = parseInt(input);
		const isLikelyIndex = !isNaN(parsedIndex) && parsedIndex >= 1 && parsedIndex <= 100;
		const fromStatus = fromStatusFlag !== undefined || isLikelyIndex;

		let segmentId: string | null = null;
		let segment: ConversationSegment | null = null;

		if (fromStatus) {
			// Get segment by index from recent finalized conversations
			const index = parsedIndex;
			if (isNaN(index) || index < 1) {
				console.error("\n❌ Error: Invalid conversation index");
				return;
			}

			const guildId = process.env.GUILD_ID;
			if (!guildId) {
				console.error("\n❌ Error: GUILD_ID required in .env");
				return;
			}

			const twentyFourHoursAgo = new Date();
			twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

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
					cs.summary,
					cs.status,
					cs.features,
					cs.message_ids
				FROM conversation_segments cs
				LEFT JOIN channels c ON c.id = cs.channel_id
				WHERE cs.guild_id = $1
					AND cs.start_time >= $2
					AND cs.status = 'finalized'
				ORDER BY cs.end_time DESC
				LIMIT $3`,
				[guildId, twentyFourHoursAgo, index]
			);

			if (!segmentsResult.success || !segmentsResult.data || segmentsResult.data.length < index) {
				console.error(`\n❌ Error: Conversation #${index} not found`);
				return;
			}

			segment = segmentsResult.data[index - 1] as ConversationSegment;
			segmentId = segment.id;
		} else {
			// Assume it's a segment ID
			segmentId = input;

			const segmentResult = await db.query(
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
					cs.message_ids
				FROM conversation_segments cs
				LEFT JOIN channels c ON c.id = cs.channel_id
				WHERE cs.id = $1`,
				[segmentId]
			);

			if (!segmentResult.success || !segmentResult.data || segmentResult.data.length === 0) {
				console.error(`\n❌ Error: Conversation segment not found: ${segmentId}`);
				return;
			}

			segment = segmentResult.data[0] as ConversationSegment;
		}

		if (!segment) {
			console.error("\n❌ Error: Failed to load conversation segment");
			return;
		}

		AnalysisFormatter.section(`ANALYZING CONVERSATION SEGMENT`, 100);
		console.log(`Segment ID: ${segment.id}`);
		console.log(`Channel: ${segment.channel_name || segment.channel_id}`);
		console.log(`Status: ${segment.status || "unknown"}\n`);

		// Get participant names
		const participantIds = Array.isArray(segment.participants) ? segment.participants : [];
		const nameMap = new Map<string, string>();

		if (participantIds.length > 0) {
			const namesResult = await db.query(
				`SELECT user_id, display_name, username, global_name
				FROM members
				WHERE guild_id = $1 AND user_id = ANY($2::TEXT[]) AND active = true`,
				[segment.guild_id, participantIds]
			);

			if (namesResult.success && namesResult.data) {
				for (const row of namesResult.data) {
					const displayName = row.display_name || row.global_name || row.username || row.user_id;
					nameMap.set(row.user_id, displayName);
				}
			}
		}

		const participantNames = participantIds
			.map((uid) => nameMap.get(uid) || uid.substring(0, 8))
			.join(", ");

		// Basic Info
		AnalysisFormatter.subsection("Conversation Overview", 98);

		const duration = (new Date(segment.end_time).getTime() - new Date(segment.start_time).getTime()) / 1000 / 60;
		const hoursAgo = Math.round((Date.now() - new Date(segment.end_time).getTime()) / (1000 * 60 * 60));

		AnalysisFormatter.metric("Participants", `${participantNames} (${participantIds.length} people)`);
		AnalysisFormatter.metric("Message Count", AnalysisFormatter.formatNumber(segment.message_count));
		AnalysisFormatter.metric("Duration", `${duration.toFixed(1)} minutes (${(duration / 60).toFixed(1)} hours)`);
		console.log("│");
		AnalysisFormatter.metric("Start Time", new Date(segment.start_time).toLocaleString());
		AnalysisFormatter.metric("End Time", new Date(segment.end_time).toLocaleString());
		AnalysisFormatter.metric("Time Since End", `${hoursAgo} hours ago`);
		if (segment.summary) {
			console.log("│");
			AnalysisFormatter.metric("Summary", segment.summary);
		}

		AnalysisFormatter.subsectionEnd(98);

		// Get all messages
		const messageIds = Array.isArray(segment.message_ids) ? segment.message_ids : [];
		if (messageIds.length === 0) {
			AnalysisFormatter.warning("No message IDs found in segment");
			await db.disconnect();
			return;
		}

		const messagesResult = await db.query(
			`SELECT
				m.id,
				m.author_id,
				m.content,
				m.created_at,
				m.referenced_message_id,
				mem.display_name,
				mem.username,
				mem.global_name
			FROM messages m
			LEFT JOIN members mem ON mem.user_id = m.author_id AND mem.guild_id = m.guild_id
			WHERE m.id = ANY($1::TEXT[]) AND m.guild_id = $2 AND m.active = true
			ORDER BY m.created_at ASC`,
			[messageIds, segment.guild_id]
		);

		if (!messagesResult.success || !messagesResult.data) {
			AnalysisFormatter.error("Failed to fetch messages");
			await db.disconnect();
			return;
		}

		const messages = messagesResult.data as Message[];

		if (messages.length !== messageIds.length) {
			AnalysisFormatter.warning(
				`Expected ${messageIds.length} messages, but found ${messages.length} in database`
			);
		}

		// Participant Activity
		AnalysisFormatter.subsection("Participant Activity", 98);

		const participantActivity = new Map<string, { count: number; messages: Message[] }>();
		for (const msg of messages) {
			const authorId = msg.author_id;
			if (!participantActivity.has(authorId)) {
				participantActivity.set(authorId, { count: 0, messages: [] });
			}
			const activity = participantActivity.get(authorId)!;
			activity.count++;
			activity.messages.push(msg);
		}

		const activityArray = Array.from(participantActivity.entries())
			.map(([userId, data]) => ({
				userId,
				name: nameMap.get(userId) || userId.substring(0, 8),
				count: data.count,
				percentage: ((data.count / messages.length) * 100).toFixed(1),
			}))
			.sort((a, b) => b.count - a.count);

		const columns = [
			{ header: "Participant", width: 30, align: "left" as const },
			{ header: "Messages", width: 12, align: "right" as const },
			{ header: "Percentage", width: 12, align: "right" as const },
		];

		const rows = activityArray.map((p) => [p.name, AnalysisFormatter.formatNumber(p.count), `${p.percentage}%`]);

		AnalysisFormatter.table(columns, rows);
		AnalysisFormatter.subsectionEnd(98);

		// Message Timeline
		AnalysisFormatter.subsection("Message Timeline", 98);

		// Group messages by time windows (every 10 minutes)
		const timeWindows: Array<{ start: Date; end: Date; messages: Message[] }> = [];
		const windowSize = 10 * 60 * 1000; // 10 minutes in ms

		for (const msg of messages) {
			const msgTime = new Date(msg.created_at).getTime();
			const windowStart = new Date(Math.floor(msgTime / windowSize) * windowSize);

			let window = timeWindows.find(
				(w) => w.start.getTime() === windowStart.getTime()
			);
			if (!window) {
				window = { start: windowStart, end: new Date(windowStart.getTime() + windowSize), messages: [] };
				timeWindows.push(window);
			}
			window.messages.push(msg);
		}

		console.log(`│  ${timeWindows.length} time windows (10-minute intervals)`);
		console.log("│");

		for (let i = 0; i < Math.min(timeWindows.length, 20); i++) {
			const window = timeWindows[i];
			const windowStart = window.start.toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
			});
			const windowEnd = window.end.toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
			});

			const participantsInWindow = new Set(window.messages.map((m) => m.author_id)).size;
			console.log(
				`│  ${windowStart} - ${windowEnd}: ${window.messages.length} messages from ${participantsInWindow} participants`
			);
		}

		if (timeWindows.length > 20) {
			console.log(`│  ... and ${timeWindows.length - 20} more windows`);
		}

		AnalysisFormatter.subsectionEnd(98);

		// Reply Analysis
		AnalysisFormatter.subsection("Reply Analysis", 98);

		const replyCount = messages.filter((m) => m.referenced_message_id).length;
		const replyPercentage = ((replyCount / messages.length) * 100).toFixed(1);

		AnalysisFormatter.metric("Total Replies", AnalysisFormatter.formatNumber(replyCount));
		AnalysisFormatter.metric("Reply Percentage", `${replyPercentage}%`);
		AnalysisFormatter.metric("Standalone Messages", AnalysisFormatter.formatNumber(messages.length - replyCount));

		AnalysisFormatter.subsectionEnd(98);

		// Full Message List
		AnalysisFormatter.subsection("All Messages (Chronological)", 98);

		console.log("│  Showing all messages in chronological order:");
		console.log("│");

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			const authorName = nameMap.get(msg.author_id) || msg.display_name || msg.username || msg.author_id.substring(0, 8);
			const timestamp = new Date(msg.created_at).toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
			const content = (msg.content || "(no content)").trim();
			const isReply = msg.referenced_message_id ? "↪ " : "";
			const contentDisplay = content.length > 120 ? content.substring(0, 120) + "..." : content;

			// Show message number, timestamp, author, and content
			const msgNum = (i + 1).toString().padStart(3, "0");
			console.log(`│  [${msgNum}] ${timestamp} ${isReply}${authorName}: ${contentDisplay}`);
		}

		AnalysisFormatter.subsectionEnd(98);

		// Features Analysis
		if (segment.features && Object.keys(segment.features).length > 0) {
			AnalysisFormatter.subsection("Conversation Features", 98);
			console.log("│  " + JSON.stringify(segment.features, null, 2).replace(/\n/g, "\n│  "));
			AnalysisFormatter.subsectionEnd(98);
		}

		AnalysisFormatter.success("Analysis complete");

		await db.disconnect();
	} catch (error) {
		AnalysisFormatter.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		await db.disconnect();
		process.exit(1);
	}
}

analyzeConversationSegment();

