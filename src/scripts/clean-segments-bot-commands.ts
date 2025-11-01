import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

function isBotCommand(content: string): boolean {
  if (!content || content.trim().length === 0) return false;
  const trimmed = content.trim().toLowerCase();
  // Filter messages starting with m! (music bot commands: m!p, m!stop, m!skip, etc.)
  // or starting with . (bot commands: .spin, .play, etc.)
  return trimmed.startsWith("m!") || trimmed.startsWith(".");
}

function hasMeaningfulContent(content: string): boolean {
  if (!content || content.trim().length === 0) return false;
  
  // Remove Discord emoji/animated emoji patterns: <:name:id> or <a:name:id>
  const withoutEmojis = content.replace(/<(a?):[\w]+:\d+>/g, "");
  
  // Remove unicode emojis (basic check - single emoji characters)
  const withoutUnicode = withoutEmojis.replace(/[\u{1F300}-\u{1F9FF}]/gu, "");
  
  // Remove whitespace and common punctuation
  const trimmed = withoutUnicode.trim().replace(/^[^\w]*$/, "");
  
  // Must have at least 3 alphanumeric characters to be meaningful
  return trimmed.length >= 3 && /\w/.test(trimmed);
}

async function cleanSegmentsFromBotCommands() {
  const db = new PostgreSQLManager();

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect");
      return;
    }

    console.log("✅ Connected\n");

    const guildId = process.argv[2] || process.env.GUILD_ID;

    if (!guildId) {
      console.error("🔸 Usage: npm run clean:segments <guild_id>");
      console.error("   Or set GUILD_ID in .env");
      return;
    }

    console.log("🔹 Cleaning bot commands from conversation segments...\n");

    // Get all segments with their messages
    const segmentsResult = await db.query(
      `SELECT id, message_ids, message_count
       FROM conversation_segments
       WHERE guild_id = $1`,
      [guildId]
    );

    if (!segmentsResult.success || !segmentsResult.data) {
      console.error("🔸 Failed to fetch segments:", segmentsResult.error);
      return;
    }

    const segments = segmentsResult.data;
    console.log(`   Found ${segments.length} segments to process\n`);

    let segmentsUpdated = 0;
    let segmentsDeleted = 0;
    let totalMessagesRemoved = 0;

    for (const segment of segments) {
      const messageIds = Array.isArray(segment.message_ids)
        ? segment.message_ids
        : [];

      if (messageIds.length === 0) continue;

      // Get message contents
      const messagesResult = await db.query(
        `SELECT id, content
         FROM messages
         WHERE id = ANY($1::TEXT[]) AND active = true`,
        [messageIds]
      );

      if (!messagesResult.success || !messagesResult.data) continue;

      const messages = messagesResult.data as Array<{ id: string; content: string }>;

      // Filter out bot commands and messages without meaningful content
      const validMessageIds = messages
        .filter(
          (msg) =>
            !isBotCommand(msg.content || "") &&
            hasMeaningfulContent(msg.content || "")
        )
        .map((msg) => msg.id);

      // Require at least one message with substantial content (10+ chars)
      const hasSubstantialContent = messages.some(
        (msg) =>
          !isBotCommand(msg.content || "") &&
          hasMeaningfulContent(msg.content || "") &&
          msg.content &&
          msg.content.trim().length >= 10
      );

      // If no substantial content, delete the segment
      if (!hasSubstantialContent) {
        await db.query(`DELETE FROM conversation_segments WHERE id = $1`, [
          segment.id,
        ]);
        segmentsDeleted++;
        totalMessagesRemoved += messageIds.length;
        continue;
      }

      // If no valid messages left, delete the segment
      if (validMessageIds.length === 0) {
        await db.query(`DELETE FROM conversation_segments WHERE id = $1`, [
          segment.id,
        ]);
        segmentsDeleted++;
        totalMessagesRemoved += messageIds.length;
        continue;
      }

      // If all messages are valid, skip
      if (validMessageIds.length === messageIds.length) {
        continue;
      }

      // Update segment with filtered message IDs
      const removed = messageIds.length - validMessageIds.length;
      totalMessagesRemoved += removed;

      // Get participants from remaining messages
      const participantsResult = await db.query(
        `SELECT DISTINCT author_id
         FROM messages
         WHERE id = ANY($1::TEXT[]) AND active = true`,
        [validMessageIds]
      );

      if (!participantsResult.success || !participantsResult.data) continue;

      const participants = (participantsResult.data as Array<{ author_id: string }>)
        .map((p) => p.author_id)
        .filter((id) => id && id.trim().length > 0)
        .sort();

      if (participants.length < 2) {
        // Not enough participants, delete segment
        await db.query(`DELETE FROM conversation_segments WHERE id = $1`, [
          segment.id,
        ]);
        segmentsDeleted++;
        continue;
      }

      // Update segment
      await db.query(
        `UPDATE conversation_segments
         SET message_ids = $1::TEXT[],
             message_count = $2,
             participants = $3::TEXT[]
         WHERE id = $4`,
        [validMessageIds, validMessageIds.length, participants, segment.id]
      );

      segmentsUpdated++;
    }

    console.log("\n✅ Cleanup complete:");
    console.log(`   📝 Segments updated: ${segmentsUpdated}`);
    console.log(`   🗑️  Segments deleted: ${segmentsDeleted}`);
    console.log(`   📨 Bot command messages removed: ${totalMessagesRemoved}`);
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

cleanSegmentsFromBotCommands();

