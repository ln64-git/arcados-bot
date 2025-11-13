import "dotenv/config";
import path from "node:path";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

const CHANNEL_ID = process.argv[2] || process.env.CHANNEL_ID;
const HOURS = Number(process.argv[3] || "24");
const GUILD_ID = process.env.GUILD_ID;

if (!GUILD_ID) {
  console.error("❌ GUILD_ID is required.");
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error("❌ Channel ID required. Usage: GUILD_ID=... bun run list:channel -- <channelId> [hours]");
  process.exit(1);
}

const runningWithBun =
  Boolean(process.env.BUN_INSTALL) ||
  path.basename(process.argv[0] || "").toLowerCase().includes("bun");

if (!runningWithBun) {
  console.error("⚠️  Please run this script with Bun (bun run list:channel …) to avoid tsx IPC issues.");
  process.exit(1);
}

async function main() {
  const db = new PostgreSQLManager();
  if (!(await db.connect())) {
    console.error("❌ Could not connect to PostgreSQL");
    process.exit(1);
  }

  try {
    const cutoff = new Date(Date.now() - HOURS * 60 * 60 * 1000);

    const messagesResult = await db.query(
      `SELECT m.id,
              m.author_id,
              COALESCE(mem.display_name, mem.username, m.author_id) AS author_name,
              m.content,
              m.created_at
         FROM messages m
    LEFT JOIN members mem
           ON mem.user_id = m.author_id
          AND mem.guild_id = m.guild_id
        WHERE m.guild_id = $1
          AND m.channel_id = $2
          AND m.created_at >= $3
          AND m.active = true
     ORDER BY m.created_at ASC`,
      [GUILD_ID, CHANNEL_ID, cutoff]
    );

    if (!messagesResult.success || !messagesResult.data) {
      console.error("❌ Failed to fetch messages:", messagesResult.error);
      return;
    }

    const messageIds = messagesResult.data.map((row: any) => row.id);

    const segmentsResult = await db.query(
      `SELECT id as segment_id,
              message_ids
         FROM conversation_segments
        WHERE guild_id = $1
          AND channel_id = $2
          AND message_ids && $3::TEXT[]`,
      [GUILD_ID, CHANNEL_ID, messageIds]
    );

    const messageToSegment = new Map<string, string>();
    if (segmentsResult.success && segmentsResult.data) {
      for (const row of segmentsResult.data) {
        if (Array.isArray(row.message_ids)) {
          for (const mid of row.message_ids) {
            messageToSegment.set(mid, row.segment_id);
          }
        }
      }
    }

    console.log(
      `\nMessages in channel ${CHANNEL_ID} from the last ${HOURS}h (guild ${GUILD_ID}):\n`
    );

    for (const row of messagesResult.data) {
      const segmentId = messageToSegment.get(row.id) || "-";
      const time = new Date(row.created_at).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      console.log(
        `[${segmentId}] ${time} ${row.author_name}: ${row.content || "(no content)"}`
      );
    }
  } finally {
    await db.disconnect();
  }
}

main().catch((err) => {
  console.error("💥 Error:", err);
  process.exit(1);
});
