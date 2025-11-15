import "dotenv/config";
import { config } from "../config/index.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { ConversationManager } from "../features/relationship-network/ConversationManager.js";
import { KNOWN_BOT_USER_IDS } from "../features/relationship-network/constants.js";
import { AIManager } from "../features/ai-assistant/AIManager.js";
import {
  extractMentionedUserIds,
  parseEmbedding,
} from "../features/relationship-network/messageUtils.js";

export interface BackfillOptions {
  channelIds?: string[];
  sleepBetweenChannelsMs?: number;
  forceEnableTopicSplitting?: boolean;
}

export async function backfillRecentConversations(
  guildId: string,
  hours: number = 24,
  options: BackfillOptions = {}
): Promise<void> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const db = new PostgreSQLManager();
  const conversationManager = new ConversationManager(db);
  const useTopicSplitting =
    options.forceEnableTopicSplitting ?? config.enableTopicSplitting;

  if (useTopicSplitting) {
    const aiManager = AIManager.getInstance();
    conversationManager.setAIManager(aiManager);
  }

  console.log(
    `🔹 Backfilling conversations for guild ${guildId} (last ${hours}h, since ${since.toISOString()})`
  );

  const connected = await db.connect();
  if (!connected) {
    throw new Error("Failed to connect to PostgreSQL for backfill");
  }

  try {
    let channels: string[] | undefined = options.channelIds;

    if (!channels || channels.length === 0) {
      const channelsResult = await db.query(
        `
        SELECT DISTINCT channel_id
        FROM messages
        WHERE guild_id = $1
          AND active = true
          AND created_at >= $2
      `,
        [guildId, since]
      );

      if (!channelsResult.success || !channelsResult.data) {
        console.warn("🔸 No recent channels found for backfill.");
        return;
      }

      channels = channelsResult.data.map(
        (row: { channel_id: string }) => row.channel_id
      );
    }

    if (!channels || channels.length === 0) {
      console.warn("🔸 No channels specified or discovered for backfill.");
      return;
    }

    const botUserIdSet = new Set(KNOWN_BOT_USER_IDS);

    for (const channelId of channels) {

      const deleteResult = await db.query(
        `
          DELETE FROM conversation_segments
          WHERE guild_id = $1
            AND channel_id = $2
            AND start_time >= $3
        `,
        [guildId, channelId, since]
      );

      if (!deleteResult.success) {
        console.warn(
          `   🔸 Failed to delete old segments for channel ${channelId}: ${deleteResult.error}`
        );
        continue;
      }

      const messagesResult = await db.query(
        `
          SELECT id, author_id, content, created_at, referenced_message_id, embedding
          FROM messages
          WHERE guild_id = $1
            AND channel_id = $2
            AND active = true
            AND created_at >= $3
            AND author_id != ALL($4::TEXT[])
          ORDER BY created_at ASC
        `,
        [guildId, channelId, since, KNOWN_BOT_USER_IDS]
      );

      if (!messagesResult.success || !messagesResult.data) {
        console.warn(
          `   🔸 Failed to load messages for channel ${channelId}: ${messagesResult.error}`
        );
        continue;
      }

      const messages = messagesResult.data as Array<{
        id: string;
        author_id: string;
        content: string;
        created_at: Date;
        referenced_message_id?: string | null;
        embedding?: number[] | string | null;
      }>;

      if (messages.length === 0) {
        console.log("   🔸 No eligible messages to backfill.");
        continue;
      }



      for (const message of messages) {
        const mentions = extractMentionedUserIds(
          message.content,
          botUserIdSet
        );
        await conversationManager.addMessageToStream({
          id: message.id,
          author_id: message.author_id,
          content: message.content,
          created_at: new Date(message.created_at),
          guild_id: guildId,
          channel_id: channelId,
          referenced_message_id: message.referenced_message_id || undefined,
          mentioned_user_ids: mentions.length > 0 ? mentions : undefined,
          embedding: parseEmbedding(message.embedding),
        });
      }

      await conversationManager.finalizeAllSegments();

      if (
        options.sleepBetweenChannelsMs &&
        options.sleepBetweenChannelsMs > 0
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.sleepBetweenChannelsMs)
        );
      }
    }
  } finally {
    await db.disconnect();
  }
}

async function runFromCli() {
  const guildId = process.argv[2] || process.env.GUILD_ID;
  const hours = Number(process.argv[3] || "24");

  if (!guildId) {
    console.error(
      "🔸 Usage: bun --bun src/scripts/backfill-recent-conversations.ts <guildId> [hours]"
    );
    process.exit(1);
  }

  await backfillRecentConversations(guildId, hours);
}

const invokedDirectly =
  process.argv[1]?.includes("backfill-recent-conversations") ?? false;

if (invokedDirectly) {
  runFromCli().catch((error) => {
    console.error("🔸 Failed to backfill recent conversations:", error);
    process.exit(1);
  });
}
