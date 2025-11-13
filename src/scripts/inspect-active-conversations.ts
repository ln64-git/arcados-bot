import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { AnalysisFormatter } from "./utils/analysis-formatter.js";

interface ConversationSegment {
  id: string;
  guild_id: string;
  channel_id: string;
  channel_name?: string;
  participants: string[];
  start_time: Date;
  end_time: Date;
  message_count: number;
  summary?: string;
  status?: string;
}

interface Message {
  id: string;
  author_id: string;
  content: string;
  created_at: Date;
  referenced_message_id?: string;
  display_name?: string;
  username?: string;
}

interface CliOptions {
  guildId?: string;
  lookbackHours: number;
  label: string;
}

function parseCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  let guildId: string | undefined;
  let days: number | undefined;
  let hours: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg.startsWith("--")) {
      const key = arg.replace(/^--/, "");
      const next = args[i + 1];
      switch (key) {
        case "days":
          if (next && !next.startsWith("--")) {
            const value = Number(next);
            if (!Number.isNaN(value) && value > 0) {
              days = value;
            }
            i++;
          }
          break;
        case "hours":
          if (next && !next.startsWith("--")) {
            const value = Number(next);
            if (!Number.isNaN(value) && value > 0) {
              hours = value;
            }
            i++;
          }
          break;
        default:
          break;
      }
    } else if (!guildId) {
      guildId = arg;
    }
  }

  const lookbackHours =
    typeof hours === "number"
      ? hours
      : typeof days === "number"
      ? days * 24
      : 24;

  const label =
    typeof days === "number"
      ? `${days} day${days === 1 ? "" : "s"}`
      : `${lookbackHours} hour${lookbackHours === 1 ? "" : "s"}`;

  return { guildId, lookbackHours, label };
}

