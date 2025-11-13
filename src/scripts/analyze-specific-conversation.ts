import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { RelationshipNetworkManager } from "../features/relationship-network/NetworkManager.js";
import { AnalysisFormatter } from "./utils/analysis-formatter.js";

// Test parameters
const CHANNEL_ID = "1254695279311978526"; // chat channel
const GUILD_ID = "1254694808228986912";
const TIME_WINDOW_HOURS = 24;

interface Message {
	id: string;
	author_id: string;
	author_name: string;
	content: string;
	created_at: Date;
	referenced_message_id?: string;
}

interface AffinityScore {
	historical: number;
	conversational: number;
	combined: number;
}

interface RelationshipContext {
	affinityMatrix: Map<string, Map<string, AffinityScore>>;
	conversationalBoosts: Map<string, Map<string, number>>;
	lastInteractions: Map<string, Date>;
}

interface ConversationGroup {
	id: string;
	participants: Set<string>;
	messageIds: Set<string>;
	startTime: Date;
	endTime: Date;
	avgAffinity: number;
}

interface MessageAnalysis {
	message: Message;
	grouped: boolean;
	conversationId?: string;
	reason?: string;
	scores?: {
		bestScore: number;
		bestConvo?: string;
		maxAffinity: number;
		temporalScore: number;
		threshold: number;
	};
}

