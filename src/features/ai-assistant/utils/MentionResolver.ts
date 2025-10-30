import {
  PostgreSQLManager,
  type DatabaseResult,
} from "../../database/PostgreSQLManager";

/**
 * Resolves Discord user mentions (<@userId>) to display names
 * Queries PostgreSQL to get user display_name and replaces mentions in content
 */
export async function resolveMentionsInText(
  content: string,
  guildId: string,
  db: PostgreSQLManager
): Promise<string> {
  // Match Discord mentions: <@userId> or <@!userId>
  const mentionRegex = /<@!?(\d+)>/g;
  const mentions = Array.from(content.matchAll(mentionRegex));

  if (mentions.length === 0) {
    return content;
  }

  let resolved = content;
  const userIds = [...new Set(mentions.map((match) => match[1]))];

  // Batch query all unique user IDs
  const resolvedMentions = new Map<string, string>();

  for (const userId of userIds) {
    try {
      const result = await db.query(
        `SELECT display_name, username, global_name, nick
         FROM members 
         WHERE user_id = $1 AND guild_id = $2 AND active = true
         LIMIT 1`,
        [userId, guildId]
      );

      if (result.success && result.data && result.data.length > 0) {
        const member = result.data[0];
        const name =
          member.display_name ||
          member.global_name ||
          member.nick ||
          member.username;
        resolvedMentions.set(userId, name);
      } else {
        // Fallback: try inactive members
        const fallbackResult = await db.query(
          `SELECT display_name, username, global_name, nick
           FROM members 
           WHERE user_id = $1 AND guild_id = $2 AND active = false
           LIMIT 1`,
          [userId, guildId]
        );

        if (
          fallbackResult.success &&
          fallbackResult.data &&
          fallbackResult.data.length > 0
        ) {
          const member = fallbackResult.data[0];
          const name =
            member.display_name ||
            member.global_name ||
            member.nick ||
            member.username;
          resolvedMentions.set(userId, name);
        } else {
          // If user not found, keep the mention or use user ID
          resolvedMentions.set(userId, `@user${userId.slice(-4)}`);
        }
      }
    } catch (error) {
      console.error(`🔸 Error resolving mention for user ${userId}:`, error);
      resolvedMentions.set(userId, `@user${userId.slice(-4)}`);
    }
  }

  // Replace all mentions with resolved names
  for (const match of mentions) {
    const userId = match[1];
    const name = resolvedMentions.get(userId) || `@user${userId.slice(-4)}`;
    resolved = resolved.replace(match[0], `@${name}`);
  }

  return resolved;
}
