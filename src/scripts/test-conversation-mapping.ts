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
  embedding?: number[];
  keywords?: Set<string>; // Cached keywords for performance
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
  messages?: Message[];
}

/**
 * Calculate cosine similarity between two embeddings
 */
function calculateCosineSimilarity(emb1: number[], emb2: number[]): number {
  if (emb1.length !== emb2.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < emb1.length; i++) {
    dotProduct += emb1[i]! * emb2[i]!;
    normA += emb1[i]! * emb1[i]!;
    normB += emb2[i]! * emb2[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  // Cosine similarity ranges from -1 to 1, normalize to 0-1
  const similarity = dotProduct / denominator;
  return (similarity + 1) / 2;
}

/**
 * Calculate average embedding from multiple embeddings
 */
function calculateAverageEmbedding(embeddings: number[][]): number[] | null {
  if (embeddings.length === 0) return null;
  if (embeddings.length === 1) return embeddings[0]!;

  const dimension = embeddings[0]!.length;
  const avgEmbedding = new Array(dimension).fill(0);

  for (const emb of embeddings) {
    if (emb.length !== dimension) continue;
    for (let i = 0; i < dimension; i++) {
      avgEmbedding[i] += emb[i]!;
    }
  }

  for (let i = 0; i < dimension; i++) {
    avgEmbedding[i] /= embeddings.length;
  }

  return avgEmbedding;
}

/**
 * Common stop words to filter out
 */
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "may",
  "might",
  "must",
  "can",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "where",
  "when",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "now",
]);

/**
 * Extract meaningful keywords from message content
 */