async function analyzeSpecificConversation() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		// Get conversation index from command line (e.g., "2" for Conversation #2)
		const conversationIndex = parseInt(process.argv[2] || "2");
		if (isNaN(conversationIndex) || conversationIndex < 1) {
			console.error("\n❌ Error: Invalid conversation index");
			console.error("Usage: npm run analyze:conversation <conversation_index>\n");
			process.exit(1);
		}

		AnalysisFormatter.section(`ANALYZING CONVERSATION #${conversationIndex}`, 100);

		const cutoffTime = new Date();
		cutoffTime.setHours(cutoffTime.getHours() - TIME_WINDOW_HOURS);

		// Fetch all messages from past 24h
		const messagesResult = await db.query(
			`SELECT
				m.id,
				m.author_id,
				m.content,
				m.created_at,
				m.referenced_message_id,
				u.display_name,
				u.username
			FROM messages m
			LEFT JOIN members u ON u.user_id = m.author_id AND u.guild_id = m.guild_id
			WHERE m.channel_id = $1
				AND m.created_at >= $2
				AND m.active = true
			ORDER BY m.created_at ASC`,
			[CHANNEL_ID, cutoffTime]
		);

		if (!messagesResult.success || !messagesResult.data) {
			AnalysisFormatter.error("Failed to fetch messages");
			return;
		}

		const allMessages = messagesResult.data.map((m) => ({
			id: m.id,
			author_id: m.author_id,
			author_name: m.display_name || m.username || m.author_id.substring(0, 8),
			content: m.content || "",
			created_at: new Date(m.created_at),
			referenced_message_id: m.referenced_message_id,
		})) as Message[];

		if (allMessages.length === 0) {
			AnalysisFormatter.warning("No messages found in the last 24 hours");
			await db.disconnect();
			return;
		}

		// Build relationship context
		const uniqueAuthors = new Set(allMessages.map((m) => m.author_id));
		const relationshipContext = await buildRelationshipContext(
			Array.from(uniqueAuthors),
			GUILD_ID,
			cutoffTime,
			db,
			allMessages
		);

		// Group messages into conversations
		const conversations = groupMessagesWithRelationships(allMessages, relationshipContext);

		if (conversationIndex > conversations.length) {
			AnalysisFormatter.error(`Conversation #${conversationIndex} does not exist. Only ${conversations.length} conversations found.`);
			await db.disconnect();
			return;
		}

		const targetConversation = conversations[conversationIndex - 1];
		if (!targetConversation) {
			AnalysisFormatter.error(`Conversation #${conversationIndex} could not be loaded.`);
			await db.disconnect();
			return;
		}

		// Get all messages in the target conversation, sorted by time
		const convoMessages = allMessages
			.filter((m) => targetConversation.messageIds.has(m.id))
			.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

		// Create a map of message ID to conversation
		const messageToConversation = new Map<string, ConversationGroup>();
		for (const convo of conversations) {
			for (const msgId of convo.messageIds) {
				messageToConversation.set(msgId, convo);
			}
		}

		// Display summary
		const participants = Array.from(targetConversation.participants)
			.map((uid) => {
				const msg = allMessages.find((m) => m.author_id === uid);
				return msg?.author_name || uid.substring(0, 8);
			})
			.join(", ");

		console.log("│");
		AnalysisFormatter.metric("Analyzing Conversation", `#${conversationIndex}`);
		AnalysisFormatter.metric("Participants", participants);
		AnalysisFormatter.metric("Total Messages", convoMessages.length.toString());
		console.log("│");
		console.log("│  Legend:");
		console.log("│    •   = Message (not in target conversation)");
		console.log("│    ╔═╗ = TARGET CONVERSATION (being analyzed)");
		console.log("│    ║  = Message in target conversation");
		console.log("│    ╚═╝ = Target conversation end");
		console.log("│");

		AnalysisFormatter.subsection("All Messages in Chronological Order", 98);

		// Find first and last message IDs in target conversation (chronologically)
		if (convoMessages.length === 0) {
			AnalysisFormatter.error("Target conversation has no messages.");
			await db.disconnect();
			return;
		}

		const firstTargetMsgId = convoMessages[0]!.id;
		const lastTargetMsgId = convoMessages[convoMessages.length - 1]!.id;

		for (let i = 0; i < allMessages.length; i++) {
			const msg = allMessages[i];
			if (!msg) {
				continue;
			}
			const convo = messageToConversation.get(msg.id);
			const isTargetConversation = convo === targetConversation;

			const timestamp = msg.created_at.toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});

			const maxContentLength = 100;
			const content = msg.content.length > maxContentLength
				? msg.content.substring(0, maxContentLength) + "..."
				: msg.content || "(no content)";

			const replyIndicator = msg.referenced_message_id ? "↪ " : "";

			if (isTargetConversation) {
				// Check if this is the first message in the target conversation
				if (msg.id === firstTargetMsgId) {
					console.log("│  ╔═╗ TARGET CONVERSATION");
					console.log(`│  ║  Participants: ${participants} (${convoMessages.length} messages)`);
					console.log("│  ║");
				}

				// Check if this is the last message in the target conversation
				const isLastInTarget = msg.id === lastTargetMsgId;

				// Display the message
				const prefix = isLastInTarget ? "│  ╚═" : "│  ║ ";
				console.log(`${prefix} [${timestamp}] ${replyIndicator}${msg.author_name}: ${content}`);

				// Close the block if this is the last message
				if (isLastInTarget) {
					console.log("│  ╚═╝");
					console.log("│");
				}
			} else {
				// Display as regular message (not in target conversation)
				console.log(`│  • [${timestamp}] ${msg.author_name}: ${content}`);
			}
		}

		AnalysisFormatter.subsectionEnd(98);

		AnalysisFormatter.success("Analysis complete!");

		await db.disconnect();
	} catch (error) {
		AnalysisFormatter.error(
			`Error: ${error instanceof Error ? error.message : String(error)}`
		);
		await db.disconnect();
		process.exit(1);
	}
}

/**
 * Build relationship context for all active users in the guild
 */
