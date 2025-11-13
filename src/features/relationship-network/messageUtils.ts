const mentionRegex = /<@!?(\d+)>/g;

export function extractMentionedUserIds(
  content: string | undefined | null,
  botUserIds?: Set<string>
): string[] {
  if (!content) {
    return [];
  }

  mentionRegex.lastIndex = 0;
  const mentioned = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(content)) !== null) {
    const id = match[1];
    if (!id) continue;
    if (botUserIds && botUserIds.has(id)) continue;
    mentioned.add(id);
  }
  return Array.from(mentioned);
}

export function parseEmbedding(raw: unknown): number[] | undefined {
  if (!raw) {
    return undefined;
  }

  if (Array.isArray(raw)) {
    return raw as number[];
  }

  if (typeof raw === "string") {
    let cleaned = raw.trim();
    if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
      cleaned = `[${cleaned.slice(1, -1)}]`;
    }
    try {
      return JSON.parse(cleaned) as number[];
    } catch {
      return undefined;
    }
  }

  return undefined;
}
