import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { RelationshipNetworkManager } from "../features/relationship-network/NetworkManager";
import { ConversationManager } from "../features/relationship-network/ConversationManager";

interface ProcessedMessage {
  id: string;
  guild_id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: Date;
  referenced_message_id?: string | null;
}

async function generateRelationshipsFromHistory() {
  const db = new PostgreSQLManager();
  const relationshipManager = new RelationshipNetworkManager(db);
  const conversationManager = new ConversationManager(db);

  try {
    console.log("🔹 Connecting to database...");
    const connected = await db.connect();
    if (!connected) {
      console.error("🔸 Failed to connect");
      return;
    }

    console.log("✅ Connected\n");

    // Get guild ID from command line args or env
    const guildId = process.argv[2] || process.env.GUILD_ID;

    if (!guildId) {
      console.error("🔸 Usage: npm run generate:relationships <guild_id>");
      console.error("   Or set GUILD_ID in .env");
      return;
    }

    console.log(`🔹 Generating relationships and conversations for guild: ${guildId}\n`);

    // Check if we should clear existing edges/segments
    const clearExisting = process.argv[3] === "--clear";
    if (clearExisting) {
      console.log("🗑️  Clearing existing relationship edges and conversation segments...");
      await db.query(
        "DELETE FROM relationship_edges WHERE guild_id = $1",
        [guildId]
      );
      await db.query(
        "DELETE FROM conversation_segments WHERE guild_id = $1",
        [guildId]
      );
      await db.query(
        "DELETE FROM relationship_pairs WHERE guild_id = $1",
        [guildId]
      );
      console.log("✅ Cleared existing data\n");
    }

    // Get all non-bot messages for this guild, ordered chronologically
    console.log("📥 Fetching all messages from database...");
    const messagesResult = await db.query(
      `SELECT 
         m.id,
         m.guild_id,
         m.channel_id,
         m.author_id,
         m.content,
         m.created_at,
         m.referenced_message_id,
         mem.bot
       FROM messages m
       JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
       WHERE m.guild_id = $1 
         AND m.active = true
         AND mem.bot = false
       ORDER BY m.created_at ASC`,
      [guildId]
    );

    if (!messagesResult.success || !messagesResult.data) {
      console.error("🔸 Failed to fetch messages:", messagesResult.error);
      return;
    }

    const messages = messagesResult.data as ProcessedMessage[];
    console.log(`✅ Found ${messages.length} messages to process\n`);

    if (messages.length === 0) {
      console.log("📭 No messages to process");
      return;
    }

    // Track processed message IDs to check for replies
    const messageIds = new Set(messages.map((m) => m.id));
    const messagesById = new Map<string, ProcessedMessage>();
    for (const msg of messages) {
      messagesById.set(msg.id, msg);
    }

    // Track recent messages per channel for proximity detection
    const recentMessagesByChannel = new Map<string, ProcessedMessage[]>();

    // Process messages in batches
    const BATCH_SIZE = 1000;
    let processed = 0;
    let edgesCreated = 0;
    let interactionsRecorded = 0;
    let mentionsRecorded = 0;
    let repliesRecorded = 0;

    console.log("🔄 Processing messages...\n");

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const batchEnd = Math.min(i + BATCH_SIZE, messages.length);

      for (const message of batch) {
        const timestamp = new Date(message.created_at);
        const authorId = message.author_id;

        // Extract mentions from message content
        const mentionPattern = /<@!?(\d+)>/g;
        const mentions = new Set<string>();
        let match;
        // Reset regex lastIndex
        mentionPattern.lastIndex = 0;
        while ((match = mentionPattern.exec(message.content || "")) !== null) {
          const mentionedId = match[1];
          if (mentionedId === authorId) continue;
          // Verify this user exists in the guild and is not a bot
          const memberCheck = await db.query(
            "SELECT bot FROM members WHERE user_id = $1 AND guild_id = $2 AND active = true",
            [mentionedId, guildId]
          );
          if (
            memberCheck.success &&
            memberCheck.data &&
            memberCheck.data.length > 0 &&
            !memberCheck.data[0].bot
          ) {
            mentions.add(mentionedId);
          }
        }

        // Record mention interactions
        for (const mentionedId of mentions) {
          await relationshipManager.recordInteraction(
            guildId,
            authorId,
            mentionedId,
            "mention",
            "a_to_b",
            timestamp
          );
          interactionsRecorded++;
          mentionsRecorded++;
        }

        // Track actual replies using referenced_message_id
        if (message.referenced_message_id) {
          const referencedMessage = messagesById.get(message.referenced_message_id);
          if (referencedMessage && referencedMessage.author_id !== authorId) {
            // Verify the referenced message author is not a bot
            const memberCheck = await db.query(
              "SELECT bot FROM members WHERE user_id = $1 AND guild_id = $2 AND active = true",
              [referencedMessage.author_id, guildId]
            );
            if (
              memberCheck.success &&
              memberCheck.data &&
              memberCheck.data.length > 0 &&
              !memberCheck.data[0].bot
            ) {
              // Record reply interaction
              await relationshipManager.recordInteraction(
                guildId,
                authorId,
                referencedMessage.author_id,
                "reply",
                "a_to_b",
                timestamp
              );
              interactionsRecorded++;
              repliesRecorded++;
            }
          }
        }

        // Check for proximity-based interactions (messages within 5 minutes in same channel)
        const recentMessages = recentMessagesByChannel.get(message.channel_id) || [];
        const fiveMinutesAgo = timestamp.getTime() - 5 * 60 * 1000;

        for (const recentMsg of recentMessages) {
          const recentTime = new Date(recentMsg.created_at).getTime();
          if (recentTime > fiveMinutesAgo && recentMsg.author_id !== authorId) {
            // Record proximity interaction
            await relationshipManager.recordInteraction(
              guildId,
              authorId,
              recentMsg.author_id,
              "message",
              "a_to_b",
              timestamp
            );
            interactionsRecorded++;
            edgesCreated++;

            // Also record reverse interaction (reciprocal)
            await relationshipManager.recordInteraction(
              guildId,
              recentMsg.author_id,
              authorId,
              "message",
              "b_to_a",
              new Date(recentMsg.created_at)
            );
          }
        }

        // Update recent messages for this channel (keep last 10)
        if (!recentMessagesByChannel.has(message.channel_id)) {
          recentMessagesByChannel.set(message.channel_id, []);
        }
        const channelRecent = recentMessagesByChannel.get(message.channel_id)!;
        channelRecent.push(message);
        if (channelRecent.length > 10) {
          channelRecent.shift();
        }

        processed++;

        // Progress logging
        if (processed % 500 === 0) {
          console.log(
            `   📊 Processed ${processed}/${messages.length} messages (${((processed / messages.length) * 100).toFixed(1)}%)`
          );
        }
      }
    }

    console.log(`\n✅ Processed ${processed} messages`);
    console.log(`   📊 Recorded ${interactionsRecorded} interactions`);
    console.log(`      • Mentions: ${mentionsRecorded}`);
    console.log(`      • Replies: ${repliesRecorded}`);
    console.log(`      • Messages (proximity): ${interactionsRecorded - mentionsRecorded - repliesRecorded}\n`);

    // Now generate conversation segments
    console.log("💬 Generating conversation segments...");

    // Get all unique user pairs that have interactions
    const pairsResult = await db.query(
      `SELECT DISTINCT 
         LEAST(user_a, user_b) as u_min,
         GREATEST(user_a, user_b) as u_max
       FROM relationship_edges
       WHERE guild_id = $1
       ORDER BY u_min, u_max`,
      [guildId]
    );

    if (!pairsResult.success || !pairsResult.data) {
      console.error("🔸 Failed to get user pairs:", pairsResult.error);
      return;
    }

    const pairs = pairsResult.data as Array<{ u_min: string; u_max: string }>;
    console.log(`   Found ${pairs.length} user pairs\n`);

    let segmentsCreated = 0;
    const SEGMENT_BATCH = 50;

    // Process pairs in batches
    for (let i = 0; i < pairs.length; i += SEGMENT_BATCH) {
      const pairBatch = pairs.slice(i, i + SEGMENT_BATCH);

      for (const pair of pairBatch) {
        // Detect conversations for this pair
        const convResult = await conversationManager.detectConversations(
          pair.u_min,
          pair.u_max,
          guildId,
          5 // 5 minute time window
        );

        if (convResult.success && convResult.data) {
          // Save segments to database
          for (const conv of convResult.data) {
            await db.upsertConversationSegment({
              id: conv.conversation_id,
              guildId: guildId,
              channelId: conv.channel_id,
              participants: [pair.u_min, pair.u_max],
              startTime: conv.start_time,
              endTime: conv.end_time,
              messageIds: conv.message_ids,
              messageCount: conv.message_count,
              features: {
                duration_minutes: conv.duration_minutes,
                has_mentions: conv.interaction_types?.includes("mention") || false,
                has_name_usage: conv.has_name_usage || false,
              },
              summary: conv.summary,
            });

            segmentsCreated++;
          }
        }
      }

      if ((i + SEGMENT_BATCH) % 200 === 0 || i + SEGMENT_BATCH >= pairs.length) {
        console.log(
          `   📊 Processed ${Math.min(i + SEGMENT_BATCH, pairs.length)}/${pairs.length} pairs`
        );
      }
    }

    console.log(`\n✅ Created ${segmentsCreated} conversation segments\n`);

    // Update relationship pairs (direct SQL update for bulk operation)
    console.log("🔗 Updating relationship pairs...");
    const pairsUpdateResult = await db.query(
      `WITH edges_pairs AS (
         SELECT 
           re.guild_id,
           LEAST(re.user_a, re.user_b)::TEXT AS u_min,
           GREATEST(re.user_a, re.user_b)::TEXT AS u_max,
           MAX(re.last_interaction) AS last_interaction,
           SUM(re.total) AS total_interactions
         FROM relationship_edges re
         WHERE re.guild_id = $1
         GROUP BY re.guild_id, LEAST(re.user_a, re.user_b), GREATEST(re.user_a, re.user_b)
       )
       INSERT INTO relationship_pairs (
         guild_id, u_min, u_max, last_interaction, total_interactions, segment_ids
       )
       SELECT 
         p.guild_id,
         p.u_min,
         p.u_max,
         p.last_interaction,
         p.total_interactions,
         COALESCE(
           (
             SELECT ARRAY_AGG(DISTINCT cs.id::TEXT)
             FROM conversation_segments cs
             WHERE cs.guild_id = p.guild_id
               AND cs.participants @> ARRAY[p.u_min]::TEXT[]
               AND cs.participants @> ARRAY[p.u_max]::TEXT[]
           ),
           ARRAY[]::TEXT[]
         ) AS segment_ids
       FROM edges_pairs p
       ON CONFLICT (guild_id, u_min, u_max) DO UPDATE SET
         last_interaction = EXCLUDED.last_interaction,
         total_interactions = EXCLUDED.total_interactions,
         segment_ids = EXCLUDED.segment_ids,
         updated_at = NOW()`,
      [guildId]
    );

    if (pairsUpdateResult.success) {
      const countResult = await db.query(
        "SELECT COUNT(*) as count FROM relationship_pairs WHERE guild_id = $1",
        [guildId]
      );
      if (countResult.success && countResult.data) {
        console.log(`✅ Updated ${countResult.data[0].count} relationship pairs\n`);
      }
    }

    // Rollup edges to member networks
    console.log("📊 Rolling up edges to member networks...");

    // Get all unique users that exist in the members table
    const usersResult = await db.query(
      `SELECT DISTINCT re.user_a as user_id 
       FROM relationship_edges re
       INNER JOIN members m ON m.user_id = re.user_a AND m.guild_id = re.guild_id AND m.active = true
       WHERE re.guild_id = $1
       UNION
       SELECT DISTINCT re.user_b as user_id 
       FROM relationship_edges re
       INNER JOIN members m ON m.user_id = re.user_b AND m.guild_id = re.guild_id AND m.active = true
       WHERE re.guild_id = $1`,
      [guildId]
    );

    if (usersResult.success && usersResult.data) {
      const users = usersResult.data as Array<{ user_id: string }>;
      console.log(`   Found ${users.length} users with members records to rollup\n`);

      const ROLLUP_BATCH = 20;
      let rollupCount = 0;
      let rollupErrors = 0;

      for (let i = 0; i < users.length; i += ROLLUP_BATCH) {
        const userBatch = users.slice(i, i + ROLLUP_BATCH);

        await Promise.all(
          userBatch.map(async (user) => {
            const result = await relationshipManager.rollupEdgesToMemberNetwork(
              user.user_id,
              guildId
            );
            if (!result.success) {
              rollupErrors++;
            }
            rollupCount++;
          })
        );

        if (rollupCount % 100 === 0 || rollupCount === users.length) {
          console.log(`   📊 Rolled up ${rollupCount}/${users.length} users${rollupErrors > 0 ? ` (${rollupErrors} errors)` : ""}`);
        }
      }

      console.log(`\n✅ Rolled up ${rollupCount} member networks${rollupErrors > 0 ? ` (${rollupErrors} errors)` : ""}\n`);
    }

    // Final summary
    console.log("📊 Summary:");
    const edgeCountResult = await db.query(
      "SELECT COUNT(*) as count FROM relationship_edges WHERE guild_id = $1",
      [guildId]
    );
    const segmentCountResult = await db.query(
      "SELECT COUNT(*) as count FROM conversation_segments WHERE guild_id = $1",
      [guildId]
    );
    const pairCountResult = await db.query(
      "SELECT COUNT(*) as count FROM relationship_pairs WHERE guild_id = $1",
      [guildId]
    );

    if (edgeCountResult.success && edgeCountResult.data) {
      console.log(`   🔗 Relationship edges: ${edgeCountResult.data[0].count}`);
    }
    if (segmentCountResult.success && segmentCountResult.data) {
      console.log(`   💬 Conversation segments: ${segmentCountResult.data[0].count}`);
    }
    if (pairCountResult.success && pairCountResult.data) {
      console.log(`   👥 Relationship pairs: ${pairCountResult.data[0].count}`);
    }

    console.log("\n✅ Generation complete!");
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

generateRelationshipsFromHistory();