async function inspectActiveConversations() {
  const db = new PostgreSQLManager();

  try {
    await db.connect();

    const { guildId: cliGuildId, lookbackHours, label } = parseCliOptions();
    const guildId = cliGuildId || process.env.GUILD_ID;
    if (!guildId) {
      console.error("\n❌ Error: Guild ID required");
      console.error(
        "Usage: npm run inspect:conversations <guild_id?> [--days N | --hours N]\n"
      );
      return;
    }

    // Get guild name for display
    const guildResult = await db.query(
      "SELECT name FROM guilds WHERE id = $1",
      [guildId]
    );
    const guildName = guildResult.data?.[0]?.name || guildId;

    AnalysisFormatter.section(
      `ACTIVE CONVERSATIONS (PAST ${label.toUpperCase()}) - ${guildName.toUpperCase()}`,
      90
    );

    const lookbackStart = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    // Quick statistics
    AnalysisFormatter.subsection("Quick Statistics", 88);

    const stats = await db.query(
      `
			SELECT
				COUNT(*) as total_segments,
				COUNT(CASE WHEN status = 'active' THEN 1 END) as active_now,
				COUNT(CASE WHEN status = 'finalized' THEN 1 END) as finalized,
				SUM(message_count) as total_messages,
				AVG(message_count) as avg_messages,
				MAX(message_count) as max_messages,
				COUNT(DISTINCT channel_id) as active_channels,
				AVG(EXTRACT(EPOCH FROM (end_time - start_time)) / 60) as avg_duration_min
			FROM conversation_segments
			WHERE guild_id = $1 AND start_time >= $2
			`,
      [guildId, lookbackStart]
    );

    if (stats.data && stats.data[0]) {
      const s = stats.data[0];
      AnalysisFormatter.metric(
        "Total Segments (24h)",
        AnalysisFormatter.formatNumber(s.total_segments)
      );
      AnalysisFormatter.metric(
        "Active Now",
        AnalysisFormatter.formatNumber(s.active_now || 0)
      );
      AnalysisFormatter.metric(
        "Finalized",
        AnalysisFormatter.formatNumber(s.finalized || 0)
      );
      console.log("│");
      AnalysisFormatter.metric(
        "Total Messages",
        AnalysisFormatter.formatNumber(s.total_messages || 0)
      );
      AnalysisFormatter.metric(
        "Average Messages/Segment",
        parseFloat(s.avg_messages || "0").toFixed(1)
      );
      AnalysisFormatter.metric(
        "Largest Segment",
        AnalysisFormatter.formatNumber(s.max_messages || 0)
      );
      console.log("│");
      AnalysisFormatter.metric(
        "Active Channels",
        AnalysisFormatter.formatNumber(s.active_channels || 0)
      );
      AnalysisFormatter.metric(
        "Avg Duration",
        AnalysisFormatter.formatDuration(parseFloat(s.avg_duration_min || "0"))
      );
    }
    AnalysisFormatter.subsectionEnd(88);

    // Get all conversation segments from last 24 hours
    const segmentsResult = await db.query(
      `SELECT
				cs.id,
				cs.guild_id,
				cs.channel_id,
				c.name as channel_name,
				cs.participants,
				cs.start_time,
				cs.end_time,
				cs.message_count,
				cs.summary,
				cs.status
			FROM conversation_segments cs
			LEFT JOIN channels c ON c.id = cs.channel_id
			WHERE cs.guild_id = $1
				AND cs.start_time >= $2
			ORDER BY cs.start_time DESC`,
      [guildId, lookbackStart]
    );

    if (!segmentsResult.success || !segmentsResult.data) {
      AnalysisFormatter.error(
        `Failed to fetch segments: ${segmentsResult.error}`
      );
      return;
    }

    const segments = segmentsResult.data as ConversationSegment[];

    if (segments.length === 0) {
      AnalysisFormatter.warning(
        "No conversation segments in the last 24 hours"
      );
      await db.disconnect();
      return;
    }

    // Get participant names
    const allUserIds = new Set<string>();
    segments.forEach((seg) => {
      seg.participants.forEach((uid) => allUserIds.add(uid));
    });

    const userIds = Array.from(allUserIds);
    const nameMap = new Map<string, string>();

    if (userIds.length > 0) {
      const namesResult = await db.query(
        `SELECT user_id, display_name, username
				FROM members
				WHERE guild_id = $1 AND user_id = ANY($2::TEXT[]) AND active = true`,
        [guildId, userIds]
      );

      if (namesResult.success && namesResult.data) {
        for (const row of namesResult.data) {
          const displayName = row.display_name || row.username || row.user_id;
          nameMap.set(row.user_id, displayName);
        }
      }
    }

    // Display each conversation segment
    AnalysisFormatter.subsection(
      `Conversation Details (${segments.length} segments)`,
      88
    );

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Deduplicate participants for display
      const uniqueParticipants = Array.from(
        new Set(Array.isArray(segment.participants) ? segment.participants : [])
      );
      const participantNames = uniqueParticipants
        .map((uid) => nameMap.get(uid) || uid.substring(0, 8))
        .join(", ");

      const duration =
        (new Date(segment.end_time).getTime() -
          new Date(segment.start_time).getTime()) /
        1000 /
        60;

      // Header
      console.log("│");
      console.log(
        `│ ${i + 1}. ${
          segment.channel_name || segment.channel_id.substring(0, 20)
        } ${segment.status === "active" ? "🟢 ACTIVE" : "⚪"}`
      );
      console.log(`│    Participants: ${participantNames}`);
      console.log(
        `│    ${segment.message_count} messages • ${duration.toFixed(
          1
        )} min • ${uniqueParticipants.length} people`
      );
      console.log(
        `│    ${new Date(segment.start_time).toLocaleString()} → ${new Date(
          segment.end_time
        ).toLocaleString()}`
      );

      // Fetch messages
      const messagesResult = await db.query(
        `SELECT
					m.id,
					m.author_id,
					m.content,
					m.created_at,
					m.referenced_message_id,
					u.display_name,
					u.username
				FROM conversation_segments cs
				JOIN messages m ON m.id = ANY(cs.message_ids::TEXT[])
				LEFT JOIN members u ON u.user_id = m.author_id AND u.guild_id = m.guild_id
				WHERE cs.id = $1 AND m.active = true
				ORDER BY m.created_at ASC`,
        [segment.id]
      );

      if (messagesResult.success && messagesResult.data) {
        const messages = messagesResult.data as Message[];
        console.log("│");
        console.log("│    Messages:");

        // Show first 5 and last 5 messages if more than 10
        const messagesToShow =
          messages.length > 10
            ? [...messages.slice(0, 5), ...messages.slice(-5)]
            : messages;

        for (let j = 0; j < messagesToShow.length; j++) {
          const msg = messagesToShow[j];
          const authorName =
            msg.display_name || msg.username || msg.author_id.substring(0, 8);
          const timestamp = new Date(msg.created_at).toLocaleTimeString(
            "en-US",
            {
              hour: "2-digit",
              minute: "2-digit",
            }
          );
          const content = msg.content || "(no content)";
          const isReply = msg.referenced_message_id ? "↪ " : "";

          // Show separator if we skipped messages
          if (messages.length > 10 && j === 5) {
            console.log(
              `│       ... (${messages.length - 10} more messages) ...`
            );
          }

          // Truncate long messages
          const displayContent =
            content.length > 120 ? content.substring(0, 120) + "..." : content;

          console.log(
            `│       ${timestamp} ${isReply}${authorName}: ${displayContent}`
          );
        }
      } else {
        console.log("│    (Unable to fetch messages)");
      }

      if (segment.summary) {
        console.log("│");
        console.log(`│    Summary: ${segment.summary}`);
      }

      // Separator between segments (except last one)
      if (i < segments.length - 1) {
        console.log("│    " + "─".repeat(84));
      }
    }

    AnalysisFormatter.subsectionEnd(88);

    // Channel breakdown
    AnalysisFormatter.subsection("Activity by Channel", 88);

    const channelBreakdown = await db.query(
      `SELECT
				cs.channel_id,
				c.name as channel_name,
				COUNT(DISTINCT cs.id) as segment_count,
				SUM(cs.message_count) as total_messages,
				AVG(cs.message_count) as avg_messages,
				COUNT(DISTINCT p.participant) as unique_participants,
				MAX(cs.end_time) as last_activity
			FROM conversation_segments cs
			LEFT JOIN channels c ON c.id = cs.channel_id
			LEFT JOIN LATERAL unnest(cs.participants) AS p(participant) ON true
			WHERE cs.guild_id = $1 AND cs.start_time >= $2
			GROUP BY cs.channel_id, c.name
			ORDER BY segment_count DESC`,
      [guildId, lookbackStart]
    );

    if (channelBreakdown.data && channelBreakdown.data.length > 0) {
      const columns = [
        { header: "Channel", width: 30, align: "left" as const },
        { header: "Segments", width: 10, align: "right" as const },
        { header: "Messages", width: 10, align: "right" as const },
        { header: "Avg/Seg", width: 10, align: "right" as const },
        { header: "People", width: 8, align: "right" as const },
        { header: "Last Activity", width: 18, align: "left" as const },
      ];

      const rows = channelBreakdown.data.map((ch) => {
        const name = (ch.channel_name || ch.channel_id).substring(0, 29);
        const lastActivity = new Date(ch.last_activity).toLocaleString(
          "en-US",
          {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }
        );
        return [
          name,
          AnalysisFormatter.formatNumber(ch.segment_count),
          AnalysisFormatter.formatNumber(ch.total_messages),
          parseFloat(ch.avg_messages || "0").toFixed(1),
          AnalysisFormatter.formatNumber(ch.unique_participants),
          lastActivity,
        ];
      });

      AnalysisFormatter.table(columns, rows);
    }

    AnalysisFormatter.subsectionEnd(88);

    // Most active participants
    AnalysisFormatter.subsection(
      `Most Active Participants (${label})`,
      88
    );

    const participantActivity = await db.query(
      `SELECT
				unnest(cs.participants) as user_id,
				COUNT(*) as segment_count,
				SUM(cs.message_count) as total_messages
			FROM conversation_segments cs
			WHERE cs.guild_id = $1 AND cs.start_time >= $2
			GROUP BY user_id
			ORDER BY segment_count DESC
			LIMIT 15`,
      [guildId, lookbackStart]
    );

    if (participantActivity.data && participantActivity.data.length > 0) {
      // Get names for these users
      const topUserIds = participantActivity.data.map((p) => p.user_id);
      const topNamesResult = await db.query(
        `SELECT user_id, display_name, username
				FROM members
				WHERE guild_id = $1 AND user_id = ANY($2::TEXT[]) AND active = true`,
        [guildId, topUserIds]
      );

      const topNameMap = new Map<string, string>();
      if (topNamesResult.success && topNamesResult.data) {
        for (const row of topNamesResult.data) {
          const displayName = row.display_name || row.username || row.user_id;
          topNameMap.set(row.user_id, displayName);
        }
      }

      const columns = [
        { header: "Rank", width: 6, align: "right" as const },
        { header: "User", width: 30, align: "left" as const },
        { header: "Segments", width: 10, align: "right" as const },
        { header: "Total Messages", width: 15, align: "right" as const },
        { header: "Avg/Segment", width: 13, align: "right" as const },
      ];

      const rows = participantActivity.data.map((p, i) => {
        const name = (topNameMap.get(p.user_id) || p.user_id).substring(0, 29);
        const avgMessages = (
          parseInt(p.total_messages) / parseInt(p.segment_count)
        ).toFixed(1);
        return [
          i + 1,
          name,
          AnalysisFormatter.formatNumber(p.segment_count),
          AnalysisFormatter.formatNumber(p.total_messages),
          avgMessages,
        ];
      });

      AnalysisFormatter.table(columns, rows);
    }

    AnalysisFormatter.subsectionEnd(88);

    AnalysisFormatter.success("Inspection complete");

    await db.disconnect();
  } catch (error) {
    AnalysisFormatter.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    await db.disconnect();
    process.exit(1);
  }
}

inspectActiveConversations();
