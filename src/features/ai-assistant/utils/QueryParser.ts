/**
 * Query Parser - Extracts entities and semantic content from user queries
 *
 * Separates identity/structure (users, channels, time) from semantic content
 * for hybrid search (programmatic filters + vector similarity)
 */

export interface ParsedQuery {
  semanticQuery: string; // Clean query for embedding (no names/IDs)
  userMentions: string[]; // Extracted user IDs or names
  channelMentions: string[]; // Extracted channel IDs or names
  timeHints: string[]; // Time references (yesterday, last week, etc.)
  originalQuery: string; // Original user input
}

/**
 * Parse a natural language query to extract entities and semantic content
 */
export function parseQuery(query: string): ParsedQuery {
  let semanticQuery = query;
  const userMentions: string[] = [];
  const channelMentions: string[] = [];
  const timeHints: string[] = [];

  // Extract Discord user mentions (<@123456789>)
  const userMentionPattern = /<@!?(\d+)>/g;
  let match: RegExpExecArray | null;
  while ((match = userMentionPattern.exec(query)) !== null) {
    if (match[1]) {
      userMentions.push(match[1]);
    }
    semanticQuery = semanticQuery.replace(match[0], "");
  }

  // Extract Discord channel mentions (<#123456789>)
  const channelMentionPattern = /<#(\d+)>/g;
  while ((match = channelMentionPattern.exec(query)) !== null) {
    if (match[1]) {
      channelMentions.push(match[1]);
    }
    semanticQuery = semanticQuery.replace(match[0], "");
  }

  // Extract time references
  const timePatterns = [
    /\b(yesterday|today|tonight|last\s+week|last\s+month|this\s+week|this\s+month)\b/gi,
    /\b(\d+)\s+(day|week|month|hour)s?\s+ago\b/gi,
    /\bin\s+the\s+last\s+(\d+)\s+(day|week|month|hour)s?\b/gi,
  ];

  for (const pattern of timePatterns) {
    while ((match = pattern.exec(query)) !== null) {
      timeHints.push(match[0].toLowerCase());
      // Don't remove time hints from semantic query as they provide context
    }
  }

  // Clean up semantic query
  semanticQuery = semanticQuery
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();

  return {
    semanticQuery,
    userMentions,
    channelMentions,
    timeHints,
    originalQuery: query,
  };
}

/**
 * Convert time hint to lookback days
 */
export function timeHintToLookbackDays(timeHint: string): number {
  const hint = timeHint.toLowerCase();

  if (hint.includes("yesterday") || hint.includes("today")) {
    return 1;
  }

  if (hint.includes("last week") || hint.includes("this week")) {
    return 7;
  }

  if (hint.includes("last month") || hint.includes("this month")) {
    return 30;
  }

  // Parse "N days/weeks/months ago" or "in the last N days/weeks/months"
  const match = hint.match(/(\d+)\s+(day|week|month|hour)s?/);
  if (match && match[1] && match[2]) {
    const count = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case "hour":
        return Math.max(1, Math.ceil(count / 24));
      case "day":
        return count;
      case "week":
        return count * 7;
      case "month":
        return count * 30;
    }
  }

  // Default: 30 days
  return 30;
}

/**
 * Extract user names from query (simple pattern matching)
 * Note: This is a basic implementation. For production, you might want
 * to use a more sophisticated NLP approach or maintain a name dictionary
 */
export function extractUserNames(query: string, knownUsers: Array<{ id: string; name: string; username: string }>): string[] {
  const extractedIds: string[] = [];
  const lowerQuery = query.toLowerCase();

  for (const user of knownUsers) {
    // Check if display name or username appears in query
    const displayName = user.name.toLowerCase();
    const username = user.username.toLowerCase();

    // Use word boundaries to avoid partial matches
    const displayPattern = new RegExp(`\\b${escapeRegex(displayName)}\\b`, "i");
    const usernamePattern = new RegExp(`\\b${escapeRegex(username)}\\b`, "i");

    if (displayPattern.test(query) || usernamePattern.test(query)) {
      extractedIds.push(user.id);
    }
  }

  return extractedIds;
}

/**
 * Extract channel names from query
 */
export function extractChannelNames(
  query: string,
  knownChannels: Array<{ id: string; name: string }>
): string[] {
  const extractedIds: string[] = [];
  const lowerQuery = query.toLowerCase();

  for (const channel of knownChannels) {
    const channelName = channel.name.toLowerCase();

    // Match with or without # prefix
    const patterns = [
      new RegExp(`\\b${escapeRegex(channelName)}\\b`, "i"),
      new RegExp(`#${escapeRegex(channelName)}\\b`, "i"),
    ];

    if (patterns.some((p) => p.test(query))) {
      extractedIds.push(channel.id);
    }
  }

  return extractedIds;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
