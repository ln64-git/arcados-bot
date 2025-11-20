/**
 * Adaptive formatting selector for Discord responses
 * Analyzes user queries to choose between conversational and info-based formatting
 */

export type FormattingStyle = "conversational" | "info";

export interface FormattingStyleGuide {
	style: FormattingStyle;
	instructions: string;
}

/**
 * System prompt for LLM-based formatting decision
 */
const FORMATTING_DECISION_PROMPT = `Analyze this user query and decide the best response format.

Choose "conversational" for:
- Casual greetings, thanks, or acknowledgments
- Opinion questions or subjective discussions
- Follow-up questions in ongoing conversation
- Simple factual questions (who/what/where/when with short answers)

Choose "info" for:
- Requests for lists of items (movies, news, events, options)
- How-to questions or step-by-step instructions
- Comparisons or feature breakdowns
- Any query asking for multiple distinct pieces of information

Respond with ONLY one word: "conversational" or "info"

User query: "{query}"

Decision:`;

/**
 * Formatting style instructions (independent of persona/voice)
 */
export const FORMATTING_STYLES: Record<FormattingStyle, string> = {
	conversational: `RESPONSE STYLE: Conversational

Write naturally like you're chatting with a friend. Keep it flowing and easy to read:
- Use plain text in natural sentences - NO formatting at all
- Do NOT use bullet points, numbered lists, or **bold** text
- Write 3-6 sentences in flowing paragraphs
- Keep it concise but complete
- Let your personality show through

Example: "I'm doing great, thanks for asking! Just chilling and ready to help out. How about you?"`,

	info: `RESPONSE STYLE: Info/Organized

Present information in a clear, scannable format that's easy to digest:
- Start with a brief intro sentence
- Use bullet points (-) when listing 3+ distinct items
- Use **bold** for item names/categories to aid scanning
- Format: "- **Name/Category:** brief description"
- Keep it concise - aim for 4-6 bullets maximum
- Add a closing line if helpful

Example:
"Top movies in theaters right now:
- **Now You See Me: Now You Don't:** Magic heist sequel topping box office at $21M
- **Predator: Badlands:** Still strong after its $40M debut
- **Wicked: For Good:** Drops Friday with huge pre-sales
Check Fandango for local showtimes."

Use your judgment - if the information flows better as a paragraph, that's fine too. The goal is clarity and readability.`,
};

/**
 * Analyze user query and select appropriate formatting style
 */
export function selectFormattingStyle(
	userPrompt: string,
	conversationHistory?: Array<{ role: string; content: string }>
): FormattingStyleGuide {
	const prompt = userPrompt.toLowerCase().trim();

	// Info-based triggers (questions that need structured answers)
	const infoTriggers = [
		// How-to / instructions
		/\bhow (do|to|can|should)\b/,
		/\bsteps? (to|for)\b/,
		/\bguide (to|for|on)\b/,
		/\binstructions? (for|on|to)\b/,
		/\brecipe (for)?\b/,

		// Lists / comparisons
		/\b(best|top|greatest|worst|favorite) .*(movies|shows|games|books|songs|albums|apps)\b/,
		/\bwhat (are|is) (the|some|all)\b.*\b(best|top|options|choices|differences)\b/,
		/\b(list|show|give me) (the|all|some)\b/,
		/\bcompare\b/,
		/\btell me about (the )?(features|specs|details|differences)\b/,

		// Info queries - more flexible patterns
		/\b(movies|shows|events|concerts|games|news).*(out|in|at|on|playing|streaming|now|today|theaters?|available)\b/,
		/\bwhat (movies|shows|events|games|concerts|news)\b/,
		/\bwhat'?s (playing|showing|on|available|new|in theaters)\b/,
		/\bgive me (the|some)? (news|updates|info)\b/,
		/^(movies|shows|games|news)\b/i, // starts with these words
		/\bwhen (does|is|are)\b.*\b(open|close|start|end|release)\b/,
		/\b(explain|describe) (how|what|the)\b/,

		// Technical / factual
		/\brequirements? (for|to)\b/,
		/\bwhat (does|is|are).*\b(mean|do|work|include)\b/,
	];

	// Conversational triggers (follow-up, opinions, simple questions)
	const conversationalTriggers = [
		// Greetings / casual
		/^(hi|hey|hello|sup|yo|thanks|thank you|cool|nice|ok|okay|got it)\b/,

		// Opinions / subjective
		/\b(think|feel|opinion|recommend|suggest|prefer|favorite|like|love|hate)\b/,
		/\bshould i\b/,
		/\bwhat about\b/,
		/\bwhy (do you|would|is)\b/,

		// Follow-up questions (short, context-dependent)
		/^(and|but|so|also|or)\b/,
		/\bthat (one|movie|show|thing|option)\b/,
		/\bmore (about|on|details|info)\b/,
		/\btell me more\b/,

		// Simple factual queries
		/^(who|where|when) (is|are|was)\b/,
		/\bhow (long|much|many|old|far)\b/,
	];

	// Check for recent context - if there's conversation history, bias toward conversational
	const hasRecentContext =
		conversationHistory && conversationHistory.length > 2;

	// Check triggers
	const matchesInfo = infoTriggers.some((regex) => regex.test(prompt));
	const matchesConversational = conversationalTriggers.some((regex) =>
		regex.test(prompt)
	);

	// Decision logic
	let style: FormattingStyle = "conversational"; // default to conversational

	if (matchesInfo && !hasRecentContext) {
		// Info-style if matches info triggers and not in middle of conversation
		style = "info";
	} else if (matchesConversational) {
		// Always conversational if matches casual triggers
		style = "conversational";
	} else if (hasRecentContext) {
		// Default to conversational if in ongoing conversation
		style = "conversational";
	} else if (prompt.length > 100) {
		// Long complex queries might need structured response
		style = "info";
	}

	return {
		style,
		instructions: FORMATTING_STYLES[style],
	};
}
