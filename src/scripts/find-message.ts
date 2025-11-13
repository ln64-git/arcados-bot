import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { AnalysisFormatter } from "./utils/analysis-formatter.js";

async function findMessage() {
  const messageId = process.argv[2];
  const guildIdArg = process.argv[3] || process.env.GUILD_ID;

  if (!messageId) {
    console.error("❌ Usage: npx tsx src/scripts/find-message.ts <message_id> [guild_id]");
    process.exit(1);
  }

  const db = new PostgreSQLManager();
  await db.connect();

  try {
    const messageResult = await db.query(
      `SELECT m.id, m.guild_id, m.channel_id, c.name as channel_name,
              m.author_id, m.content, m.created_at
       FROM messages m
       LEFT JOIN channels c ON c.id = m.channel_id
       WHERE m.id = $1`,
      [messageId]
    );

    if (!messageResult.success || !messageResult.data || messageResult.data.length === 0) {
      console.error(`⚠️  Message ${messageId} not found in database.`);
      return;
    }

    const message = messageResult.data[0];
    const guildId = guildIdArg || message.guild_id;

    AnalysisFormatter.section("MESSAGE DETAILS", 80);
    AnalysisFormatter.metric("Message ID", message.id);
    AnalysisFormatter.metric("Guild ID", message.guild_id);
    AnalysisFormatter.metric("Channel", `${message.channel_name || "unknown"} (${message.channel_id})`);
    AnalysisFormatter.metric("Author", message.author_id);
    AnalysisFormatter.metric("Timestamp", new Date(message.created_at).toLocaleString());
    console.log("\nContent:\n", message.content || "(no content)");
    AnalysisFormatter.subsectionEnd(80);

    if (!guildId) {
      console.log("⚠️  Guild ID not provided; skipped conversation lookup.");
      return;
    }

    const convoResult = await db.query(
      `SELECT id, start_time, end_time, message_count, channel_id
       FROM conversation_segments
       WHERE guild_id = $1 AND message_ids && ARRAY[$2::TEXT]`,
      [guildId, messageId]
    );

    if (!convoResult.success || !convoResult.data || convoResult.data.length === 0) {
      console.log("⚠️  Message is not currently attached to any conversation segment.");
      return;
    }

    AnalysisFormatter.section("CONVERSATION MEMBERSHIP", 80);
    for (const convo of convoResult.data) {
      AnalysisFormatter.metric("Segment ID", convo.id);
      AnalysisFormatter.metric("Channel ID", convo.channel_id);
      AnalysisFormatter.metric("Messages", convo.message_count);
      AnalysisFormatter.metric("Start", new Date(convo.start_time).toLocaleString());
      AnalysisFormatter.metric("End", new Date(convo.end_time).toLocaleString());
      console.log("─".repeat(60));
    }
  } finally {
    await db.disconnect();
  }
}

findMessage().catch((error) => {
  console.error("💥 Unexpected error:", error);
  process.exit(1);
});
