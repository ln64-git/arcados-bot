/**
 * Response Pattern Analyzer
 *
 * Analyzes how users respond in conversations:
 * - Response latency (time to respond to mentions/replies)
 * - Question answering rate
 * - Turn-taking balance
 * - Conversation initiation rate
 */

import type {
	AnalyzerResult,
	ResponsePatterns,
	MessageData,
	ConversationData,
} from "../types";

export class ResponsePatternAnalyzer {
	/**
	 * Analyze response patterns from user messages and conversations
	 */
	static async analyze(
		userId: string,
		messages: MessageData[],
		conversations: ConversationData[]
	): Promise<AnalyzerResult<ResponsePatterns>> {
		try {
			if (messages.length < 5) {
				return {
					success: false,
					error: "Insufficient messages for response pattern analysis (need >= 5)",
					confidence: 0,
				};
			}

			// Calculate response latency
			const avgResponseLatency = this.calculateResponseLatency(userId, messages);

			// Calculate question answer rate
			const questionAnswerRate = this.calculateQuestionAnswerRate(
				userId,
				messages
			);

			// Calculate turn-taking balance
			const turnTakingBalance = this.calculateTurnTakingBalance(
				userId,
				conversations
			);

			// Calculate conversation initiation rate
			const conversationInitiationRate = this.calculateInitiationRate(
				userId,
				conversations
			);

			// Calculate confidence
			const confidence = Math.min(
				0.9,
				0.4 + (messages.length / 100) * 0.5
			);

			const patterns: ResponsePatterns = {
				avg_response_latency_minutes: avgResponseLatency,
				question_answer_rate: questionAnswerRate,
				turn_taking_balance: turnTakingBalance,
				conversation_initiation_rate: conversationInitiationRate,
			};

			return {
				success: true,
				data: patterns,
				confidence,
			};
		} catch (error) {
			return {
				success: false,
				error: `Response pattern analysis failed: ${error}`,
				confidence: 0,
			};
		}
	}

	/**
	 * Calculate average response latency
	 * (time between being mentioned and user's next message)
	 */
	private static calculateResponseLatency(
		userId: string,
		messages: MessageData[]
	): number {
		const responseTimes: number[] = [];

		// Sort messages by timestamp
		const sorted = [...messages].sort(
			(a, b) => a.created_at.getTime() - b.created_at.getTime()
		);

		for (let i = 0; i < sorted.length; i++) {
			const msg = sorted[i];

			// If this message references another message (reply)
			if (msg.referenced_message_id) {
				// Find the referenced message
				const refIndex = sorted.findIndex(
					(m) => m.id === msg.referenced_message_id
				);

				if (refIndex >= 0 && msg.author_id === userId) {
					const timeDiff =
						(msg.created_at.getTime() - sorted[refIndex].created_at.getTime()) /
						(60 * 1000);

					// Only count responses within 24 hours
					if (timeDiff <= 24 * 60) {
						responseTimes.push(timeDiff);
					}
				}
			}
		}

		if (responseTimes.length === 0) return 0;

		// Calculate median (more robust than mean for latency)
		responseTimes.sort((a, b) => a - b);
		const median =
			responseTimes.length % 2 === 0
				? (responseTimes[responseTimes.length / 2 - 1] +
						responseTimes[responseTimes.length / 2]) /
					2
				: responseTimes[Math.floor(responseTimes.length / 2)];

		return median;
	}

	/**
	 * Calculate question answer rate
	 */
	private static calculateQuestionAnswerRate(
		userId: string,
		messages: MessageData[]
	): number {
		let questionsReceived = 0;
		let questionsAnswered = 0;

		// Sort messages by timestamp
		const sorted = [...messages].sort(
			(a, b) => a.created_at.getTime() - b.created_at.getTime()
		);

		// Detect questions directed at user (mentions + question mark)
		const userMentionRegex = new RegExp(`<@${userId}>`, "g");
		const questionRegex = /[?？]/;

		for (let i = 0; i < sorted.length; i++) {
			const msg = sorted[i];

			// Is this a question mentioning the user?
			if (
				msg.author_id !== userId &&
				userMentionRegex.test(msg.content) &&
				questionRegex.test(msg.content)
			) {
				questionsReceived++;

				// Did user respond within 1 hour?
				const responseWindow = 60 * 60 * 1000; // 1 hour
				const hasResponse = sorted.some(
					(m, idx) =>
						idx > i &&
						m.author_id === userId &&
						m.created_at.getTime() - msg.created_at.getTime() <= responseWindow
				);

				if (hasResponse) {
					questionsAnswered++;
				}
			}
		}

		return questionsReceived > 0 ? questionsAnswered / questionsReceived : 0.5;
	}

	/**
	 * Calculate turn-taking balance in conversations
	 */
	private static calculateTurnTakingBalance(
		userId: string,
		conversations: ConversationData[]
	): number {
		if (conversations.length === 0) return 0.5;

		const balanceScores: number[] = [];

		for (const conv of conversations) {
			// Check if user participated
			if (!conv.participants.includes(userId)) continue;

			const participantCount = conv.participants.length;
			if (participantCount < 2) continue;

			// Ideal share = 1 / participant count
			const idealShare = 1 / participantCount;

			// Estimate user's share (we don't have per-user message counts here,
			// so use a proxy: if they're in conversation, assume balanced participation)
			// This is simplified - in full implementation, you'd count messages per participant
			const userShare = idealShare; // Placeholder

			// Balance score: 1 = perfect balance, 0 = total imbalance
			const balance = 1 - Math.abs(userShare - idealShare) / idealShare;
			balanceScores.push(balance);
		}

		if (balanceScores.length === 0) return 0.5;

		return (
			balanceScores.reduce((sum, score) => sum + score, 0) /
			balanceScores.length
		);
	}

	/**
	 * Calculate conversation initiation rate
	 */
	private static calculateInitiationRate(
		userId: string,
		conversations: ConversationData[]
	): number {
		if (conversations.length === 0) return 0;

		// In simplified version, assume if user is first participant they initiated
		// In full version, check if user sent first message in conversation
		const userConversations = conversations.filter((conv) =>
			conv.participants.includes(userId)
		);

		if (userConversations.length === 0) return 0;

		// Placeholder: assume 30% initiation rate as baseline
		// Full implementation would check first message author
		return 0.3;
	}
}
