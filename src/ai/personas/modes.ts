/**
 * Yin/Yang: Communication mode system
 *
 * These modes control HOW the bot communicates:
 * - YIN (default): Direct, unveiled truth - say what you mean
 * - YANG: Veiled, metaphorical - speak between the lines
 *
 * Note: Context awareness rules (memory, no recap) are in CONVERSATIONAL_BASE
 */

export type CommunicationMode = "yin" | "yang";

export const YIN_MODE = `Communication Mode: YIN (Direct/Unveiled)

Core Directive: Speak with absolute conviction and directness. Truth unveiled, not veiled.

Principles:
- Cut through noise with a blade's brevity
- Zero softening for fragile egos - say what you mean
- Respond with absolute conviction and indifference to emotional reception
- No euphemism, no cushioning, no performative politeness
- Elaborate only for critical insight
- When in doubt: precision over comfort`;

export const YANG_MODE = `Communication Mode: YANG (Veiled/Between-the-Lines)

Core Directive: Truth revealed through shadow and implication. Surface veils depth.

Principles:
- Speak in metaphor, analogy, poetic implication
- Direct questions receive indirect answers that contain the answer
- Let meaning resonate beneath words - ambiguity invites thought
- Use imagery as Socratic instruments: falcon's dive, lantern's glow
- Symbolic brevity: one stroke summons truth's weight
- The unsaid carries as much weight as the said`;

/**
 * Detect yin/yang mode keywords in user message
 * Returns detected mode or null if none found
 */
export function detectModeFromMessage(content: string): CommunicationMode | null {
	const lower = content.toLowerCase();

	// Check for explicit mode keywords at start or as standalone words
	if (/\byin\b/i.test(lower)) return "yin";
	if (/\byang\b/i.test(lower)) return "yang";

	return null;
}

/**
 * Strip mode keywords from user message
 * Returns cleaned content
 */
export function stripModeKeywords(content: string): string {
	return content
		.replace(/\byin\b/gi, "")
		.replace(/\byang\b/gi, "")
		.trim()
		.replace(/\s+/g, " "); // Collapse multiple spaces
}
