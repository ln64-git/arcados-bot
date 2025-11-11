import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
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
}

interface Conversation {
	messageIds: Set<string>;
	participants: Set<string>;
	startTime: Date;
	endTime: Date;
	messages?: Message[]; // Store full message objects for semantic scoring
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
	'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
	'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
	'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
	'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
	'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
	'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
	'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'now'
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
			// URLs often have descriptive paths like /girls-poop-too-jaz-jazmine-gif
			const urlPath = url.replace(/https?:\/\/[^\/]+/, ''); // Remove domain
			const urlWords = urlPath
				.split(/[\/\?&#=_-]+/) // Split on URL separators
				.map(segment => segment.toLowerCase())
				.filter(segment => 
					segment.length >= 2 &&
					!STOP_WORDS.has(segment) &&
					!/^\d+$/.test(segment) &&
					!/^[a-z0-9]{20,}$/i.test(segment) // Skip long hex/IDs
				);
			urlWords.forEach(word => keywords.add(word));
		}
	}
	
	// Remove URLs, mentions, and special characters from main content
	const cleaned = content
		.replace(/https?:\/\/[^\s]+/g, '') // Remove URLs (but we already extracted keywords)
		.replace(/<@!?\d+>/g, '') // Remove mentions
		.replace(/<#[!]?\d+>/g, '') // Remove channel mentions
		.replace(/<@&\d+>/g, '') // Remove role mentions
		.replace(/[^\w\s]/g, ' ') // Replace special chars with spaces
		.toLowerCase();
	
	// Split into words and filter
	const words = cleaned
		.split(/\s+/)
		.filter(word => 
			word.length >= 2 && // At least 2 characters (lowered from 3 to catch "poop", "vc", etc.)
			!STOP_WORDS.has(word) && // Not a stop word
			!/^\d+$/.test(word) // Not just numbers
		);
	
	words.forEach(word => keywords.add(word));
	
	return keywords;
}

/**
 * Calculate topic overlap between two messages using Jaccard similarity of keywords
 * Also checks for strong keyword matches (like "poop") that should strongly indicate same topic
 */
function calculateTopicOverlap(msg1: string, msg2: string): number {
	const keywords1 = extractKeywords(msg1);
	const keywords2 = extractKeywords(msg2);
	
	if (keywords1.size === 0 && keywords2.size === 0) return 0;
	if (keywords1.size === 0 || keywords2.size === 0) {
		// If one message has no keywords, check if the other has strong topic words
		const allKeywords = keywords1.size > 0 ? keywords1 : keywords2;
		const strongTopicWords = ['poop', 'pooping', 'bathroom', 'toilet', 'vc', 'voice', 'call', 'snow', 'snowstorm', 'cold', 'winter', 'morning', 'school', 'cancelled'];
		for (const word of allKeywords) {
			if (strongTopicWords.includes(word)) {
				return 0.3; // Give some overlap for strong topic words even if other message has no keywords
			}
		}
		return 0;
	}
	
	// Calculate intersection
	let intersection = 0;
	const strongMatches: string[] = [];
	const strongTopicWords = ['poop', 'pooping', 'bathroom', 'toilet', 'vc', 'voice', 'call', 'snow', 'snowstorm', 'cold', 'winter', 'morning', 'school', 'cancelled'];
	
	for (const word of keywords1) {
		if (keywords2.has(word)) {
			intersection++;
			if (strongTopicWords.includes(word)) {
				strongMatches.push(word);
			}
		}
	}
	
	// Calculate union
	const union = keywords1.size + keywords2.size - intersection;
	
	// Jaccard similarity
	let jaccard = union > 0 ? intersection / union : 0;
	
	// Boost if we have strong topic word matches
	if (strongMatches.length > 0) {
		jaccard = Math.min(1.0, jaccard + 0.3 * strongMatches.length);
	}
	
	return jaccard;
}

/**
 * Group messages into conversations based on:
 * - Reply chains (strongest signal)
 * - Semantic similarity (embeddings)
 * - Topic/keyword overlap
 * - Time gaps (dynamic based on similarity)
 * - Participant overlap
 */
function groupMessagesIntoConversations(messages: Message[]): Conversation[] {
	const conversations: Conversation[] = [];
	const messageToConversation = new Map<string, Conversation>();
	const processedMessages = new Set<string>();
	const messageMap = new Map<string, Message>();
	
	// Build message map for quick lookup
	for (const msg of messages) {
		messageMap.set(msg.id, msg);
	}

	// Constants
	const CONVERSATION_GAP_MINUTES = 15; // Gap to start new conversation
	const BASE_EXTEND_MINUTES = 20; // Base window to extend existing conversation
	const SEMANTIC_SIMILARITY_THRESHOLD = 0.5;
	const TOPIC_OVERLAP_THRESHOLD = 0.15; // Lowered to catch more topic matches
	const SCORING_THRESHOLD = 0.25; // Lowered to allow more grouping
	const RECENT_MESSAGES_WINDOW = 5; // Number of recent messages to prioritize for topic shift detection
	const TOPIC_SHIFT_THRESHOLD = 0.1; // Threshold below which recent topic overlap indicates a topic shift
	const TOPIC_SHIFT_TIME_MINUTES = 30; // Minimum time gap to consider topic shift

	// First pass: Group by reply chains (strongest signal)
	for (const msg of messages) {
		if (processedMessages.has(msg.id)) continue;

		if (msg.referenced_message_id) {
			// Find conversation containing the referenced message
			const referencedConv = messageToConversation.get(msg.referenced_message_id);
			
			if (referencedConv) {
				// Add to existing conversation
				referencedConv.messageIds.add(msg.id);
				referencedConv.participants.add(msg.author_id);
				referencedConv.endTime = msg.created_at;
				if (!referencedConv.messages) referencedConv.messages = [];
				referencedConv.messages.push(msg);
				messageToConversation.set(msg.id, referencedConv);
				processedMessages.add(msg.id);
				continue;
			} else {
				// Find the referenced message and create conversation
				const referencedMsg = messages.find(m => m.id === msg.referenced_message_id);
				if (referencedMsg && !processedMessages.has(referencedMsg.id)) {
					const newConv: Conversation = {
						messageIds: new Set([referencedMsg.id, msg.id]),
						participants: new Set([referencedMsg.author_id, msg.author_id]),
						startTime: referencedMsg.created_at,
						endTime: msg.created_at,
						messages: [referencedMsg, msg],
					};
					conversations.push(newConv);
					messageToConversation.set(referencedMsg.id, newConv);
					messageToConversation.set(msg.id, newConv);
					processedMessages.add(referencedMsg.id);
					processedMessages.add(msg.id);
					continue;
				}
			}
		}
	}

	// Second pass: Group remaining messages using enhanced scoring
	for (const msg of messages) {
		if (processedMessages.has(msg.id)) continue;

		// Find the best conversation to add this message to
		let bestConv: Conversation | null = null;
		let bestScore = 0;
		let bestSemanticScore = 0;
		let bestTopicScore = 0;

		for (const conv of conversations) {
			// Calculate time since conversation end
			const timeSinceEnd = (msg.created_at.getTime() - conv.endTime.getTime()) / (1000 * 60);
			
			// Allow messages slightly before conversation start (within 5 minutes) to account for processing order
			const timeSinceStart = (msg.created_at.getTime() - conv.startTime.getTime()) / (1000 * 60);
			if (timeSinceStart < -5) {
				continue; // Message is too far before conversation
			}

			// Calculate semantic similarity (if embeddings available)
			let semanticScore = 0;
			if (msg.embedding && conv.messages && conv.messages.length > 0) {
				// Get embeddings from conversation messages
				const convEmbeddings = conv.messages
					.map(m => m.embedding)
					.filter((emb): emb is number[] => emb !== undefined);
				
				if (convEmbeddings.length > 0) {
					// Calculate average embedding of conversation
					const avgEmbedding = calculateAverageEmbedding(convEmbeddings);
					if (avgEmbedding) {
						semanticScore = calculateCosineSimilarity(msg.embedding, avgEmbedding);
					}
				}
			}

			// Check participant overlap (needed for topic shift detection)
			const isParticipant = conv.participants.has(msg.author_id);
			const participantOverlap = isParticipant ? 1 : 0;
			const sameAuthor = isParticipant;

			// Calculate topic overlap - prioritize recent messages for topic shift detection
			let topicScore = 0;
			let recentTopicScore = 0;
			let overallTopicScore = 0;
			let isTopicShift = false;
			
			if (conv.messages && conv.messages.length > 0) {
				// Separate calculation for recent messages (last N) vs all messages
				const recentMessages = conv.messages.slice(-RECENT_MESSAGES_WINDOW);
				const allMessages = conv.messages;
				
				// Also check overlap with original topic (first few messages) to detect topic drift
				const originalMessages = conv.messages.slice(0, Math.min(5, Math.floor(conv.messages.length / 3)));
				let originalTopicScore = 0;
				if (originalMessages.length > 0 && timeSinceEnd > 60) {
					// Only check original topic if conversation has been going for a while
					let originalMaxOverlap = 0;
					let originalWeightedOverlap = 0;
					for (const origMsg of originalMessages) {
						const overlap = calculateTopicOverlap(msg.content, origMsg.content);
						originalWeightedOverlap += overlap;
						if (overlap > originalMaxOverlap) {
							originalMaxOverlap = overlap;
						}
					}
					originalTopicScore = originalWeightedOverlap / originalMessages.length;
				}
				
				// Calculate overlap with recent messages (primary signal for topic coherence)
				let recentMaxOverlap = 0;
				let recentWeightedOverlap = 0;
				let recentTotalWeight = 0;
				
				for (let i = 0; i < recentMessages.length; i++) {
					const convMsg = recentMessages[i]!;
					const overlap = calculateTopicOverlap(msg.content, convMsg.content);
					recentWeightedOverlap += overlap;
					recentTotalWeight += 1;
					if (overlap > recentMaxOverlap) {
						recentMaxOverlap = overlap;
					}
				}
				
				recentTopicScore = recentTotalWeight > 0 ? recentWeightedOverlap / recentTotalWeight : recentMaxOverlap;
				if (recentMaxOverlap > 0.2) {
					recentTopicScore = Math.max(recentTopicScore, recentMaxOverlap * 0.8);
				}
				
				// If message has low overlap with original topic but conversation is large, it's likely a topic shift
				// This prevents conversations from growing indefinitely with different topics
				if (originalTopicScore > 0 && conv.messages.length > 10 && timeSinceEnd > 30) {
					// If recent overlap is high but original overlap is low, and there's a time gap, it's a shift
					// Be more aggressive: if original overlap is very low, treat as shift even with moderate recent overlap
					if (originalTopicScore < 0.15 && (recentTopicScore > 0.15 || timeSinceEnd > 60)) {
						isTopicShift = true;
					}
				}
				
				// Calculate overlap with all messages (fallback/context)
				let overallMaxOverlap = 0;
				let overallWeightedOverlap = 0;
				let overallTotalWeight = 0;
				
				for (let i = 0; i < allMessages.length; i++) {
					const convMsg = allMessages[i]!;
					const overlap = calculateTopicOverlap(msg.content, convMsg.content);
					
					// Weight recent messages more (last 10 messages get full weight, older get 0.5x)
					const weight = i >= allMessages.length - 10 ? 1.0 : 0.5;
					overallWeightedOverlap += overlap * weight;
					overallTotalWeight += weight;
					
					if (overlap > overallMaxOverlap) {
						overallMaxOverlap = overlap;
					}
				}
				
				overallTopicScore = overallTotalWeight > 0 ? overallWeightedOverlap / overallTotalWeight : overallMaxOverlap;
				if (overallMaxOverlap > 0.2) {
					overallTopicScore = Math.max(overallTopicScore, overallMaxOverlap * 0.8);
				}
				
				// Detect topic shift: low recent overlap indicates topic change
				// Use keyword overlap to detect if message has different topic than recent messages
				const msgKeywords = extractKeywords(msg.content);
				let recentHasDifferentTopic = false;
				
				if (msgKeywords.size > 0 && recentMessages.length > 0) {
					// Collect all keywords from recent messages
					const recentKeywords = new Set<string>();
					for (const recentMsg of recentMessages) {
						const keywords = extractKeywords(recentMsg.content);
						keywords.forEach(k => recentKeywords.add(k));
					}
					
					// Calculate keyword overlap between message and recent messages
					let keywordIntersection = 0;
					for (const keyword of msgKeywords) {
						if (recentKeywords.has(keyword)) {
							keywordIntersection++;
						}
					}
					
					const keywordUnion = msgKeywords.size + recentKeywords.size - keywordIntersection;
					const keywordOverlap = keywordUnion > 0 ? keywordIntersection / keywordUnion : 0;
					
					// If keyword overlap is very low and time gap is significant, it's likely a topic shift
					if (keywordOverlap < 0.1 && timeSinceEnd > 15 && msgKeywords.size >= 2) {
						recentHasDifferentTopic = true;
					}
				}
				
				// More aggressive: if recent overlap is low and time gap is significant, it's a topic shift
				// BUT don't mark as shift if semantic similarity is strong (handles pee/poop case)
				const semanticallyRelated = semanticScore > 0.6;
				if (recentTopicScore < TOPIC_SHIFT_THRESHOLD && timeSinceEnd > TOPIC_SHIFT_TIME_MINUTES && !semanticallyRelated) {
					isTopicShift = true;
				}
				// Even more aggressive: if recent overlap is very low, always treat as shift if time gap > 15 minutes
				if (recentTopicScore < 0.05 && timeSinceEnd > 15 && !semanticallyRelated) {
					isTopicShift = true;
				}
				// If keyword analysis shows different topic, it's a topic shift
				if (recentHasDifferentTopic && !semanticallyRelated) {
					isTopicShift = true;
				}
				
				// Use recent topic score as primary, but allow overall score as fallback if recent is very low
				// Weight recent more heavily (0.4) vs overall (0.2) in final score
				topicScore = recentTopicScore * 0.4 + overallTopicScore * 0.2;
				
				// Special case: if same author and any topic overlap, boost significantly
				if (sameAuthor && overallMaxOverlap > 0.05) {
					// But only if not a topic shift
					if (!isTopicShift) {
						topicScore = Math.max(topicScore, overallMaxOverlap * 1.2);
					}
				}
			}

			// Early rejection: Check BEFORE calculating extend window
			// BUT allow if semantic similarity is strong (even if keywords don't match - e.g., pee/poop)
			const hasStrongSemanticLink = semanticScore > 0.6;
			
			// If recent topic score is very low and time gap is significant, reject immediately
			// This prevents messages with completely different topics from joining
			// Be more aggressive: reject if recent overlap is low OR if time gap is large with low overlap
			if (recentTopicScore < 0.1 && timeSinceEnd > 20 && !hasStrongSemanticLink) {
				continue; // Skip this conversation entirely - topic is too different or too much time has passed
			}
			// Even more aggressive: if recent overlap is very low, reject even with smaller time gaps
			if (recentTopicScore < 0.05 && timeSinceEnd > 15 && !hasStrongSemanticLink) {
				continue; // Skip this conversation - topic is completely different
			}
			// Also reject if conversation has been dormant for a long time (> 2 hours) with low recent overlap
			if (recentTopicScore < 0.15 && timeSinceEnd > 120 && !hasStrongSemanticLink) {
				continue; // Conversation has been dormant too long with low topic relevance
			}
			// Reject if conversation has multiple messages and message has low overlap with original topic
			// This prevents conversations from growing indefinitely with different topics
			// Be more aggressive: check original topic for any conversation with > 5 messages
			// BUT allow if semantic similarity is strong
			if (conv.messages && conv.messages.length > 5 && timeSinceEnd > 20 && !hasStrongSemanticLink) {
				const originalMessages = conv.messages.slice(0, Math.min(5, Math.floor(conv.messages.length / 2)));
				if (originalMessages.length > 0) {
					let originalOverlap = 0;
					let originalMaxOverlap = 0;
					for (const origMsg of originalMessages) {
						const overlap = calculateTopicOverlap(msg.content, origMsg.content);
						originalOverlap += overlap;
						if (overlap > originalMaxOverlap) {
							originalMaxOverlap = overlap;
						}
					}
					const avgOriginalOverlap = originalOverlap / originalMessages.length;
					// If overlap with original topic is very low, reject even if recent overlap is high
					// This prevents topic drift in conversations
					// Be strict: if average < 0.1 and max < 0.15, definitely reject
					if (avgOriginalOverlap < 0.1 && originalMaxOverlap < 0.15) {
						continue; // Message doesn't match original conversation topic
					}
					// Also reject if average is low and time gap is significant
					if (avgOriginalOverlap < 0.15 && originalMaxOverlap < 0.2 && timeSinceEnd > 60) {
						continue; // Message doesn't match original conversation topic and too much time has passed
					}
				}
			}

			// Dynamic time window based on semantic similarity and topic overlap
			// Use recentTopicScore to determine window (prioritize recent topic coherence)
			let extendWindow = BASE_EXTEND_MINUTES;
			
			// Don't extend window if topic shift detected - keep it at base (20 minutes)
			// Also, if recent topic score is very low, don't extend window much
			// BUT allow extension if semantic similarity is strong (e.g., pee/poop)
			if (isTopicShift) {
				extendWindow = BASE_EXTEND_MINUTES; // Keep at base if topic shift
			} else if (recentTopicScore < 0.05 && semanticScore < 0.6) {
				// Only use base window if BOTH topic and semantic scores are low
				// Very low recent topic overlap - don't extend much
				extendWindow = BASE_EXTEND_MINUTES;
			} else if (!isTopicShift) {
				if (sameAuthor && recentTopicScore > 0.05) {
					// Same author with topic similarity: extend significantly
					extendWindow = 180; // 3 hours for same author continuing topic
				} else if (semanticScore > 0.7) {
					extendWindow = 120; // High semantic similarity: 2 hours
				} else if (semanticScore > 0.6) {
					extendWindow = 90; // Medium-high semantic similarity: 90 minutes (e.g., pee/poop)
				} else if (semanticScore > 0.5) {
					extendWindow = 70; // Medium semantic similarity: 70 minutes
				} else if (recentTopicScore > 0.2) {
					extendWindow = 120; // Good topic overlap: 2 hours (increased)
				} else if (recentTopicScore > 0.1) {
					extendWindow = 60; // Some topic overlap: 1 hour (increased)
				} else if (recentTopicScore > 0.05) {
					extendWindow = 40; // Minimal topic overlap: 40 minutes
				}
			}
			
			// Check if message is within dynamic extension window
			if (timeSinceEnd > extendWindow) {
				continue; // Too far in time
			}

			// Calculate time score (decay based on time since conversation end)
			const timeScore = Math.max(0, 1 - (timeSinceEnd / extendWindow));

			// Enhanced scoring formula with boost for participant + topic overlap
			// Use recentTopicScore more heavily (0.4) vs overall topic score (0.2)
			// But if recentTopicScore is very low, heavily penalize the score
			let baseScore = (
				participantOverlap * 0.25 +
				timeScore * 0.15 +
				semanticScore * 0.3 +
				recentTopicScore * 0.4 +
				overallTopicScore * 0.2
			);
			
			// If recent topic score is very low, heavily penalize even before topic shift check
			// This prevents messages with different topics from joining
			// BUT don't penalize if semantic similarity is strong (e.g., pee/poop)
			if (recentTopicScore < 0.1 && timeSinceEnd > 15 && !hasStrongSemanticLink) {
				baseScore *= 0.1; // Reduce by 90% if recent topic overlap is very low
			}
			
			// Apply penalty for topic shift - reduce score significantly if topic has shifted
			if (isTopicShift) {
				// Very aggressive penalty: reduce score by 95% if topic shift detected
				// This should prevent messages from joining conversations with different topics
				baseScore *= 0.05;
			}
			
			// Boost score if participant overlap AND topic overlap (strong signal)
			// But only if not a topic shift
			if (!isTopicShift && participantOverlap > 0 && recentTopicScore > 0.15) {
				baseScore += 0.2; // Increased boost for same participant talking about similar topic
			}
			
			// Boost score if multiple participants and topic overlap (group conversation)
			// But only if not a topic shift
			if (!isTopicShift && conv.participants.size >= 2 && recentTopicScore > 0.2) {
				baseScore += 0.15; // Increased boost for multi-participant topic conversations
			}
			
			// Strong boost if same author with any topic similarity (for threads like Lucas's links)
			// But only if not a topic shift and within time window
			if (!isTopicShift && sameAuthor && recentTopicScore > 0.05 && timeSinceEnd <= 180) { // Up to 3 hours for same author
				baseScore += 0.25; // Strong boost for same author continuing a topic
			}
			
			const score = Math.min(1.0, baseScore);

			if (score > bestScore) {
				bestScore = score;
				bestConv = conv;
				bestSemanticScore = semanticScore;
				bestTopicScore = topicScore;
			}
		}

		// Add to best conversation if it's a good match
		// Lower threshold if semantic similarity is strong (e.g., pee/poop)
		let threshold = SCORING_THRESHOLD;
		if (bestConv && msg.embedding && bestConv.messages && bestConv.messages.length > 0) {
			const convEmbeddings = bestConv.messages
				.map(m => m.embedding)
				.filter((emb): emb is number[] => emb !== undefined);
			if (convEmbeddings.length > 0) {
				const avgEmbedding = calculateAverageEmbedding(convEmbeddings);
				if (avgEmbedding) {
					const semanticSim = calculateCosineSimilarity(msg.embedding, avgEmbedding);
					if (semanticSim > 0.6) {
						threshold = 0.20; // Lower threshold for strong semantic similarity
					}
				}
			}
		}
		
		if (bestConv && bestScore > threshold) {
			bestConv.messageIds.add(msg.id);
			bestConv.participants.add(msg.author_id);
			if (msg.created_at > bestConv.endTime) {
				bestConv.endTime = msg.created_at;
			}
			if (!bestConv.messages) bestConv.messages = [];
			bestConv.messages.push(msg);
			messageToConversation.set(msg.id, bestConv);
			processedMessages.add(msg.id);
		} else {
			// Check existing conversations again - maybe we missed one due to timing
			// This can happen if a conversation was created after we already checked
			let foundExistingConv = false;
			let bestExistingConv: Conversation | null = null;
			let bestExistingScore = 0;
			
			for (const conv of conversations) {
				if (conv.messages && conv.messages.length > 0) {
					// Check topic overlap with RECENT messages first (for topic shift detection)
					const recentConvMsgs = conv.messages.slice(-RECENT_MESSAGES_WINDOW);
					let recentConvTopicOverlap = 0;
					let maxRecentOverlap = 0;
					for (const convMsg of recentConvMsgs) {
						const overlap = calculateTopicOverlap(msg.content, convMsg.content);
						recentConvTopicOverlap += overlap;
						if (overlap > maxRecentOverlap) {
							maxRecentOverlap = overlap;
						}
					}
					const avgRecentOverlap = recentConvMsgs.length > 0 ? recentConvTopicOverlap / recentConvMsgs.length : 0;
					const recentTopicScore = Math.max(avgRecentOverlap, maxRecentOverlap);
					
					const timeSinceEnd = (msg.created_at.getTime() - conv.endTime.getTime()) / (1000 * 60);
					
					// Early rejection: If recent topic score is very low and time gap is significant, skip
					// Be more aggressive: reject if recent overlap is low OR if time gap is large with low overlap
					if (recentTopicScore < 0.1 && timeSinceEnd > 20) {
						continue; // Skip this conversation - topic is too different or too much time has passed
					}
					// Even more aggressive: if recent overlap is very low, reject even with smaller time gaps
					if (recentTopicScore < 0.05 && timeSinceEnd > 15) {
						continue; // Skip this conversation - topic is completely different
					}
					// Also reject if conversation has been dormant for a long time (> 2 hours) with low recent overlap
					if (recentTopicScore < 0.15 && timeSinceEnd > 120) {
						continue; // Conversation has been dormant too long with low topic relevance
					}
					
					// Reject if conversation has multiple messages and message has low overlap with original topic
					if (conv.messages && conv.messages.length > 5 && timeSinceEnd > 20) {
						const originalMessages = conv.messages.slice(0, Math.min(5, Math.floor(conv.messages.length / 2)));
						if (originalMessages.length > 0) {
							let originalOverlap = 0;
							let originalMaxOverlap = 0;
							for (const origMsg of originalMessages) {
								const overlap = calculateTopicOverlap(msg.content, origMsg.content);
								originalOverlap += overlap;
								if (overlap > originalMaxOverlap) {
									originalMaxOverlap = overlap;
								}
							}
							const avgOriginalOverlap = originalOverlap / originalMessages.length;
							// If overlap with original topic is very low, reject even if recent overlap is high
							// Be strict: if average < 0.1 and max < 0.15, definitely reject
							if (avgOriginalOverlap < 0.1 && originalMaxOverlap < 0.15) {
								continue; // Message doesn't match original conversation topic
							}
							// Also reject if average is low and time gap is significant
							if (avgOriginalOverlap < 0.15 && originalMaxOverlap < 0.2 && timeSinceEnd > 60) {
								continue; // Message doesn't match original conversation topic and too much time has passed
							}
						}
					}
					
					// Check topic overlap with conversation - check ALL messages, not just recent
					let maxConvTopicOverlap = 0;
					for (const convMsg of conv.messages) {
						const overlap = calculateTopicOverlap(msg.content, convMsg.content);
						if (overlap > maxConvTopicOverlap) {
							maxConvTopicOverlap = overlap;
						}
					}
					
					// If any topic overlap with existing conversation, consider extending it
					// Use very low threshold (0.05) to catch URL messages with "poop" keyword
					// But prioritize recent topic overlap
					if (maxConvTopicOverlap > 0.05 || recentTopicScore > 0.05) {
						const timeSinceStart = (msg.created_at.getTime() - conv.startTime.getTime()) / (1000 * 60);
						
						// More lenient time window for topic overlap, especially for same author
						const sameAuthor = conv.participants.has(msg.author_id);
						let extendWindow = 60; // Default 1 hour
						if (sameAuthor && maxConvTopicOverlap > 0.1) {
							extendWindow = 180; // 3 hours for same author with topic overlap
						} else if (maxConvTopicOverlap > 0.3) {
							extendWindow = 180; // 3 hours for strong overlap
						} else if (maxConvTopicOverlap > 0.2) {
							extendWindow = 120; // 2 hours for moderate overlap
						} else if (maxConvTopicOverlap > 0.1) {
							extendWindow = 90; // 90 minutes for weak overlap
						}
						
						// Allow messages slightly before conversation start (within 10 minutes)
						// Or very close after (within extend window)
						if ((timeSinceEnd >= -10 && timeSinceEnd <= extendWindow) || 
						    (timeSinceStart >= -10 && timeSinceStart <= extendWindow) ||
						    (timeSinceEnd >= 0 && timeSinceEnd <= 5 && maxConvTopicOverlap > 0.1)) { // Within 5 minutes with topic overlap
							// Calculate semantic similarity if available
							let semanticScore = 0;
							if (msg.embedding && conv.messages) {
								const convEmbeddings = conv.messages
									.map(m => m.embedding)
									.filter((emb): emb is number[] => emb !== undefined);
								if (convEmbeddings.length > 0) {
									const avgEmbedding = calculateAverageEmbedding(convEmbeddings);
									if (avgEmbedding) {
										semanticScore = calculateCosineSimilarity(msg.embedding, avgEmbedding);
									}
								}
							}
							
							const isParticipant = conv.participants.has(msg.author_id);
							const participantOverlap = isParticipant ? 1 : 0;
							const sameAuthor = isParticipant;
							
							// Use the closer time boundary
							const timeBoundary = timeSinceEnd >= 0 ? timeSinceEnd : Math.abs(timeSinceStart);
							const timeScore = Math.max(0, 1 - (timeBoundary / extendWindow));
							
							// Score this conversation match
							let convScore = (
								participantOverlap * 0.25 +
								timeScore * 0.15 +
								semanticScore * 0.3 +
								maxConvTopicOverlap * 0.3
							);
							
							// Strong boost for same author with topic overlap
							if (sameAuthor && maxConvTopicOverlap > 0.1) {
								convScore += 0.3; // Very strong boost
							}
							
							// Boost for topic overlap
							if (maxConvTopicOverlap > 0.2) {
								convScore += 0.2;
							} else if (maxConvTopicOverlap > 0.1) {
								convScore += 0.1; // Even small topic overlap gets a boost
							}
							
							if (convScore > bestExistingScore) {
								bestExistingScore = convScore;
								bestExistingConv = conv;
							}
						}
					}
				}
			}
			
			// Add to best existing conversation if score is good enough
			if (bestExistingConv && bestExistingScore > SCORING_THRESHOLD) {
				bestExistingConv.messageIds.add(msg.id);
				bestExistingConv.participants.add(msg.author_id);
				if (msg.created_at > bestExistingConv.endTime) {
					bestExistingConv.endTime = msg.created_at;
				}
				if (!bestExistingConv.messages) bestExistingConv.messages = [];
				bestExistingConv.messages.push(msg);
				messageToConversation.set(msg.id, bestExistingConv);
				processedMessages.add(msg.id);
				foundExistingConv = true;
			}
			
			if (foundExistingConv) {
				continue;
			}
			
			// Check if there's a recent unprocessed message (within gap window) to start conversation with
			let bestRecentMsg: Message | null = null;
			let bestRecentScore = 0;
			let bestRecentTopicOverlap = 0;
			
			// Check unprocessed messages to potentially start new conversation
			const recentMsgs = messages
				.filter(m => !processedMessages.has(m.id) && m.created_at < msg.created_at)
				.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
				.slice(0, 10); // Check up to 10 recent messages
			
			for (const recentMsg of recentMsgs) {
				const timeGap = (msg.created_at.getTime() - recentMsg.created_at.getTime()) / (1000 * 60);
				
				// Check semantic similarity and topic overlap
				let semanticSim = 0;
				if (msg.embedding && recentMsg.embedding) {
					semanticSim = calculateCosineSimilarity(msg.embedding, recentMsg.embedding);
				}
				const topicOverlap = calculateTopicOverlap(msg.content, recentMsg.content);
				
				const sameAuthor = msg.author_id === recentMsg.author_id;
				const maxTimeGap = sameAuthor ? 180 : 120; // 3 hours for same author, 2 hours otherwise
				
				let score = 0;
				let shouldConsider = false;
				
				if (timeGap <= CONVERSATION_GAP_MINUTES) {
					score = 1.0; // Within normal gap window
					shouldConsider = true;
				} else if (timeGap <= maxTimeGap) {
					// Score based on similarity
					if (semanticSim > SEMANTIC_SIMILARITY_THRESHOLD) {
						score = 0.8 + semanticSim * 0.2;
						shouldConsider = true;
					} else if (topicOverlap > TOPIC_OVERLAP_THRESHOLD) {
						score = 0.7 + topicOverlap * 0.3;
						shouldConsider = true;
					} else if (sameAuthor && topicOverlap > 0.05) {
						score = 0.6 + topicOverlap * 0.4;
						shouldConsider = true;
					} else if (topicOverlap > 0.1) {
						score = 0.5 + topicOverlap * 0.5;
						shouldConsider = true;
					}
				}
				
				if (shouldConsider && score > bestRecentScore) {
					bestRecentScore = score;
					bestRecentMsg = recentMsg;
					bestRecentTopicOverlap = topicOverlap;
				}
			}
			
			if (bestRecentMsg && bestRecentScore > 0.5) {
				// Create conversation with best matching recent message
				const newConv: Conversation = {
					messageIds: new Set([bestRecentMsg.id, msg.id]),
					participants: new Set([bestRecentMsg.author_id, msg.author_id]),
					startTime: bestRecentMsg.created_at,
					endTime: msg.created_at,
					messages: [bestRecentMsg, msg],
				};
				conversations.push(newConv);
				messageToConversation.set(bestRecentMsg.id, newConv);
				messageToConversation.set(msg.id, newConv);
				processedMessages.add(bestRecentMsg.id);
				processedMessages.add(msg.id);
				continue;
			}

			// Create new standalone conversation (will be numbered 0)
			const newConv: Conversation = {
				messageIds: new Set([msg.id]),
				participants: new Set([msg.author_id]),
				startTime: msg.created_at,
				endTime: msg.created_at,
				messages: [msg],
			};
			conversations.push(newConv);
			messageToConversation.set(msg.id, newConv);
			processedMessages.add(msg.id);
		}
	}

	// Third pass: Merge semantically similar conversations
	const mergedConversations = mergeSimilarConversations(conversations, messages);
	
	// Fourth pass: Final cleanup - merge conversations with same participants and strong topic overlap
	// This catches cases where messages were split due to processing order
	const finalMerged = finalMergePass(mergedConversations);

	// Sort conversations by start time
	finalMerged.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

	return finalMerged;
}

/**
 * Final merge pass to catch conversations that should be together
 * Merges conversations with overlapping participants and topic overlap within short time windows
 */
function finalMergePass(conversations: Conversation[]): Conversation[] {
	const FINAL_MERGE_TIME_WINDOW = 10; // 10 minutes for final merge
	const FINAL_TOPIC_THRESHOLD = 0.1; // Lower threshold for final pass
	
	const merged: Conversation[] = [];
	const processed = new Set<number>();
	
	for (let i = 0; i < conversations.length; i++) {
		if (processed.has(i)) continue;
		
		const current = conversations[i]!;
		const mergedConv: Conversation = {
			messageIds: new Set(current.messageIds),
			participants: new Set(current.participants),
			startTime: current.startTime,
			endTime: current.endTime,
			messages: current.messages ? [...current.messages] : [],
		};
		
		// Look for nearby conversations to merge
		for (let j = i + 1; j < conversations.length; j++) {
			if (processed.has(j)) continue;
			
			const candidate = conversations[j]!;
			
			// Check time proximity - check both start-to-end and end-to-start gaps
			const gap1 = Math.abs(
				(candidate.startTime.getTime() - mergedConv.endTime.getTime()) / (1000 * 60)
			);
			const gap2 = Math.abs(
				(mergedConv.startTime.getTime() - candidate.endTime.getTime()) / (1000 * 60)
			);
			const timeGap = Math.min(gap1, gap2);
			
			// Also check if conversations overlap in time
			const timeOverlap = !(
				mergedConv.endTime < candidate.startTime || 
				candidate.endTime < mergedConv.startTime
			);
			
			if (timeGap > FINAL_MERGE_TIME_WINDOW && !timeOverlap) {
				continue;
			}
			
			// Check participant overlap
			const hasParticipantOverlap = Array.from(mergedConv.participants).some(p => candidate.participants.has(p));
			
			// Check topic overlap
			let maxTopicOverlap = 0;
			if (mergedConv.messages && candidate.messages) {
				// Check all messages for topic overlap
				for (const msg1 of mergedConv.messages) {
					for (const msg2 of candidate.messages) {
						const overlap = calculateTopicOverlap(msg1.content, msg2.content);
						if (overlap > maxTopicOverlap) {
							maxTopicOverlap = overlap;
						}
					}
				}
			}
			
			// Merge if: same participants OR topic overlap
			if (hasParticipantOverlap && maxTopicOverlap > FINAL_TOPIC_THRESHOLD) {
				// Merge conversations
				candidate.messageIds.forEach(id => mergedConv.messageIds.add(id));
				candidate.participants.forEach(p => mergedConv.participants.add(p));
				
				if (candidate.startTime < mergedConv.startTime) {
					mergedConv.startTime = candidate.startTime;
				}
				if (candidate.endTime > mergedConv.endTime) {
					mergedConv.endTime = candidate.endTime;
				}
				
				if (candidate.messages) {
					if (!mergedConv.messages) mergedConv.messages = [];
					mergedConv.messages.push(...candidate.messages);
				}
				
				processed.add(j);
			}
		}
		
		merged.push(mergedConv);
		processed.add(i);
	}
	
	return merged;
}

/**
 * Merge semantically similar conversations that are close in time
 */
function mergeSimilarConversations(conversations: Conversation[], allMessages: Message[]): Conversation[] {
	const MERGE_TIME_WINDOW_MINUTES = 120; // Increased to 2 hours for merging
	const SEMANTIC_MERGE_THRESHOLD = 0.5; // Lowered threshold
	const TOPIC_MERGE_THRESHOLD = 0.2; // Lowered threshold for topic-based merging
	
	const messageMap = new Map<string, Message>();
	for (const msg of allMessages) {
		messageMap.set(msg.id, msg);
	}

	const merged: Conversation[] = [];
	const processed = new Set<number>();

	for (let i = 0; i < conversations.length; i++) {
		if (processed.has(i)) continue;

		const current = conversations[i]!;
		const mergedConv: Conversation = {
			messageIds: new Set(current.messageIds),
			participants: new Set(current.participants),
			startTime: current.startTime,
			endTime: current.endTime,
			messages: current.messages ? [...current.messages] : [],
		};

		// Look for conversations to merge with
		for (let j = i + 1; j < conversations.length; j++) {
			if (processed.has(j)) continue;

			const candidate = conversations[j]!;
			
			// Check time gap
			const timeGap = Math.abs(
				(candidate.startTime.getTime() - mergedConv.endTime.getTime()) / (1000 * 60)
			);
			
			if (timeGap > MERGE_TIME_WINDOW_MINUTES) {
				continue; // Too far apart in time
			}

			// Calculate semantic similarity between conversations
			let semanticSimilarity = 0;
			if (mergedConv.messages && candidate.messages) {
				const conv1Embeddings = mergedConv.messages
					.map(m => m.embedding)
					.filter((emb): emb is number[] => emb !== undefined);
				const conv2Embeddings = candidate.messages
					.map(m => m.embedding)
					.filter((emb): emb is number[] => emb !== undefined);
				
				if (conv1Embeddings.length > 0 && conv2Embeddings.length > 0) {
					const avg1 = calculateAverageEmbedding(conv1Embeddings);
					const avg2 = calculateAverageEmbedding(conv2Embeddings);
					if (avg1 && avg2) {
						semanticSimilarity = calculateCosineSimilarity(avg1, avg2);
					}
				}
			}

			// Calculate topic overlap - check all messages, not just recent
			let maxTopicOverlap = 0;
			let avgTopicOverlap = 0;
			let overlapCount = 0;
			
			if (mergedConv.messages && candidate.messages) {
				// Compare messages from both conversations (sample up to 10 from each)
				const sample1 = mergedConv.messages.slice(-10);
				const sample2 = candidate.messages.slice(-10);
				
				for (const msg1 of sample1) {
					for (const msg2 of sample2) {
						const overlap = calculateTopicOverlap(msg1.content, msg2.content);
						if (overlap > 0) {
							avgTopicOverlap += overlap;
							overlapCount++;
						}
						if (overlap > maxTopicOverlap) {
							maxTopicOverlap = overlap;
						}
					}
				}
				
				// Use average if we have enough samples
				if (overlapCount > 5) {
					avgTopicOverlap = avgTopicOverlap / overlapCount;
					// Use max of max and average for better detection
					maxTopicOverlap = Math.max(maxTopicOverlap, avgTopicOverlap * 1.2);
				}
			}
			
			// Also check participant overlap - if same participants, be more lenient
			const participantOverlap = Array.from(mergedConv.participants).some(p => candidate.participants.has(p));
			if (participantOverlap && maxTopicOverlap > 0.1) {
				// Boost topic overlap score if participants overlap
				maxTopicOverlap = Math.min(1.0, maxTopicOverlap * 1.3);
			}

			// Merge if similar enough
			if (semanticSimilarity > SEMANTIC_MERGE_THRESHOLD || maxTopicOverlap > TOPIC_MERGE_THRESHOLD) {
				// Merge conversations
				candidate.messageIds.forEach(id => mergedConv.messageIds.add(id));
				candidate.participants.forEach(p => mergedConv.participants.add(p));
				
				if (candidate.startTime < mergedConv.startTime) {
					mergedConv.startTime = candidate.startTime;
				}
				if (candidate.endTime > mergedConv.endTime) {
					mergedConv.endTime = candidate.endTime;
				}
				
				if (candidate.messages) {
					if (!mergedConv.messages) mergedConv.messages = [];
					mergedConv.messages.push(...candidate.messages);
				}
				
				processed.add(j);
			}
		}

		merged.push(mergedConv);
		processed.add(i);
	}

	// Final pass: Fix orphaned replies
	// After all merging, some replies might be in separate conversations from their referenced messages
	// This happens when the reply chain pass created a new conversation before the referenced message was grouped
	for (let i = merged.length - 1; i >= 0; i--) {
		const convo = merged[i]!;
		if (!convo.messages) continue;
		
		for (const msg of convo.messages) {
			if (!msg.referenced_message_id) continue;
			
			// Find the conversation containing the referenced message
			const targetConvo = merged.find(c => 
				c !== convo && c.messageIds.has(msg.referenced_message_id!)
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
				convo.messages = convo.messages.filter(m => m.id !== msg.id);
				
				// If conversation becomes too small, mark for removal
				if (convo.messageIds.size < 2) {
					merged.splice(i, 1);
					break;
				}
			}
		}
	}

	return merged;
}

async function listMessages() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		AnalysisFormatter.section("MESSAGES - 24 HOUR VIEW", 100);

