import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { AIManager } from "../features/ai-assistant/AIManager.js";
import { AnalysisFormatter } from "./utils/analysis-formatter.js";

interface Message {
	id: string;
	author_id: string;
	author_name: string;
	content: string;
	created_at: Date;
	referenced_message_id?: string;
	reply_to_author?: string;
	channel_id: string;
}

interface ConversationSegment {
	id: string;
	start_time: Date;
	end_time: Date;
	message_count: number;
	participants: string[];
	message_ids: string[];
	status?: string;
}

interface AIConversationGroup {
	conversation_id: number;
	topic: string;
	message_ids: string[];
	participants: string[];
	reasoning: string;
	start_time: Date;
	end_time: Date;
	confidence: number;
}

async function analyzeConversationAccuracy() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		const channelId = process.argv[2] || "1254694808228986912";
		const guildId = process.env.GUILD_ID;

		if (!guildId) {
			console.error("\n❌ Error: GUILD_ID required in .env");
			return;
		}

		AnalysisFormatter.section("CONVERSATION ACCURACY ANALYSIS", 100);

		const twentyFourHoursAgo = new Date();
		twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

		// Step 1: Fetch existing programmatic conversation segments
		AnalysisFormatter.subsection("Step 1: Programmatic Conversation Segments", 98);

		const segmentsResult = await db.query(
			`SELECT
				cs.id,
				cs.start_time,
				cs.end_time,
				cs.message_count,
				cs.participants,
				cs.message_ids,
				cs.status,
				cs.summary
			FROM conversation_segments cs
			WHERE cs.channel_id = $1
				AND cs.start_time >= $2
			ORDER BY cs.start_time ASC`,
			[channelId, twentyFourHoursAgo]
		);

		const segments = (segmentsResult.data || []) as ConversationSegment[];

		AnalysisFormatter.metric("Total Segments", AnalysisFormatter.formatNumber(segments.length));
		AnalysisFormatter.metric(
			"Total Messages in Segments",
			AnalysisFormatter.formatNumber(
				segments.reduce((sum, s) => sum + s.message_count, 0)
			)
		);
		AnalysisFormatter.subsectionEnd(98);

		// Step 2: Fetch ALL raw messages from the channel
		AnalysisFormatter.subsection("Step 2: Raw Message Data", 98);

		const messagesResult = await db.query(
			`SELECT
				m.id,
				m.author_id,
				m.content,
				m.created_at,
				m.referenced_message_id,
				m.channel_id,
				u.display_name,
				u.username,
				ref_user.display_name as reply_to_display_name,
				ref_user.username as reply_to_username
			FROM messages m
			LEFT JOIN members u ON u.user_id = m.author_id AND u.guild_id = m.guild_id
			LEFT JOIN messages ref_msg ON ref_msg.id = m.referenced_message_id
			LEFT JOIN members ref_user ON ref_user.user_id = ref_msg.author_id AND ref_user.guild_id = m.guild_id
			WHERE m.channel_id = $1
				AND m.created_at >= $2
				AND m.active = true
			ORDER BY m.created_at ASC`,
			[channelId, twentyFourHoursAgo]
		);

		const allMessages = (messagesResult.data || []).map((m: any) => ({
			id: m.id,
			author_id: m.author_id,
			author_name: m.display_name || m.username || m.author_id.substring(0, 8),
			content: m.content || "",
			created_at: new Date(m.created_at),
			referenced_message_id: m.referenced_message_id,
			reply_to_author: m.reply_to_display_name || m.reply_to_username,
			channel_id: m.channel_id,
		})) as Message[];

		AnalysisFormatter.metric(
			"Total Raw Messages",
			AnalysisFormatter.formatNumber(allMessages.length)
		);

		// Calculate how many messages are NOT in any segment
		const messagesInSegments = new Set<string>();
		for (const seg of segments) {
			for (const msgId of seg.message_ids) {
				messagesInSegments.add(msgId);
			}
		}

		const orphanedMessages = allMessages.filter((m) => !messagesInSegments.has(m.id));

		AnalysisFormatter.metric(
			"Messages in Segments",
			AnalysisFormatter.formatNumber(messagesInSegments.size)
		);
		AnalysisFormatter.metric(
			"Orphaned Messages",
			AnalysisFormatter.formatNumber(orphanedMessages.length)
		);
		AnalysisFormatter.metric(
			"Coverage",
			`${((messagesInSegments.size / allMessages.length) * 100).toFixed(1)}%`
		);

		AnalysisFormatter.subsectionEnd(98);

		if (allMessages.length === 0) {
			AnalysisFormatter.warning("No messages found in the last 24 hours");
			await db.disconnect();
			return;
		}

		// Step 3: AI-driven conversation analysis
		AnalysisFormatter.subsection("Step 3: AI-Driven Conversation Analysis", 98);

		console.log("│   Analyzing raw messages with AI...");
		console.log("│   This may take a moment...");

		// Prepare message data for AI
		const messageData = allMessages.map((m, idx) => ({
			index: idx + 1,
			id: m.id,
			author: m.author_name,
			timestamp: m.created_at.toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			}),
			content: m.content.substring(0, 800), // Gemini can handle more content
			is_reply: !!m.referenced_message_id,
			reply_to: m.reply_to_author || null,
		}));

		const aiPrompt = `You are analyzing a Discord channel's messages to identify conversation groupings.

Below are ${allMessages.length} messages from the past 24 hours, ordered chronologically.

Your task:
1. Identify natural conversation groups based on topic, context, and participant interaction
2. Consider: topic continuity, reply chains, participant overlap, temporal proximity, semantic similarity
3. A conversation should have at least 3 messages with meaningful interaction
4. Single isolated messages or bot commands should not form conversations

Messages:
${JSON.stringify(messageData, null, 2)}

Respond with a JSON array of conversation groups. Each group should have:
{
  "conversation_id": <number>,
  "topic": "<brief topic description>",
  "message_indices": [<array of message indices in this conversation>],
  "participants": [<array of unique author names>],
  "reasoning": "<why these messages form a conversation>",
  "confidence": <0-100, how confident you are this is a coherent conversation>
}

Important:
- Only include messages that truly belong to a conversation
- Don't force every message into a conversation
- Reply chains are strong signals but not the only factor
- Consider semantic topics, not just proximity
- Look for topic shifts, changes in participants, and natural conversation boundaries
- Output ONLY valid JSON array, no markdown, no explanatory text`;

		let aiGroups: AIConversationGroup[] = [];

		try {
			const aiManager = AIManager.getInstance();
			const aiResponse = await aiManager.generateText(
				aiPrompt,
				"system-analysis",
				"gemini",
				{ useDiscordFormatting: false }
			);

			if (!aiResponse.success || !aiResponse.content) {
				console.log(`│   ⚠️  AI request failed: ${aiResponse.error || "No content returned"}`);
				AnalysisFormatter.subsectionEnd(98);
				await db.disconnect();
				return;
			}

			// Try to extract JSON from response (handle markdown code blocks)
			let cleanedResponse = aiResponse.content.trim();

			// Remove markdown code blocks if present
			if (cleanedResponse.startsWith("```")) {
				cleanedResponse = cleanedResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "");
			}

			const jsonMatch = cleanedResponse.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);

				// Convert indices back to message IDs
				aiGroups = parsed
					.filter((group: any) => group.message_indices && group.message_indices.length >= 3)
					.map((group: any) => {
						const messages = group.message_indices
							.map((idx: number) => allMessages[idx - 1])
							.filter((m: Message | undefined) => m !== undefined);

						if (messages.length === 0) return null;

						return {
							conversation_id: group.conversation_id,
							topic: group.topic,
							message_ids: messages.map((m: Message) => m.id),
							participants: group.participants,
							reasoning: group.reasoning,
							start_time: messages[0].created_at,
							end_time: messages[messages.length - 1].created_at,
							confidence: group.confidence || 0,
						};
					})
					.filter((g: any) => g !== null);

				AnalysisFormatter.metric(
					"AI-Identified Conversations",
					AnalysisFormatter.formatNumber(aiGroups.length)
				);

				const aiMessageCount = aiGroups.reduce((sum, g) => sum + g.message_ids.length, 0);
				AnalysisFormatter.metric(
					"Messages Grouped by AI",
					AnalysisFormatter.formatNumber(aiMessageCount)
				);
				AnalysisFormatter.metric(
					"AI Coverage",
					`${((aiMessageCount / allMessages.length) * 100).toFixed(1)}%`
				);

				// Show average confidence
				const avgConfidence =
					aiGroups.reduce((sum, g) => sum + g.confidence, 0) / aiGroups.length;
				AnalysisFormatter.metric(
					"Avg Confidence",
					`${avgConfidence.toFixed(1)}%`
				);
			} else {
				console.log("│   ⚠️  AI response did not contain valid JSON");
				console.log(`│   Response preview: ${aiResponse.content.substring(0, 200)}...`);
			}
		} catch (error) {
			console.log(
				`│   ⚠️  AI analysis failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}

		AnalysisFormatter.subsectionEnd(98);

		// Step 4: Compare programmatic vs AI groupings
		AnalysisFormatter.subsection("Step 4: Comparison Analysis", 98);

		// Calculate overlap between programmatic segments and AI groups
		const comparisons: any[] = [];

		for (const seg of segments) {
			const segMsgSet = new Set(seg.message_ids);

			// Find AI groups that overlap with this segment
			const overlappingAIGroups = aiGroups
				.map((aiGroup) => {
					const aiMsgSet = new Set(aiGroup.message_ids);
					const intersection = [...segMsgSet].filter((id) => aiMsgSet.has(id));
					const union = new Set([...segMsgSet, ...aiMsgSet]);

					return {
						aiGroup,
						overlap: intersection.length,
						jaccardSimilarity: intersection.length / union.size,
						precision: intersection.length / aiMsgSet.size,
						recall: intersection.length / segMsgSet.size,
					};
				})
				.filter((c) => c.overlap > 0)
				.sort((a, b) => b.jaccardSimilarity - a.jaccardSimilarity);

			comparisons.push({
				segment: seg,
				bestMatch: overlappingAIGroups[0] || null,
				allMatches: overlappingAIGroups,
			});
		}

		// Show comparison table
		if (comparisons.length > 0) {
			const columns = [
				{ header: "#", width: 4, align: "right" as const },
				{ header: "Prog Msgs", width: 10, align: "right" as const },
				{ header: "AI Match", width: 10, align: "left" as const },
				{ header: "Overlap", width: 8, align: "right" as const },
				{ header: "Jaccard", width: 8, align: "right" as const },
				{ header: "Precision", width: 10, align: "right" as const },
				{ header: "Recall", width: 8, align: "right" as const },
				{ header: "AI Topic", width: 35, align: "left" as const },
			];

			const rows = comparisons.map((comp, i) => {
				if (!comp.bestMatch) {
					return [
						i + 1,
						comp.segment.message_count,
						"No match",
						"-",
						"-",
						"-",
						"-",
						"(No AI conversation matched)",
					];
				}

				const m = comp.bestMatch;
				return [
					i + 1,
					comp.segment.message_count,
					`Conv ${m.aiGroup.conversation_id}`,
					m.overlap,
					(m.jaccardSimilarity * 100).toFixed(0) + "%",
					(m.precision * 100).toFixed(0) + "%",
					(m.recall * 100).toFixed(0) + "%",
					m.aiGroup.topic.substring(0, 34),
				];
			});

			AnalysisFormatter.table(columns, rows);
		}

		AnalysisFormatter.subsectionEnd(98);

		// Step 5: Detailed AI conversation groups
		if (aiGroups.length > 0) {
			AnalysisFormatter.subsection("Step 5: AI-Identified Conversation Details", 98);

			for (const aiGroup of aiGroups) {
				console.log("│");
				console.log(`│ 🤖 AI Conversation ${aiGroup.conversation_id}: ${aiGroup.topic}`);
				console.log(
					`│    ${aiGroup.message_ids.length} messages • ${aiGroup.participants.length} participants`
				);
				console.log(`│    Reasoning: ${aiGroup.reasoning}`);
				console.log(
					`│    Time: ${aiGroup.start_time.toLocaleTimeString()} → ${aiGroup.end_time.toLocaleTimeString()}`
				);

				// Check if this AI group matches any programmatic segment
				const matchedSegment = comparisons.find(
					(c) => c.bestMatch?.aiGroup.conversation_id === aiGroup.conversation_id
				);

				if (matchedSegment) {
					const m = matchedSegment.bestMatch;
					console.log(
						`│    ✓ Matched with Segment (Jaccard: ${(m.jaccardSimilarity * 100).toFixed(0)}%)`
					);
				} else {
					console.log("│    ⚠️  No matching programmatic segment found");
				}
			}

			AnalysisFormatter.subsectionEnd(98);
		}

		// Step 6: Orphaned messages analysis
		if (orphanedMessages.length > 0) {
			AnalysisFormatter.subsection("Step 6: Orphaned Messages Analysis", 98);

			AnalysisFormatter.metric(
				"Total Orphaned",
				AnalysisFormatter.formatNumber(orphanedMessages.length)
			);

			console.log("│");
			console.log("│   Sample orphaned messages:");

			for (const msg of orphanedMessages.slice(0, 10)) {
				const content = msg.content.substring(0, 80);
				const time = msg.created_at.toLocaleTimeString();
				console.log(`│   ${time} @${msg.author_name}: ${content}`);
			}

			if (orphanedMessages.length > 10) {
				console.log(`│   ... and ${orphanedMessages.length - 10} more`);
			}

			AnalysisFormatter.subsectionEnd(98);
		}

		// Step 7: Improvement suggestions
		AnalysisFormatter.subsection("Step 7: Improvement Suggestions", 98);

		const suggestions: string[] = [];

		// Coverage analysis
		const coverage = (messagesInSegments.size / allMessages.length) * 100;
		if (coverage < 70) {
			suggestions.push(
				`Low message coverage (${coverage.toFixed(1)}%). Consider reducing minimum message threshold or inactivity timeout.`
			);
		}

		// AI vs programmatic comparison
		const avgJaccard =
			comparisons.filter((c) => c.bestMatch).reduce((sum, c) => sum + c.bestMatch.jaccardSimilarity, 0) /
			comparisons.filter((c) => c.bestMatch).length;

		if (!Number.isNaN(avgJaccard) && avgJaccard < 0.6) {
			suggestions.push(
				`Low average similarity with AI groupings (${(avgJaccard * 100).toFixed(0)}%). Current logic may be oversegmenting or undersegmenting.`
			);
		}

		// Orphaned messages
		if (orphanedMessages.length > allMessages.length * 0.3) {
			suggestions.push(
				`High orphan rate (${((orphanedMessages.length / allMessages.length) * 100).toFixed(1)}%). Many messages not captured in conversations.`
			);
		}

		// Segment size analysis
		const avgSegmentSize = segments.reduce((sum, s) => sum + s.message_count, 0) / segments.length;
		if (avgSegmentSize < 5) {
			suggestions.push(
				`Small average segment size (${avgSegmentSize.toFixed(1)} msgs). Consider increasing context window or reducing fragmentation.`
			);
		}

		// AI-only conversations
		const aiOnlyConvos = aiGroups.filter((aiGroup) => {
			return !comparisons.some(
				(c) => c.bestMatch?.aiGroup.conversation_id === aiGroup.conversation_id
			);
		});

		if (aiOnlyConvos.length > 0) {
			suggestions.push(
				`AI identified ${aiOnlyConvos.length} conversations that programmatic logic missed. Review semantic/topic-based grouping.`
			);
		}

		console.log("│");
		if (suggestions.length === 0) {
			console.log("│   ✅ Conversation grouping appears reasonably accurate");
		} else {
			for (let i = 0; i < suggestions.length; i++) {
				console.log(`│   ${i + 1}. ${suggestions[i]}`);
			}
		}

		AnalysisFormatter.subsectionEnd(98);

		AnalysisFormatter.success("Analysis complete");

		await db.disconnect();
	} catch (error) {
		AnalysisFormatter.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		console.error(error);
		await db.disconnect();
		process.exit(1);
	}
}

analyzeConversationAccuracy();