async function buildRelationshipContext(
	userIds: string[],
	guildId: string,
	cutoffTime: Date,
	db: PostgreSQLManager,
	recentMessages: Message[]
): Promise<RelationshipContext> {
	const networkManager = new RelationshipNetworkManager(db);

	const affinityMatrix = new Map<string, Map<string, AffinityScore>>();
	const conversationalBoosts = new Map<string, Map<string, number>>();
	const lastInteractions = new Map<string, Date>();

	// Calculate conversational boosts from recent messages (past 30 min)
	const conversationalWindow = 30 * 60 * 1000; // 30 minutes
	const now = new Date();

	for (const msg of recentMessages) {
		const timeSinceMessage = now.getTime() - msg.created_at.getTime();
		if (timeSinceMessage > conversationalWindow) continue;

		// Find messages this user is responding to or interacting with
		const recentContext = recentMessages.filter(m => {
			const deltaMs = Math.abs(m.created_at.getTime() - msg.created_at.getTime());
			return deltaMs < 5 * 60 * 1000 && m.author_id !== msg.author_id; // 5 min window
		});

		for (const contextMsg of recentContext) {
			if (!conversationalBoosts.has(msg.author_id)) {
				conversationalBoosts.set(msg.author_id, new Map());
			}

			const currentBoost = conversationalBoosts.get(msg.author_id)?.get(contextMsg.author_id) || 0;

			// Boost decays with time: max 1.0 for <5min, decays to 0 at 30min
			const decayFactor = Math.max(0, 1 - timeSinceMessage / conversationalWindow);
			const boost = decayFactor * 0.3; // Max 0.3 per interaction

			conversationalBoosts.get(msg.author_id)?.set(contextMsg.author_id, currentBoost + boost);
		}
	}

	// Fetch peer matrix for all users (guild-wide relationships)
	const peerMatrixResult = await networkManager.getPeerMatrix(userIds, guildId);

	if (peerMatrixResult.success && peerMatrixResult.data) {
		// Build affinity matrix from peer data
		for (const [key, relationship] of Object.entries(peerMatrixResult.data)) {
			const [userA, userB] = key.split(":");

			if (!userA || !userB) continue; // Skip invalid keys

			// Initialize maps for both directions
			if (!affinityMatrix.has(userA)) {
				affinityMatrix.set(userA, new Map());
			}
			if (!affinityMatrix.has(userB)) {
				affinityMatrix.set(userB, new Map());
			}

			// Calculate historical affinity from raw_points
			// Normalize using log scale: score = min(1.0, log10(points + 1) / 3)
			const rawPoints = relationship.raw_points || 0;
			const historicalAffinity = rawPoints > 0
				? Math.min(1.0, Math.log10(rawPoints + 1) / 3)
				: 0;

			// Get conversational affinity from recent interactions
			const conversationalAffinity = Math.min(
				1.0,
				(conversationalBoosts.get(userA)?.get(userB) || 0) +
				(conversationalBoosts.get(userB)?.get(userA) || 0)
			);

			const affinityScore: AffinityScore = {
				historical: historicalAffinity,
				conversational: conversationalAffinity,
				combined: historicalAffinity * 0.4 + conversationalAffinity * 0.6,
			};

			// Set bidirectional affinity (both A→B and B→A)
			affinityMatrix.get(userA)?.set(userB, affinityScore);
			affinityMatrix.get(userB)?.set(userA, affinityScore);

			// Track last interaction
			if (relationship.last_interaction) {
				const lastInteraction = new Date(relationship.last_interaction);
				if (!lastInteractions.has(userA) || lastInteractions.get(userA)! < lastInteraction) {
					lastInteractions.set(userA, lastInteraction);
				}
				if (!lastInteractions.has(userB) || lastInteractions.get(userB)! < lastInteraction) {
					lastInteractions.set(userB, lastInteraction);
				}
			}
		}
	}

	return {
		affinityMatrix,
		conversationalBoosts,
		lastInteractions,
	};
}

/**
 * Group messages using relationship-aware scoring (same as test script)
 */