		const cutoffTime = new Date();
		cutoffTime.setHours(cutoffTime.getHours() - TIME_WINDOW_HOURS);

		// Fetch all messages from past 24h (including embeddings)
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

		// Parse embeddings from database (handle pgvector format)
		const allMessages = messagesResult.data.map((m) => {
			let embedding: number[] | undefined = undefined;
			if (m.embedding) {
				if (Array.isArray(m.embedding)) {
					embedding = m.embedding as number[];
				} else if (typeof m.embedding === 'string') {
					// Parse PostgreSQL array format: "{1,2,3}" or JSON array format: "[1,2,3]"
					try {
						const embeddingStr: string = m.embedding;
						let cleaned: string = embeddingStr.trim();
						// Convert PostgreSQL array format {1,2,3} to JSON array format [1,2,3]
						if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
							cleaned = '[' + cleaned.slice(1, -1) + ']';
						}
						embedding = JSON.parse(cleaned) as number[];
					} catch {
						// Silently skip if parsing fails (embedding will be undefined)
					}
				}
			}

			return {
				id: m.id,
				author_id: m.author_id,
				author_name: m.display_name || m.username || m.author_id.substring(0, 8),
				content: m.content || "",
				created_at: new Date(m.created_at),
				referenced_message_id: m.referenced_message_id,
				embedding: embedding,
			};
		}) as Message[];

		// Check embedding availability
		const messagesWithEmbeddings = allMessages.filter(m => m.embedding !== undefined).length;
		if (messagesWithEmbeddings === 0) {
			console.log("│");
			AnalysisFormatter.warning(`No embeddings found. Consider running: npm run generate:embeddings ${GUILD_ID}`);
			console.log("│");
		} else {
			console.log("│");
			AnalysisFormatter.metric("Messages with Embeddings", `${messagesWithEmbeddings}/${allMessages.length}`);
			console.log("│");
		}

		if (allMessages.length === 0) {
			AnalysisFormatter.warning("No messages found in the last 24 hours");
			await db.disconnect();
			return;
		}

		// Group messages into conversations
		const conversations = groupMessagesIntoConversations(allMessages);

		console.log("│");
		AnalysisFormatter.metric("Total Messages", allMessages.length.toString());
		console.log("│");

		AnalysisFormatter.subsection("Messages in Chronological Order", 98);

		// Create a map of message ID to conversation number
		const messageToConversation = new Map<string, number>();
		conversations.forEach((conv, index) => {
			conv.messageIds.forEach(msgId => {
				messageToConversation.set(msgId, index);
			});
		});

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
			const content = msg.content.length > maxContentLength
				? msg.content.substring(0, maxContentLength) + "..."
				: msg.content || "(no content)";

			const replyIndicator = msg.referenced_message_id ? "↪ " : "";
			
			// Get conversation number for this message
			const convNum = messageToConversation.get(msg.id);
			const convDisplay = convNum !== undefined ? `${convNum} ` : "";

			console.log(`│ ${convDisplay}[${date} ${timestamp}] ${replyIndicator}${msg.author_name}: ${content}`);
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

listMessages();


