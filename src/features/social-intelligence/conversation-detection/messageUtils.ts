/**
 * Utility functions for message processing
 */

/**
 * Parse embedding from database format (string or array) to number array
 */
export function parseEmbedding(embedding: any): number[] | undefined {
	if (!embedding) return undefined;

	if (Array.isArray(embedding)) {
		return embedding;
	}

	if (typeof embedding === "string") {
		// PostgreSQL array format: "{0.1,0.2,0.3}" or "[0.1,0.2,0.3]"
		const cleaned = embedding.replace(/[{}[\]]/g, "");
		return cleaned.split(",").map((v) => parseFloat(v.trim()));
	}

	return undefined;
}

/**
 * Extract mentioned user IDs from message content
 */
export function extractMentionedUserIds(content: string, knownBotIds?: Set<string>): string[] {
	const mentionRegex = /<@!?(\d+)>/g;
	const mentions: string[] = [];
	let match: RegExpExecArray | null;

	while ((match = mentionRegex.exec(content)) !== null) {
		const userId = match[1];
		if (!knownBotIds || !knownBotIds.has(userId)) {
			mentions.push(userId);
		}
	}

	return mentions;
}