function groupMessagesWithRelationships(
	messages: Message[],
	context: RelationshipContext
): ConversationGroup[] {
	const conversations: ConversationGroup[] = [];
	const processedMessages = new Set<string>();

	// Group by explicit signals first (replies - strongest signal)
	for (const msg of messages) {
		if (processedMessages.has(msg.id)) continue;

		let targetConvo: ConversationGroup | undefined;

		// Check for reply chains - this is the strongest signal
		if (msg.referenced_message_id) {
			// Find existing conversation with the referenced message
			targetConvo = conversations.find((c) => c.messageIds.has(msg.referenced_message_id!));
			
			// If no conversation exists, find the referenced message and create a conversation
			if (!targetConvo) {
				const referencedMsg = messages.find(m => m.id === msg.referenced_message_id);
				if (referencedMsg) {
					// Create new conversation from reply chain
					targetConvo = {
						id: `conv_${referencedMsg.id}`,
						participants: new Set([referencedMsg.author_id, msg.author_id]),
						messageIds: new Set([referencedMsg.id, msg.id]),
						startTime: referencedMsg.created_at,
						endTime: msg.created_at,
						avgAffinity: 0,
					};
					conversations.push(targetConvo);
					processedMessages.add(referencedMsg.id);
					processedMessages.add(msg.id);
					continue;
				}
			}
		}

		if (targetConvo) {
			// Add to existing conversation
			targetConvo.messageIds.add(msg.id);
			targetConvo.participants.add(msg.author_id);
			targetConvo.endTime = msg.created_at;
			processedMessages.add(msg.id);
		}
	}

	// Group remaining messages by proximity + relationship scoring + interaction signals
	for (const msg of messages) {
		if (processedMessages.has(msg.id)) continue;

		// Check for mentions that might connect to existing conversations
		const mentionMatches = msg.content.match(/<@!?(\d+)>/g);
		const mentionedIds = mentionMatches ? mentionMatches.map(m => m.replace(/<@!?(\d+)>/, '$1')) : [];

		// Score against active conversations (within 5 min - tighter window)
		let bestScore = 0;
		let bestConvo: ConversationGroup | null = null;
		let bestReason = "";
		let bestMaxAffinity = 0;
		let bestTemporalScore = 0;

		for (const convo of conversations) {
			const timeDelta = msg.created_at.getTime() - convo.endTime.getTime();
			if (timeDelta > 5 * 60 * 1000) continue; // Skip if >5 min old (tighter window)
			if (timeDelta < 0) continue; // Skip if message is before conversation end

			// Check if message mentions a participant (strong signal)
			const mentionsParticipant = mentionedIds.some(id => convo.participants.has(id));
			
			// Check if author is already a participant
			const isParticipant = convo.participants.has(msg.author_id);

			// Calculate relationship score to conversation participants
			let maxAffinity = 0;
			for (const participantId of convo.participants) {
				if (participantId === msg.author_id) continue;

				const affinity = context.affinityMatrix.get(msg.author_id)?.get(participantId);
				if (affinity && affinity.combined > maxAffinity) {
					maxAffinity = affinity.combined;
				}
			}

			// Temporal proximity score (0-1) - steeper decay
			const temporalScore = Math.max(0, 1 - timeDelta / (5 * 60 * 1000));

			// Interaction bonus: mentions or is participant
			let interactionBonus = 0;
			if (mentionsParticipant) interactionBonus += 0.3;
			if (isParticipant) interactionBonus += 0.2;

			// Combined score: relationship (50%) + temporal (30%) + interaction (20%)
			const score = maxAffinity * 0.5 + temporalScore * 0.3 + interactionBonus;

			if (score > bestScore) {
				bestScore = score;
				bestConvo = convo;
				bestMaxAffinity = maxAffinity;
				bestTemporalScore = temporalScore;
				bestReason = mentionsParticipant ? "mentions participant" : isParticipant ? "is participant" : "proximity + relationship";
			}
		}

		// Require interaction signal but be more lenient
		// Allow if: mentions participant, is participant, or good relationship + close time
		const hasInteractionSignal = bestConvo && (
			mentionedIds.some(id => bestConvo!.participants.has(id)) ||
			bestConvo.participants.has(msg.author_id) ||
			(bestMaxAffinity > 0.2 && bestTemporalScore > 0.5) || // Good relationship + close time
			bestScore > 0.5 // Very high overall score
		);

		// Lower threshold to 0.25 but require interaction signal
		if (bestScore > 0.25 && bestConvo && hasInteractionSignal) {
			bestConvo.messageIds.add(msg.id);
			bestConvo.participants.add(msg.author_id);
			bestConvo.endTime = msg.created_at;
			processedMessages.add(msg.id);
		} else {
			// Check if this message mentions someone and that person responds later
			// This creates a conversation only if there's actual interaction
			if (mentionedIds.length > 0) {
				// Look ahead to see if any mentioned person responds within 5 minutes
				const responseWindow = 5 * 60 * 1000;
				const hasResponse = messages.some(m => 
					m.created_at > msg.created_at &&
					m.created_at.getTime() - msg.created_at.getTime() <= responseWindow &&
					mentionedIds.includes(m.author_id)
				);

				if (hasResponse) {
					// Create conversation from mention + response
					const newConvo: ConversationGroup = {
						id: `conv_${msg.id}`,
						participants: new Set([msg.author_id, ...mentionedIds]),
						messageIds: new Set([msg.id]),
						startTime: msg.created_at,
						endTime: msg.created_at,
						avgAffinity: 0,
					};
					conversations.push(newConvo);
					processedMessages.add(msg.id);
				}
			}
		}
	}

	// Final pass: add responses to mention-based conversations
	// Only add if the conversation was created from a mention (has exactly 1 initial message with a mention)
	for (const msg of messages) {
		if (processedMessages.has(msg.id)) continue;

		// Find conversations where this message is a response to a mention
		for (const convo of conversations) {
			// Only process conversations that were created from mentions (they should have 1 message that mentions someone)
			if (convo.messageIds.size === 0) continue;
			
			// Find the first message in the conversation that mentions someone
			const firstConvoMsg = Array.from(convo.messageIds)
				.map(id => messages.find(m => m.id === id))
				.filter((m): m is Message => m !== undefined)
				.sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0];
			
			if (!firstConvoMsg) continue;
			
			const mentionMatches = firstConvoMsg.content.match(/<@!?(\d+)>/g);
			if (!mentionMatches) continue; // Skip if conversation wasn't created from a mention
			
			const mentionedIds = mentionMatches.map(m => m.replace(/<@!?(\d+)>/, '$1'));
			
			// Check if this message author was mentioned in the FIRST message of the conversation
			// AND the message is a direct response (within 5 min, and author is the mentioned person)
			if (mentionedIds.includes(msg.author_id)) {
				const timeDelta = msg.created_at.getTime() - firstConvoMsg.created_at.getTime();
				if (timeDelta > 0 && timeDelta <= 5 * 60 * 1000) {
					// This is a response to the original mention within 5 minutes
					convo.messageIds.add(msg.id);
					convo.participants.add(msg.author_id);
					convo.endTime = msg.created_at;
					processedMessages.add(msg.id);
					break;
				}
			}
		}
	}

	// Calculate average affinity for each conversation
	for (const convo of conversations) {
		const participants = Array.from(convo.participants);
		let totalAffinity = 0;
		let pairCount = 0;

		for (let i = 0; i < participants.length; i++) {
			for (let j = i + 1; j < participants.length; j++) {
				const affinity = context.affinityMatrix.get(participants[i])?.get(participants[j]);
				if (affinity) {
					totalAffinity += affinity.combined;
					pairCount++;
				}
			}
		}

		convo.avgAffinity = pairCount > 0 ? totalAffinity / pairCount : 0;
	}

	return conversations.filter((c) => c.messageIds.size >= 2);
}

analyzeSpecificConversation();