function extractKeywords(content: string): Set<string> {
  if (!content || content.trim().length === 0) return new Set();

  const keywords = new Set<string>();

  // First, extract keywords from URLs before removing them
  const urlMatches = content.match(/https?:\/\/([^\s]+)/g);
  if (urlMatches) {
    for (const url of urlMatches) {
      // Extract meaningful words from URL path and query parameters
      const urlPath = url.replace(/https?:\/\/[^\/]+/, ""); // Remove domain
      const urlWords = urlPath
        .split(/[\/\?&#=_-]+/) // Split on URL separators
        .map((segment) => segment.toLowerCase())
        .filter(
          (segment) =>
            segment.length >= 2 &&
            !STOP_WORDS.has(segment) &&
            !/^\d+$/.test(segment) &&
            !/^[a-z0-9]{20,}$/i.test(segment) // Skip long hex/IDs
        );
      urlWords.forEach((word) => keywords.add(word));
    }
  }

  // Remove URLs, mentions, and special characters from main content
  const cleaned = content
    .replace(/https?:\/\/[^\s]+/g, "") // Remove URLs
    .replace(/<@!?\d+>/g, "") // Remove mentions
    .replace(/<#[!]?\d+>/g, "") // Remove channel mentions
    .replace(/<@&\d+>/g, "") // Remove role mentions
    .replace(/[^\w\s]/g, " ") // Replace special chars with spaces
    .toLowerCase();

  // Split into words and filter
  const words = cleaned
    .split(/\s+/)
    .filter(
      (word) => word.length >= 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)
    );

  words.forEach((word) => keywords.add(word));

  return keywords;
}

/**
 * Calculate topic overlap between two messages using Jaccard similarity of keywords
 * Accepts either Message objects (uses cached keywords) or strings (extracts keywords)
 */
function calculateTopicOverlap(
  msg1: Message | string,
  msg2: Message | string
): number {
  const keywords1 =
    typeof msg1 === "string"
      ? extractKeywords(msg1)
      : msg1.keywords || extractKeywords(msg1.content || "");
  const keywords2 =
    typeof msg2 === "string"
      ? extractKeywords(msg2)
      : msg2.keywords || extractKeywords(msg2.content || "");

  if (keywords1.size === 0 && keywords2.size === 0) return 0;
  if (keywords1.size === 0 || keywords2.size === 0) return 0;

  // Calculate intersection
  let intersection = 0;
  for (const word of keywords1) {
    if (keywords2.has(word)) {
      intersection++;
    }
  }

  // Calculate union
  const union = keywords1.size + keywords2.size - intersection;

  // Jaccard similarity
  const jaccard = union > 0 ? intersection / union : 0;

  return jaccard;
}

async function testConversationMapping() {
  const db = new PostgreSQLManager();

  try {
    await db.connect();

    AnalysisFormatter.section("CONVERSATION MAPPING - 24 HOUR VIEW", 100);

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
				m.embedding,
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

    const allMessages = messagesResult.data.map((m) => {
      let embedding: number[] | undefined;
      if (m.embedding) {
        // Parse pgvector format: "[1,2,3]" -> [1,2,3]
        if (typeof m.embedding === "string") {
          const cleanedEmbedding = m.embedding.replace(/^\[|\]$/g, "");
          embedding = cleanedEmbedding.split(",").map(Number);
        } else if (Array.isArray(m.embedding)) {
          embedding = m.embedding;
        }
      }

      const content = m.content || "";

      return {
        id: m.id,
        author_id: m.author_id,
        author_name:
          m.display_name || m.username || m.author_id.substring(0, 8),
        content: content,
        created_at: new Date(m.created_at),
        referenced_message_id: m.referenced_message_id,
        embedding,
        keywords: extractKeywords(content), // Pre-compute keywords for performance
      };
    }) as Message[];

    // Log warning if no embeddings found
    const embeddingCount = allMessages.filter((m) => m.embedding).length;
    if (embeddingCount === 0) {
      AnalysisFormatter.warning(
        "No embeddings found for messages. Semantic similarity will not be available."
      );
    }

    if (allMessages.length === 0) {
      AnalysisFormatter.warning("No messages found in the last 24 hours");
      await db.disconnect();
      return;
    }

    // Build relationship context for grouping
    const uniqueAuthors = new Set(allMessages.map((m) => m.author_id));
    const relationshipContext = await buildRelationshipContext(
      Array.from(uniqueAuthors),
      GUILD_ID,
      cutoffTime,
      db,
      allMessages
    );

    // Group messages into conversations
    const conversations = groupMessagesWithRelationships(
      allMessages,
      relationshipContext
    );

    // Create a map of message ID to conversation number
    // Conversations are numbered starting from 1, orphaned messages show 0
    const messageToConversation = new Map<string, number>();
    conversations.forEach((conv, index) => {
      conv.messageIds.forEach((msgId) => {
        messageToConversation.set(msgId, index + 1); // Start from 1 instead of 0
      });
    });

    // Display summary
    const groupedMessageIds = new Set<string>();
    for (const convo of conversations) {
      for (const msgId of convo.messageIds) {
        groupedMessageIds.add(msgId);
      }
    }
    const orphanedCount = allMessages.filter(
      (m) => !groupedMessageIds.has(m.id)
    ).length;

    console.log("│");
    AnalysisFormatter.metric("Total Messages", allMessages.length.toString());
    AnalysisFormatter.metric(
      "Conversations Detected",
      conversations.length.toString()
    );
    AnalysisFormatter.metric("Orphaned Messages", orphanedCount.toString());
    console.log("│");

    AnalysisFormatter.subsection("Messages in Chronological Order", 98);

    for (const msg of allMessages) {
      const timestamp = msg.created_at.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const date = msg.created_at.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      const maxContentLength = 120;
      const content =
        msg.content.length > maxContentLength
          ? msg.content.substring(0, maxContentLength) + "..."
          : msg.content || "(no content)";

      const replyIndicator = msg.referenced_message_id ? "↪ " : "";

      // Get conversation number for this message
      const convNum = messageToConversation.get(msg.id);
      const convDisplay = convNum !== undefined ? convNum : 0;

      console.log(
        `│ ${convDisplay} [${date} ${timestamp}] ${replyIndicator}${msg.author_name}: ${content}`
      );
    }

    AnalysisFormatter.subsectionEnd(98);

    // Summary statistics
    AnalysisFormatter.subsection("Summary", 98);
    console.log("│");
    console.log(`│  Total Messages: ${allMessages.length}`);
    console.log(`│  Grouped into Conversations: ${conversations.length}`);
    console.log(`│  Orphaned Messages: ${orphanedCount}`);
    console.log(
      `│  Coverage: ${(
        ((allMessages.length - orphanedCount) / allMessages.length) *
        100
      ).toFixed(1)}%`
    );
    console.log("│");

    if (conversations.length > 0) {
      const avgMessages =
        conversations.reduce((sum, c) => sum + c.messageIds.size, 0) /
        conversations.length;
      const multiParty = conversations.filter(
        (c) => c.participants.size >= 3
      ).length;
      console.log(
        `│  Avg Messages per Conversation: ${avgMessages.toFixed(1)}`
      );
      console.log(`│  Multi-Party Conversations (3+): ${multiParty}`);
    }

    AnalysisFormatter.subsectionEnd(98);

    AnalysisFormatter.success("Display complete!");

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
    const recentContext = recentMessages.filter((m) => {
      const deltaMs = Math.abs(
        m.created_at.getTime() - msg.created_at.getTime()
      );
      return deltaMs < 5 * 60 * 1000 && m.author_id !== msg.author_id; // 5 min window
    });

    for (const contextMsg of recentContext) {
      if (!conversationalBoosts.has(msg.author_id)) {
        conversationalBoosts.set(msg.author_id, new Map());
      }

      const currentBoost =
        conversationalBoosts.get(msg.author_id)?.get(contextMsg.author_id) || 0;

      // Boost decays with time: max 1.0 for <5min, decays to 0 at 30min
      const decayFactor = Math.max(
        0,
        1 - timeSinceMessage / conversationalWindow
      );
      const boost = decayFactor * 0.3; // Max 0.3 per interaction

      conversationalBoosts
        .get(msg.author_id)
        ?.set(contextMsg.author_id, currentBoost + boost);
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
      const historicalAffinity =
        rawPoints > 0 ? Math.min(1.0, Math.log10(rawPoints + 1) / 3) : 0;

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
        if (
          !lastInteractions.has(userA) ||
          lastInteractions.get(userA)! < lastInteraction
        ) {
          lastInteractions.set(userA, lastInteraction);
        }
        if (
          !lastInteractions.has(userB) ||
          lastInteractions.get(userB)! < lastInteraction
        ) {
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
 * Group messages using relationship-aware scoring
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
      targetConvo = conversations.find((c) =>
        c.messageIds.has(msg.referenced_message_id!)
      );

      // If no conversation exists, find the referenced message and create a conversation
      if (!targetConvo) {
        const referencedMsg = messages.find(
          (m) => m.id === msg.referenced_message_id
        );
        if (referencedMsg) {
          // Create new conversation from reply chain
          targetConvo = {
            id: `conv_${referencedMsg.id}`,
            participants: new Set([referencedMsg.author_id, msg.author_id]),
            messageIds: new Set([referencedMsg.id, msg.id]),
            startTime: referencedMsg.created_at,
            endTime: msg.created_at,
            avgAffinity: 0,
            messages: [referencedMsg, msg],
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
      if (!targetConvo.messages) targetConvo.messages = [];
      targetConvo.messages.push(msg);
      processedMessages.add(msg.id);
    }
  }

  // Constants for enhanced grouping
  const BASE_EXTEND_MINUTES = 45; // Increased from 20 to reduce fragmentation
  const RECENT_MESSAGES_WINDOW = 5;
  const TOPIC_SHIFT_THRESHOLD = 0.05; // Relaxed from 0.1 to allow more topic drift
  const TOPIC_SHIFT_TIME_MINUTES = 60; // Increased from 30 to reduce premature splits
  const MIN_CONVERSATION_DURATION_MINUTES = 15; // New: Don't split conversations younger than this

  // Group remaining messages with enhanced scoring: relationship + semantic + topic
  for (const msg of messages) {
    if (processedMessages.has(msg.id)) continue;

    // Check for mentions that might connect to existing conversations
    const mentionMatches = msg.content.match(/<@!?(\d+)>/g);
    const mentionedIds = mentionMatches
      ? mentionMatches.map((m) => m.replace(/<@!?(\d+)>/, "$1"))
      : [];

    let bestScore = 0;
    let bestConvo: ConversationGroup | null = null;
    let bestMaxAffinity = 0;

    // Debug flag for specific messages
    const isDebugMessage = false; // msg.content.toLowerCase().includes('only pee');

    for (const convo of conversations) {
      // Calculate time since conversation end (in minutes)
      const timeDelta = msg.created_at.getTime() - convo.endTime.getTime();
      const timeSinceEnd = timeDelta / (1000 * 60);

      // Allow messages slightly before conversation start (within 5 minutes)
      const timeSinceStart =
        (msg.created_at.getTime() - convo.startTime.getTime()) / (1000 * 60);
      if (timeSinceStart < -5) {
        continue; // Message is too far before conversation
      }

      // Special handling for empty content (images/attachments)
      // These should strongly prefer joining active conversations with same author
      const isEmptyContent = !msg.content || msg.content.trim().length === 0;
      if (
        isEmptyContent &&
        convo.participants.has(msg.author_id) &&
        timeSinceEnd <= 10
      ) {
        // Empty messages from same participant within 10 min should join automatically
        bestScore = 1.0; // Override with maximum score
        bestConvo = convo;
        break; // Don't check other conversations
      }

      // Check if message mentions a participant (strong signal)
      const mentionsParticipant = mentionedIds.some((id) =>
        convo.participants.has(id)
      );

      // Check if this message replies to someone in the conversation (very strong signal)
      const repliesToParticipant =
        msg.referenced_message_id &&
        convo.messageIds.has(msg.referenced_message_id);

      // Check if author is already a participant
      const isParticipant = convo.participants.has(msg.author_id);
      const participantOverlap = isParticipant ? 1 : 0;
      const sameAuthor = isParticipant;

      // Calculate relationship score (affinity matrix)
      let maxAffinity = 0;
      for (const participantId of convo.participants) {
        if (participantId === msg.author_id) continue;

        const affinity = context.affinityMatrix
          .get(msg.author_id)
          ?.get(participantId);
        if (affinity && affinity.combined > maxAffinity) {
          maxAffinity = affinity.combined;
        }
      }

      // Calculate semantic similarity (if embeddings available)
      let semanticScore = 0;
      if (msg.embedding && convo.messages && convo.messages.length > 0) {
        const convEmbeddings = convo.messages
          .map((m) => m.embedding)
          .filter((emb): emb is number[] => emb !== undefined);

        if (convEmbeddings.length > 0) {
          const avgEmbedding = calculateAverageEmbedding(convEmbeddings);
          if (avgEmbedding) {
            semanticScore = calculateCosineSimilarity(
              msg.embedding,
              avgEmbedding
            );
          }
        }
      }

      // Calculate topic overlap
      let topicScore = 0;
      let recentTopicScore = 0;
      let overallTopicScore = 0;
      let isTopicShift = false;

      // Debug for specific messages
      if (isDebugMessage) {
        console.log(
          `\n🔍 DEBUG: Message "${msg.content}" checking against conversation ${convo.id}`
        );
        console.log(`   Time since end: ${timeSinceEnd.toFixed(1)} minutes`);
        console.log(`   Semantic score: ${semanticScore.toFixed(3)}`);
      }

      if (convo.messages && convo.messages.length > 0) {
        const recentMessages = convo.messages.slice(-RECENT_MESSAGES_WINDOW);
        const allMessages = convo.messages;

        // Check overlap with original topic (first few messages) for drift detection
        const originalMessages = convo.messages.slice(
          0,
          Math.min(5, Math.floor(convo.messages.length / 3))
        );
        if (originalMessages.length > 0 && timeSinceEnd > 60) {
          let originalMaxOverlap = 0;
          let originalWeightedOverlap = 0;
          for (const origMsg of originalMessages) {
            const overlap = calculateTopicOverlap(msg, origMsg); // Use Message objects
            originalWeightedOverlap += overlap;
            if (overlap > originalMaxOverlap) {
              originalMaxOverlap = overlap;
            }
          }
          const originalTopicScore =
            originalWeightedOverlap / originalMessages.length;

          // If message has low overlap with original topic but conversation is large, it's likely a topic shift
          if (
            originalTopicScore > 0 &&
            convo.messages.length > 10 &&
            timeSinceEnd > 30
          ) {
            if (originalTopicScore < 0.15) {
              isTopicShift = true;
            }
          }
        }

        // Calculate overlap with recent messages (primary signal)
        let recentMaxOverlap = 0;
        let recentWeightedOverlap = 0;
        let recentTotalWeight = 0;

        for (let i = 0; i < recentMessages.length; i++) {
          const convMsg = recentMessages[i]!;
          const overlap = calculateTopicOverlap(msg, convMsg); // Use Message objects
          recentWeightedOverlap += overlap;
          recentTotalWeight += 1;
          if (overlap > recentMaxOverlap) {
            recentMaxOverlap = overlap;
          }
        }

        recentTopicScore =
          recentTotalWeight > 0
            ? recentWeightedOverlap / recentTotalWeight
            : recentMaxOverlap;
        if (recentMaxOverlap > 0.2) {
          recentTopicScore = Math.max(recentTopicScore, recentMaxOverlap * 0.8);
        }

        // Calculate overlap with all messages (fallback/context)
        let overallMaxOverlap = 0;
        let overallWeightedOverlap = 0;
        let overallTotalWeight = 0;

        for (let i = 0; i < allMessages.length; i++) {
          const convMsg = allMessages[i]!;
          const overlap = calculateTopicOverlap(msg, convMsg); // Use Message objects

          // Weight recent messages more (last 10 messages get full weight, older get 0.5x)
          const weight = i >= allMessages.length - 10 ? 1.0 : 0.5;
          overallWeightedOverlap += overlap * weight;
          overallTotalWeight += weight;

          if (overlap > overallMaxOverlap) {
            overallMaxOverlap = overlap;
          }
        }

        overallTopicScore =
          overallTotalWeight > 0
            ? overallWeightedOverlap / overallTotalWeight
            : overallMaxOverlap;
        if (overallMaxOverlap > 0.2) {
          overallTopicScore = Math.max(
            overallTopicScore,
            overallMaxOverlap * 0.8
          );
        }

        // Detect topic shift using keyword overlap analysis
        const msgKeywords = extractKeywords(msg.content);
        let recentHasDifferentTopic = false;

        if (msgKeywords.size > 0 && recentMessages.length > 0) {
          // Collect all keywords from recent messages
          const recentKeywords = new Set<string>();
          for (const recentMsg of recentMessages) {
            const keywords = extractKeywords(recentMsg.content);
            keywords.forEach((k) => recentKeywords.add(k));
          }

          // Calculate keyword overlap
          let keywordIntersection = 0;
          for (const keyword of msgKeywords) {
            if (recentKeywords.has(keyword)) {
              keywordIntersection++;
            }
          }

          const keywordUnion =
            msgKeywords.size + recentKeywords.size - keywordIntersection;
          const keywordOverlap =
            keywordUnion > 0 ? keywordIntersection / keywordUnion : 0;

          // If keyword overlap is very low and time gap is significant, it's likely a topic shift
          if (
            keywordOverlap < 0.1 &&
            timeSinceEnd > 15 &&
            msgKeywords.size >= 2
          ) {
            recentHasDifferentTopic = true;
          }
        }

        // More aggressive topic shift detection
        // BUT don't mark as shift if semantic similarity is strong (handles pee/poop case)
        const semanticallyRelated = semanticScore > 0.6;
        if (
          recentTopicScore < TOPIC_SHIFT_THRESHOLD &&
          timeSinceEnd > TOPIC_SHIFT_TIME_MINUTES &&
          !semanticallyRelated
        ) {
          isTopicShift = true;
        }
        if (
          recentTopicScore < 0.05 &&
          timeSinceEnd > 15 &&
          !semanticallyRelated
        ) {
          isTopicShift = true;
        }
        if (recentHasDifferentTopic && !semanticallyRelated) {
          isTopicShift = true;
        }

        // Use recent topic score as primary, overall as fallback
        topicScore = recentTopicScore * 0.4 + overallTopicScore * 0.2;

        // Boost for same author with topic overlap (if not a topic shift)
        if (sameAuthor && overallMaxOverlap > 0.05 && !isTopicShift) {
          topicScore = Math.max(topicScore, overallMaxOverlap * 1.2);
        }
      }

      // Debug output for topic scores
      if (isDebugMessage) {
        console.log(`   Recent topic score: ${recentTopicScore.toFixed(3)}`);
        console.log(`   Overall topic score: ${overallTopicScore.toFixed(3)}`);
        console.log(`   Is topic shift: ${isTopicShift}`);
        console.log(
          `   Last 5 conv messages: ${convo.messages
            ?.slice(-5)
            .map((m) => m.content.substring(0, 50))
            .join(" | ")}`
        );
      }

      // Define semantic link threshold (used in multiple checks below)
      const hasStrongSemanticLink = semanticScore > 0.6;

      // Check overlap with original topic in larger conversations
      // BUT allow if semantic similarity is strong (handles pee/poop case)
      if (
        convo.messages &&
        convo.messages.length > 5 &&
        timeSinceEnd > 20 &&
        !hasStrongSemanticLink
      ) {
        const originalMessages = convo.messages.slice(
          0,
          Math.min(5, Math.floor(convo.messages.length / 2))
        );
        if (originalMessages.length > 0) {
          let originalOverlap = 0;
          let originalMaxOverlap = 0;
          for (const origMsg of originalMessages) {
            const overlap = calculateTopicOverlap(msg, origMsg); // Use Message objects
            originalOverlap += overlap;
            if (overlap > originalMaxOverlap) {
              originalMaxOverlap = overlap;
            }
          }
          const avgOriginalOverlap = originalOverlap / originalMessages.length;

          if (isDebugMessage) {
            console.log(
              `   Original topic check: avgOverlap=${avgOriginalOverlap.toFixed(
                3
              )}, maxOverlap=${originalMaxOverlap.toFixed(
                3
              )}, hasStrongSemanticLink=${hasStrongSemanticLink}`
            );
          }

          // Relaxed thresholds to allow natural topic evolution
          if (avgOriginalOverlap < 0.08 && originalMaxOverlap < 0.12) {
            if (isDebugMessage)
              console.log(
                `   ❌ REJECTED: avgOriginalOverlap (${avgOriginalOverlap.toFixed(
                  3
                )}) < 0.08 && originalMaxOverlap (${originalMaxOverlap.toFixed(
                  3
                )}) < 0.12`
              );
            continue; // Doesn't match original topic
          }
          if (
            avgOriginalOverlap < 0.12 &&
            originalMaxOverlap < 0.18 &&
            timeSinceEnd > 60
          ) {
            if (isDebugMessage)
              console.log(
                `   ❌ REJECTED: avgOriginalOverlap (${avgOriginalOverlap.toFixed(
                  3
                )}) < 0.12 && originalMaxOverlap (${originalMaxOverlap.toFixed(
                  3
                )}) < 0.18 && timeSinceEnd > 60`
              );
            continue; // Doesn't match original topic and too much time passed
          }
        }
      }

      // Calculate conversation density (messages per minute)
      let conversationDensity = 0;
      if (convo.messages && convo.messages.length > 1) {
        const convDurationMs =
          convo.endTime.getTime() - convo.startTime.getTime();
        const convDurationMin = convDurationMs / (1000 * 60);
        if (convDurationMin > 0) {
          conversationDensity = convo.messages.length / convDurationMin;
        }
      }
      const isHighDensity = conversationDensity > 0.5; // More than 1 message per 2 minutes

      // Dynamic time window based on semantic similarity, topic overlap, and conversation density
      // Priority-based logic ensures strongest signals take precedence
      let extendWindow = BASE_EXTEND_MINUTES;

      if (isTopicShift) {
        extendWindow = BASE_EXTEND_MINUTES;
      } else {
        // Priority order: same author > semantic similarity > topic overlap
        if (sameAuthor && recentTopicScore > 0.05) {
          extendWindow = 180; // Same author continuing topic (highest priority)
        } else if (semanticScore > 0.7) {
          extendWindow = 120; // High semantic similarity
        } else if (semanticScore > 0.6) {
          extendWindow = 90; // Medium-high semantic similarity (e.g., pee/poop)
        } else if (semanticScore > 0.5) {
          extendWindow = 70; // Medium semantic similarity
        } else if (recentTopicScore > 0.2) {
          extendWindow = 120; // Good topic overlap
        } else if (recentTopicScore > 0.1) {
          extendWindow = 60; // Some topic overlap
        } else if (recentTopicScore > 0.05) {
          extendWindow = 40; // Minimal topic overlap
        }

        // Check for rapid-fire conversation (multiple messages within 3 minutes)
        const isRapidFire =
          convo.messages && convo.messages.length >= 3 && timeSinceEnd <= 3; // Within 3 minutes of last message
        if (isRapidFire) {
          extendWindow = Math.max(extendWindow, 120); // At least 2 hours for rapid-fire bursts
        }

        // Extend window for high-density conversations (active chats)
        if (isHighDensity) {
          extendWindow = Math.max(extendWindow, 90); // At least 90 min for active conversations
        }
      }

      // Check if message is within dynamic extension window
      if (timeSinceEnd > extendWindow) {
        if (isDebugMessage)
          console.log(
            `   ❌ REJECTED: timeSinceEnd (${timeSinceEnd.toFixed(
              1
            )}) > extendWindow (${extendWindow})`
          );
        continue; // Too far in time
      }

      if (isDebugMessage) {
        console.log(
          `   ✅ PASSED time window check (extend window: ${extendWindow} min)`
        );
      }

      // Calculate time score
      const timeScore = Math.max(0, 1 - timeSinceEnd / extendWindow);

      // Enhanced scoring formula: relationship + temporal + semantic + topic
      // Reweighted to prioritize semantic similarity over keyword-based topic matching
      // Base score normalized to 0-1 range
      let baseScore =
        maxAffinity * 0.2 + // Relationship matrix (reduced from 0.25)
        timeScore * 0.1 + // Time proximity
        semanticScore * 0.4 + // Semantic similarity (increased from 0.25)
        recentTopicScore * 0.2 + // Recent topic coherence (reduced from 0.30)
        overallTopicScore * 0.1; // Overall topic overlap // Sums to 1.0

      // Apply multiplicative bonuses (keeps score in reasonable range)
      let scoreMultiplier = 1.0;

      // Interaction bonuses
      if (repliesToParticipant) scoreMultiplier *= 1.5; // 50% boost - very strong signal
      if (mentionsParticipant) scoreMultiplier *= 1.15; // 15% boost
      if (isParticipant) scoreMultiplier *= 1.1; // 10% boost

      // Participant pair continuity bonus (2-person conversations)
      // When the EXACT same 2 participants are conversing, keep them together
      const isExactPairMatch =
        convo.participants.size === 2 &&
        convo.participants.has(msg.author_id) &&
        timeSinceEnd <= 15; // 15 min window for pairs
      if (isExactPairMatch) {
        scoreMultiplier *= 1.4; // Strong 40% boost for 2-person continuity
      }

      // Participant continuity bonus: if same 2-3 participants are active within time window
      // This prevents fragmentation of continuous conversations between same people
      if (
        convo.participants.size <= 3 &&
        convo.participants.has(msg.author_id)
      ) {
        // Check if conversation has been active recently (within 45 min)
        const conversationActiveRecently = timeSinceEnd <= 45;
        if (conversationActiveRecently) {
          scoreMultiplier *= 1.25; // 25% boost for participant continuity
        }
      }

      baseScore *= scoreMultiplier;

      // Penalties for topic divergence (multiplicative to preserve scale)
      // BUT don't penalize if semantic similarity is strong (e.g., pee/poop)
      if (
        recentTopicScore < 0.1 &&
        timeSinceEnd > 15 &&
        !hasStrongSemanticLink
      ) {
        baseScore *= 0.1;
      }
      if (isTopicShift) {
        baseScore *= 0.05;
      }

      // Boost for strong signals (only if not topic shift)
      if (!isTopicShift) {
        if (sameAuthor && topicScore > 0.1) {
          baseScore *= 1.3;
        }
        if (mentionsParticipant) {
          baseScore *= 1.2;
        }
      }

      if (isDebugMessage) {
        console.log(
          `   Base score: ${baseScore.toFixed(
            3
          )}, Best score so far: ${bestScore.toFixed(3)}`
        );
      }

      if (baseScore > bestScore) {
        bestScore = baseScore;
        bestConvo = convo;
        bestMaxAffinity = maxAffinity;
        if (isDebugMessage) {
          console.log(`   ✅ NEW BEST! Conversation ${convo.id}`);
        }
      }
    }

    // Lower threshold but consider semantic/topic alternatives to interaction signals
    const hasStrongSignal =
      bestConvo &&
      (mentionedIds.some((id) => bestConvo!.participants.has(id)) ||
        bestConvo.participants.has(msg.author_id));

    const hasGoodRelationship = bestConvo && bestMaxAffinity > 0.3;
    const hasHighScore = bestScore > 0.35; // Lowered from 0.45 to account for multiplicative bonuses

    // Check if best conversation has strong semantic link
    let hasStrongSemanticLinkToBest = false;
    if (
      bestConvo &&
      msg.embedding &&
      bestConvo.messages &&
      bestConvo.messages.length > 0
    ) {
      const convEmbeddings = bestConvo.messages
        .map((m) => m.embedding)
        .filter((emb): emb is number[] => emb !== undefined);
      if (convEmbeddings.length > 0) {
        const avgEmbedding = calculateAverageEmbedding(convEmbeddings);
        if (avgEmbedding) {
          const semanticSim = calculateCosineSimilarity(
            msg.embedding,
            avgEmbedding
          );
          hasStrongSemanticLinkToBest = semanticSim > 0.6;
        }
      }
    }

    // Check if bestConvo is a small group (2 participants) with current author
    const isSameSmallGroup =
      bestConvo &&
      bestConvo.participants.size <= 2 &&
      bestConvo.participants.has(msg.author_id);

    // Threshold: stricter without strong interaction signals
    // Adjusted for multiplicative bonuses (scores are now higher)
    // BUT lower threshold if semantic similarity is strong (e.g., pee/poop)
    // Special lower threshold for 2-person conversations to prevent fragmentation
    const threshold = hasStrongSignal
      ? 0.15 // Lowered from 0.2
      : isSameSmallGroup
      ? 0.12 // NEW: lower for pairs (prevents Conv 1-2, 3-4-5 splits)
      : hasStrongSemanticLinkToBest
      ? 0.2 // Lowered from 0.25
      : hasGoodRelationship && hasHighScore
      ? 0.3
      : 0.4; // Lowered from 0.35/0.5

    if (isDebugMessage) {
      console.log(`\n📊 FINAL DECISION for "${msg.content}"`);
      console.log(
        `   Best score: ${bestScore.toFixed(3)}, Threshold: ${threshold.toFixed(
          3
        )}`
      );
      console.log(
        `   Has strong signal: ${hasStrongSignal}, Has good relationship: ${hasGoodRelationship}`
      );
      console.log(
        `   Will add to ${bestConvo?.id}: ${
          bestScore > threshold && bestConvo ? "YES" : "NO"
        }`
      );
    }

    if (bestScore > threshold && bestConvo) {
      bestConvo.messageIds.add(msg.id);
      bestConvo.participants.add(msg.author_id);
      bestConvo.endTime = msg.created_at;
      if (!bestConvo.messages) bestConvo.messages = [];
      bestConvo.messages.push(msg);
      processedMessages.add(msg.id);
      if (isDebugMessage) {
        console.log(`   ✅ ADDED to conversation ${bestConvo.id}`);
      }
    } else {
      if (isDebugMessage) {
        console.log(`   ❌ NOT ADDED - score too low or no best conversation`);
      }
      // Check if this message mentions someone and that person responds later
      if (mentionedIds.length > 0) {
        const responseWindow = 5 * 60 * 1000;
        const hasResponse = messages.some(
          (m) =>
            m.created_at > msg.created_at &&
            m.created_at.getTime() - msg.created_at.getTime() <=
              responseWindow &&
            mentionedIds.includes(m.author_id)
        );

        if (hasResponse) {
          const newConvo: ConversationGroup = {
            id: `conv_${msg.id}`,
            participants: new Set([msg.author_id, ...mentionedIds]),
            messageIds: new Set([msg.id]),
            startTime: msg.created_at,
            endTime: msg.created_at,
            avgAffinity: 0,
            messages: [msg],
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
        .map((id) => messages.find((m) => m.id === id))
        .filter((m): m is Message => m !== undefined)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0];

      if (!firstConvoMsg) continue;

      const mentionMatches = firstConvoMsg.content.match(/<@!?(\d+)>/g);
      if (!mentionMatches) continue; // Skip if conversation wasn't created from a mention

      const mentionedIds = mentionMatches.map((m) =>
        m.replace(/<@!?(\d+)>/, "$1")
      );

      // Check if this message author was mentioned in the FIRST message of the conversation
      // AND the message is a direct response (within 5 min, and author is the mentioned person)
      if (mentionedIds.includes(msg.author_id)) {
        const timeDelta =
          msg.created_at.getTime() - firstConvoMsg.created_at.getTime();
        if (timeDelta > 0 && timeDelta <= 5 * 60 * 1000) {
          // This is a response to the original mention within 5 minutes
          convo.messageIds.add(msg.id);
          convo.participants.add(msg.author_id);
          convo.endTime = msg.created_at;
          if (!convo.messages) convo.messages = [];
          convo.messages.push(msg);
          processedMessages.add(msg.id);
          break;
        }
      }
    }
  }

  // Fourth pass: Group orphaned messages with high topic similarity into new conversations
  const orphanedMessages = messages.filter((m) => !processedMessages.has(m.id));

  for (const msg of orphanedMessages) {
    if (processedMessages.has(msg.id)) continue;

    // Try to find other orphaned messages with high topic overlap within a time window
    const TIME_WINDOW_FOR_ORPHANS = 240; // 4 hours (increased from 3 to capture more orphans)
    const candidateMessages: Message[] = [];

    for (const otherMsg of orphanedMessages) {
      if (otherMsg.id === msg.id) continue;
      if (processedMessages.has(otherMsg.id)) continue;

      const timeDelta =
        Math.abs(msg.created_at.getTime() - otherMsg.created_at.getTime()) /
        (1000 * 60);
      if (timeDelta > TIME_WINDOW_FOR_ORPHANS) continue;

      // Calculate topic overlap using cached keywords
      const topicOverlap = calculateTopicOverlap(msg, otherMsg);

      // Also check semantic similarity if embeddings available
      let semanticSimilarity = 0;
      if (msg.embedding && otherMsg.embedding) {
        semanticSimilarity = calculateCosineSimilarity(
          msg.embedding,
          otherMsg.embedding
        );
      }

      // Check if same author
      const sameAuthor = msg.author_id === otherMsg.author_id;

      // Lower thresholds for same-author orphans, or high topic/semantic similarity
      // Same author within 15 min, or good topic/semantic match
      if (
        (sameAuthor && timeDelta <= 15) ||
        topicOverlap > 0.15 ||
        semanticSimilarity > 0.45
      ) {
        candidateMessages.push(otherMsg);
      }
    }

    // If we found at least one other message with high topic overlap, create a conversation
    if (candidateMessages.length >= 1) {
      // Create new conversation with this message and candidates
      const newConvo: ConversationGroup = {
        id: `conv_orphan_${msg.id}`,
        participants: new Set([msg.author_id]),
        messageIds: new Set([msg.id]),
        startTime: msg.created_at,
        endTime: msg.created_at,
        avgAffinity: 0,
        messages: [msg],
      };

      // Add candidate messages
      for (const candidate of candidateMessages) {
        newConvo.messageIds.add(candidate.id);
        newConvo.participants.add(candidate.author_id);
        if (candidate.created_at < newConvo.startTime) {
          newConvo.startTime = candidate.created_at;
        }
        if (candidate.created_at > newConvo.endTime) {
          newConvo.endTime = candidate.created_at;
        }
        if (!newConvo.messages) newConvo.messages = [];
        newConvo.messages.push(candidate);
        processedMessages.add(candidate.id);
      }

      // Sort messages by timestamp
      if (newConvo.messages) {
        newConvo.messages.sort(
          (a, b) => a.created_at.getTime() - b.created_at.getTime()
        );
      }

      conversations.push(newConvo);
      processedMessages.add(msg.id);
    }
  }

  // Conversation merging pass: merge semantically similar conversations
  const MERGE_TIME_WINDOW_MINUTES = 180; // Increased from 120 to allow longer merge windows
  const SEMANTIC_MERGE_THRESHOLD = 0.5;
  const TOPIC_MERGE_THRESHOLD = 0.15;

  let merged = true;
  while (merged) {
    merged = false;

    for (let i = 0; i < conversations.length; i++) {
      const convoA = conversations[i]!;

      for (let j = i + 1; j < conversations.length; j++) {
        const convoB = conversations[j]!;

        // Check time proximity - conversations should be within time window
        const timeGap =
          Math.abs(convoA.startTime.getTime() - convoB.startTime.getTime()) /
          (1000 * 60);
        if (timeGap > MERGE_TIME_WINDOW_MINUTES) continue;

        // Calculate participant overlap
        let participantOverlap = 0;
        for (const participant of convoA.participants) {
          if (convoB.participants.has(participant)) {
            participantOverlap++;
          }
        }
        const participantOverlapRatio =
          participantOverlap /
          Math.max(convoA.participants.size, convoB.participants.size);

        // Check for exact participant match (same people in both conversations)
        const sameParticipants =
          convoA.participants.size === convoB.participants.size &&
          [...convoA.participants].every((p) => convoB.participants.has(p));

        // Calculate semantic similarity between conversations
        let semanticSimilarity = 0;
        if (
          convoA.messages &&
          convoB.messages &&
          convoA.messages.length > 0 &&
          convoB.messages.length > 0
        ) {
          const embeddingsA = convoA.messages
            .map((m) => m.embedding)
            .filter((emb): emb is number[] => emb !== undefined);
          const embeddingsB = convoB.messages
            .map((m) => m.embedding)
            .filter((emb): emb is number[] => emb !== undefined);

          if (embeddingsA.length > 0 && embeddingsB.length > 0) {
            const avgEmbeddingA = calculateAverageEmbedding(embeddingsA);
            const avgEmbeddingB = calculateAverageEmbedding(embeddingsB);

            if (avgEmbeddingA && avgEmbeddingB) {
              semanticSimilarity = calculateCosineSimilarity(
                avgEmbeddingA,
                avgEmbeddingB
              );
            }
          }
        }

        // Calculate topic overlap between conversations
        let topicOverlap = 0;
        if (
          convoA.messages &&
          convoB.messages &&
          convoA.messages.length > 0 &&
          convoB.messages.length > 0
        ) {
          let totalOverlap = 0;
          let maxOverlap = 0;
          let comparisons = 0;

          // Compare first few messages from each conversation
          const sampleA = convoA.messages.slice(
            0,
            Math.min(5, convoA.messages.length)
          );
          const sampleB = convoB.messages.slice(
            0,
            Math.min(5, convoB.messages.length)
          );

          for (const msgA of sampleA) {
            for (const msgB of sampleB) {
              const overlap = calculateTopicOverlap(msgA, msgB); // Use Message objects
              totalOverlap += overlap;
              maxOverlap = Math.max(maxOverlap, overlap);
              comparisons++;
            }
          }

          if (comparisons > 0) {
            // Use average + max for better topic overlap assessment
            const avgOverlap = totalOverlap / comparisons;
            topicOverlap = avgOverlap * 0.6 + maxOverlap * 0.4;
          }
        }

        // Merge if: same participants (highest priority) OR semantic/topic similarity
        // Same participants within 30 min should always merge (prevents Conv 1-2, 3-4-5, 6-7-8, 13-14 splits)
        // OR good topic overlap (even without high semantic/participant)
        // This catches conversations about the same topic that were split
        const shouldMerge =
          (sameParticipants && timeGap <= 30) || // Same participants within 30 min - always merge
          (semanticSimilarity > 0.7 && topicOverlap > 0.15) || // Very high semantic + some topic
          (topicOverlap > 0.2 && timeGap <= 60) || // Good topic overlap within 1 hour
          topicOverlap > 0.3 || // High topic overlap alone
          (semanticSimilarity > 0.65 &&
            topicOverlap > 0.2 &&
            participantOverlapRatio > 0.3); // Good semantic + topic + some participants

        if (shouldMerge) {
          // Merge convoB into convoA
          for (const msgId of convoB.messageIds) {
            convoA.messageIds.add(msgId);
          }
          for (const participant of convoB.participants) {
            convoA.participants.add(participant);
          }

          // Update time bounds
          if (convoB.startTime < convoA.startTime) {
            convoA.startTime = convoB.startTime;
          }
          if (convoB.endTime > convoA.endTime) {
            convoA.endTime = convoB.endTime;
          }

          // Merge messages array
          if (convoB.messages && convoB.messages.length > 0) {
            if (!convoA.messages) convoA.messages = [];
            convoA.messages.push(...convoB.messages);
            // Sort by timestamp
            convoA.messages.sort(
              (a, b) => a.created_at.getTime() - b.created_at.getTime()
            );
          }

          // Remove convoB
          conversations.splice(j, 1);
          j--; // Adjust index after removal
          merged = true;
        }
      }
    }
  }

  // Final pass: Split conversations with clear topic shifts
  // This runs AFTER all grouping and merging to catch incorrectly merged topics
  for (const conv of conversations) {
    if (!conv.messages || conv.messages.length < 3) continue;

    // Sort messages by time
    const sortedMsgs = [...conv.messages].sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime()
    );
    const firstMsg = sortedMsgs[0]!;

    // Check for topic shifts by comparing each message to the FIRST message
    for (let i = 1; i < sortedMsgs.length; i++) {
      const currMsg = sortedMsgs[i]!;

      // Calculate topic overlap with the FIRST message in conversation
      const topicOverlap = calculateTopicOverlap(firstMsg, currMsg); // Use Message objects
      const timeDelta =
        (currMsg.created_at.getTime() - firstMsg.created_at.getTime()) /
        (1000 * 60);

      // Check semantic similarity too (e.g., pee/poop have 0 keyword overlap but high semantic similarity)
      let semanticSimilarity = 0;
      if (currMsg.embedding && firstMsg.embedding) {
        semanticSimilarity = calculateCosineSimilarity(
          currMsg.embedding,
          firstMsg.embedding
        );
      }

      // If topic overlap with original message is very low AND there's a significant time gap
      // BUT don't split if semantic similarity is strong (handles pee/poop case)
      // This is likely a topic shift - split the conversation
      // Be more conservative: only split if overlap is VERY low or time gap is VERY large
      // Also check conversation duration - don't split conversations younger than minimum duration
      const conversationDuration =
        (sortedMsgs[sortedMsgs.length - 1]!.created_at.getTime() -
          firstMsg.created_at.getTime()) /
        (1000 * 60);
      const hasStrongSemanticLink = semanticSimilarity > 0.6;
      const isConversationMature =
        conversationDuration >= MIN_CONVERSATION_DURATION_MINUTES;
      if (
        ((topicOverlap < 0.05 && timeDelta > 30) ||
          (topicOverlap < 0.08 && timeDelta > 60)) &&
        !hasStrongSemanticLink &&
        isConversationMature
      ) {
        // Create a new conversation from this point forward
        const splitMessages = sortedMsgs.slice(i);
        if (splitMessages.length >= 2) {
          const newConv: ConversationGroup = {
            id: `conv_split_${currMsg.id}`,
            participants: new Set(splitMessages.map((m) => m.author_id)),
            messageIds: new Set(splitMessages.map((m) => m.id)),
            startTime: splitMessages[0]!.created_at,
            endTime: splitMessages[splitMessages.length - 1]!.created_at,
            avgAffinity: 0,
            messages: splitMessages,
          };
          conversations.push(newConv);

          // Remove split messages from original conversation
          for (const msg of splitMessages) {
            conv.messageIds.delete(msg.id);
          }
          conv.messages = sortedMsgs.slice(0, i);
          conv.endTime = sortedMsgs[i - 1]!.created_at;

          break; // Only split once per conversation
        }
      }
    }
  }

  // Second merge pass: catch conversations split by the topic shift logic
  // More aggressive merge to recombine closely related conversations
  let finalMerged = true;
  while (finalMerged) {
    finalMerged = false;

    for (let i = 0; i < conversations.length; i++) {
      const convoA = conversations[i]!;

      for (let j = i + 1; j < conversations.length; j++) {
        const convoB = conversations[j]!;

        // Check time proximity (within 2 hours)
        const timeGap =
          Math.abs(convoA.startTime.getTime() - convoB.startTime.getTime()) /
          (1000 * 60);
        if (timeGap > 120) continue;

        // Calculate topic overlap between conversations
        let topicOverlap = 0;
        if (
          convoA.messages &&
          convoB.messages &&
          convoA.messages.length > 0 &&
          convoB.messages.length > 0
        ) {
          let totalOverlap = 0;
          let maxOverlap = 0;
          let comparisons = 0;

          const sampleA = convoA.messages.slice(
            0,
            Math.min(5, convoA.messages.length)
          );
          const sampleB = convoB.messages.slice(
            0,
            Math.min(5, convoB.messages.length)
          );

          for (const msgA of sampleA) {
            for (const msgB of sampleB) {
              const overlap = calculateTopicOverlap(msgA, msgB); // Use Message objects
              totalOverlap += overlap;
              maxOverlap = Math.max(maxOverlap, overlap);
              comparisons++;
            }
          }

          if (comparisons > 0) {
            const avgOverlap = totalOverlap / comparisons;
            topicOverlap = avgOverlap * 0.6 + maxOverlap * 0.4;
          }
        }

        // More aggressive: merge if good topic overlap within reasonable time
        if ((topicOverlap > 0.13 && timeGap <= 90) || topicOverlap > 0.3) {
          // Merge convoB into convoA
          for (const msgId of convoB.messageIds) {
            convoA.messageIds.add(msgId);
          }
          for (const participant of convoB.participants) {
            convoA.participants.add(participant);
          }

          // Update time bounds
          if (convoB.startTime < convoA.startTime) {
            convoA.startTime = convoB.startTime;
          }
          if (convoB.endTime > convoA.endTime) {
            convoA.endTime = convoB.endTime;
          }

          // Merge messages array
          if (convoB.messages && convoB.messages.length > 0) {
            if (!convoA.messages) convoA.messages = [];
            convoA.messages.push(...convoB.messages);
            convoA.messages.sort(
              (a, b) => a.created_at.getTime() - b.created_at.getTime()
            );
          }

          // Remove convoB
          conversations.splice(j, 1);
          j--;
          finalMerged = true;
        }
      }
    }
  }

  // Final pass: Fix orphaned replies
  // After all merging, some replies might be in separate conversations from their referenced messages
  // This happens when the reply chain pass created a new conversation before the referenced message was grouped
  for (let i = conversations.length - 1; i >= 0; i--) {
    const convo = conversations[i]!;
    if (!convo.messages) continue;

    for (const msg of convo.messages) {
      if (!msg.referenced_message_id) continue;

      // Find the conversation containing the referenced message
      const targetConvo = conversations.find(
        (c) => c !== convo && c.messageIds.has(msg.referenced_message_id!)
      );

      if (targetConvo) {
        // Move this reply to the target conversation
        targetConvo.messageIds.add(msg.id);
        targetConvo.participants.add(msg.author_id);
        if (!targetConvo.messages) targetConvo.messages = [];
        targetConvo.messages.push(msg);

        // Update target conversation time bounds
        if (msg.created_at > targetConvo.endTime) {
          targetConvo.endTime = msg.created_at;
        }
        if (msg.created_at < targetConvo.startTime) {
          targetConvo.startTime = msg.created_at;
        }

        // Remove from current conversation
        convo.messageIds.delete(msg.id);
        convo.messages = convo.messages.filter((m) => m.id !== msg.id);

        // If conversation becomes too small, mark for removal
        if (convo.messageIds.size < 2) {
          conversations.splice(i, 1);
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
        const affinity = context.affinityMatrix
          .get(participants[i]!)
          ?.get(participants[j]!);
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

testConversationMapping();
