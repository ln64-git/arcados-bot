import {
  type DatabaseTool,
  type ToolContext,
  type DatabaseToolResult,
} from "../DatabaseTools";

function scoreNiceness(text: string): number {
  const content = (text || "").toLowerCase();
  // Simple lexicon; extend over time. Values roughly in [-2, +2]
  const positive = [
    "thanks",
    "thank you",
    "please",
    "welcome",
    "appreciate",
    "nice",
    "good",
    "great",
    "love",
    "awesome",
    ":)",
    "<3",
  ];
  const negative = [
    "hate",
    "stupid",
    "idiot",
    "dumb",
    "trash",
    "shit",
    "fuck",
    "asshole",
    "bitch",
    "loser",
    ":(",
  ];

  let score = 0;
  for (const p of positive) if (content.includes(p)) score += 1;
  for (const n of negative) if (content.includes(n)) score -= 1;
  // Normalize: clamp to [-2, 2]
  if (score > 2) score = 2;
  if (score < -2) score = -2;
  return score;
}

export const rankUsersByNicenessTool: DatabaseTool = {
  name: "rankUsersByNiceness",
  description:
    "Rank users by 'niceness' of their recent messages in the guild using a lightweight sentiment heuristic.",
  parameters: {
    type: "object",
    properties: {
      lookbackHours: {
        type: "number",
        description: "Hours to look back (default: 72)",
      },
      lookbackDays: {
        type: "number",
        description: "Days to look back (alternative to hours)",
      },
      minMessages: {
        type: "number",
        description: "Minimum messages required to include a user (default: 10)",
      },
      limitUsers: {
        type: "number",
        description: "Max users to include in the ranking (default: 20)",
      },
      channelId: {
        type: "string",
        description: "Optional channel scope",
      },
    },
    required: [],
  },
  execute: async (
    params: {
      lookbackHours?: number;
      lookbackDays?: number;
      minMessages?: number;
      limitUsers?: number;
      channelId?: string;
    },
    context: ToolContext
  ): Promise<string | DatabaseToolResult> => {
    try {
      const hours = params.lookbackDays
        ? params.lookbackDays * 24
        : params.lookbackHours || 72;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      const minMessages = Math.max(1, params.minMessages || 10);
      const limitUsers = Math.max(1, Math.min(params.limitUsers || 20, 50));

      // Fetch recent messages; we aggregate per author in memory for simple scoring
      let query = `SELECT m.author_id, m.channel_id, m.content, m.created_at,
                          mem.display_name, mem.username
                   FROM messages m
                   JOIN members mem ON mem.user_id = m.author_id AND mem.guild_id = m.guild_id
                   WHERE m.guild_id = $1 AND m.active = true AND m.created_at >= $2`;
      const args: any[] = [context.guildId, since];
      if (params.channelId) {
        query += ` AND m.channel_id = $3`;
        args.push(params.channelId);
      }
      // Reasonable cap for analysis window
      query += ` ORDER BY m.created_at DESC LIMIT ${params.channelId ? 3000 : 6000}`;

      const result = await context.db.query(query, args);
      if (!result.success || !result.data) {
        return { success: false, error: "Failed to fetch messages for analysis" };
      }

      const byUser = new Map<string, {
        name: string;
        messages: string[];
        scores: number[];
      }>();

      for (const row of result.data) {
        const uid: string = row.author_id;
        const name: string = row.display_name || row.username || uid;
        if (!byUser.has(uid)) byUser.set(uid, { name, messages: [], scores: [] });
        const entry = byUser.get(uid)!;
        const content = row.content || "";
        entry.messages.push(content);
        entry.scores.push(scoreNiceness(content));
      }

      // Compute averages and filter by activity threshold
      const ranked = Array.from(byUser.entries())
        .map(([userId, data]) => {
          const count = data.scores.length;
          const avg = count > 0 ? data.scores.reduce((a, b) => a + b, 0) / count : 0;
          return { userId, name: data.name, count, avg };
        })
        .filter((r) => r.count >= minMessages)
        // Primary: niceness avg desc; Secondary: message count desc
        .sort((a, b) => (b.avg - a.avg) || (b.count - a.count))
        .slice(0, limitUsers);

      if (ranked.length === 0) {
        return {
          success: true,
          summary: `No users met the activity threshold in the last ${hours}h`,
          data: { formatted: "No ranking available", ranking: [], count: 0 },
        };
      }

      // Map avg in [-2,2] => rating 1..10
      const toTen = (avg: number) => {
        const scaled = Math.round(((avg + 2) / 4) * 9) + 1; // 1..10
        return Math.max(1, Math.min(10, scaled));
      };

      const formatted = ranked
        .map((r, idx) => {
          const rating = toTen(r.avg);
          const position = 10 - idx >= 1 ? rating : rating; // keep rating as computed
          return `${rating} - ${r.name} (avg: ${r.avg.toFixed(2)}, msgs: ${r.count})`;
        })
        .join("\n");

      return {
        success: true,
        summary: `Ranked ${ranked.length} user(s) by niceness over ~${hours}h`,
        data: { formatted, ranking: ranked, count: ranked.length },
      };
    } catch (error) {
      console.error("🔸 Error in rankUsersByNiceness:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to rank users by niceness",
      };
    }
  },
};

export const analysisTools: DatabaseTool[] = [rankUsersByNicenessTool];


