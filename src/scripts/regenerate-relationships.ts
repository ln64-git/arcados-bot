import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { RelationshipNetworkManager } from "../features/relationship-network/NetworkManager.js";

// Known bot user IDs to exclude from relationship generation
const BOT_USER_IDS = [
  "356268235697553409", // .fmbot
  "1290873223944343714", // Arcados-bot
  "235148962103951360", // Carl-bot
  "949731498808979557", // Euphony
  "411916947773587456", // Jockie Music
  "439205512425504771", // NotSoBot
  "678344927997853742", // Sapphire
  "778719049143025664", // Spoticord Music
  "617037497574359050", // tip.cc
];

async function regenerateRelationships() {
  const db = new PostgreSQLManager();
  const relationshipManager = new RelationshipNetworkManager(db);

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
      console.error("🔸 Usage: npm run regenerate:relationships <guild_id>");
      console.error("   Or set GUILD_ID in .env");
      return;
    }

    console.log(`🔹 Regenerating relationships for guild: ${guildId}\n`);

    // Verify guild exists in database
    const guildCheck = await db.query("SELECT id FROM guilds WHERE id = $1", [
      guildId,
    ]);
    if (
      !guildCheck.success ||
      !guildCheck.data ||
      guildCheck.data.length === 0
    ) {
      console.error(
        `🔸 Guild ${guildId} not found in database. Please sync the guild first.`
      );
      return;
    }

    // Check if we should clear existing edges
    const clearExisting = process.argv[3] === "--clear";
    if (clearExisting) {
      console.log("🗑️  Clearing existing relationship edges and pairs...");
      await db.query("DELETE FROM relationship_edges WHERE guild_id = $1", [
        guildId,
      ]);
      await db.query("DELETE FROM relationship_pairs WHERE guild_id = $1", [
        guildId,
      ]);
      console.log("✅ Cleared existing relationships\n");
    }

    // Fetch all messages for the guild, excluding bot messages
    console.log("🔹 Fetching messages (excluding bot messages)...");
    const messagesResult = await db.query(
      `
			SELECT id, guild_id, channel_id, author_id, content, created_at, referenced_message_id
			FROM messages
			WHERE guild_id = $1 AND active = true AND author_id != ALL($2::TEXT[])
			ORDER BY created_at ASC
		`,
      [guildId, BOT_USER_IDS]
    );

    if (!messagesResult.success || !messagesResult.data) {
      console.error("🔸 Failed to fetch messages:", messagesResult.error);
      return;
    }

    const messages = messagesResult.data as Array<{
      id: string;
      guild_id: string;
      channel_id: string;
      author_id: string;
      content: string;
      created_at: Date;
      referenced_message_id?: string | null;
    }>;

    console.log(`🔹 Found ${messages.length} messages\n`);

    if (messages.length === 0) {
      console.log("🔸 No messages to process");
      return;
    }

    // Process messages in batches
    const batchSize = 1000;
    let processed = 0;

    console.log("🔹 Processing messages to build relationship edges...\n");

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);

      for (const message of batch) {
        // Ensure message is from the target guild (safety check)
        if (message.guild_id !== guildId) {
          continue; // Skip messages from other guilds
        }

        // Record interactions from this message
        if (message.referenced_message_id) {
          // Get the referenced message to find the interaction target
          // Only process if the referenced message is from the same guild
          const refResult = await db.query(
            "SELECT author_id, guild_id FROM messages WHERE id = $1",
            [message.referenced_message_id]
          );

          if (
            refResult.success &&
            refResult.data &&
            refResult.data.length > 0
          ) {
            const refMessage = refResult.data[0];
            const targetAuthorId = refMessage.author_id;
            const refGuildId = refMessage.guild_id;

            // Only record interaction if:
            // 1. Target author exists and is different from message author
            // 2. Referenced message is from the same guild (cross-guild replies don't create relationships)
            // 3. Both guilds exist in the guilds table
            if (
              targetAuthorId &&
              targetAuthorId !== message.author_id &&
              refGuildId === guildId
            ) {
              try {
                const result = await relationshipManager.recordInteraction(
                  guildId,
                  message.author_id,
                  targetAuthorId,
                  "reply",
                  "a_to_b",
                  message.created_at
                );
                if (!result.success) {
                  // Silently skip if guild doesn't exist or other constraint issues
                }
              } catch (error) {
                // Silently skip if guild doesn't exist or other constraint issues
              }
            }
          }
        }

        // Extract mentions from content
        // Only create relationships for mentions within the same guild
        // Exclude mentions of bots
        const mentionRegex = /<@!?(\d+)>/g;
        const botUserIdSet = new Set(BOT_USER_IDS);
        let match;
        while ((match = mentionRegex.exec(message.content)) !== null) {
          const mentionedUserId = match[1];
          if (mentionedUserId && mentionedUserId !== message.author_id && !botUserIdSet.has(mentionedUserId)) {
            try {
              const result = await relationshipManager.recordInteraction(
                guildId,
                message.author_id,
                mentionedUserId,
                "mention",
                "a_to_b",
                message.created_at
              );
              if (!result.success) {
                // Silently skip if guild doesn't exist or other constraint issues
              }
            } catch (error) {
              // Silently skip if guild doesn't exist or other constraint issues
              // Don't log every failure to avoid spam
            }
          }
        }

        processed++;

        if (processed % 1000 === 0 || processed === messages.length) {
          console.log(
            `   📊 Processed ${processed}/${messages.length} messages`
          );
        }
      }
    }

    console.log(`\n✅ Processed ${processed} messages\n`);

    // Rollup edges to member networks
    console.log("🔹 Rolling up edges to member networks...");
    const usersResult = await db.query(
      `
			SELECT DISTINCT user_id
			FROM (
				SELECT user_a as user_id FROM relationship_edges WHERE guild_id = $1
				UNION
				SELECT user_b as user_id FROM relationship_edges WHERE guild_id = $1
			) users
		`,
      [guildId]
    );

    if (usersResult.success && usersResult.data) {
      const users = usersResult.data as Array<{ user_id: string }>;
      let rollupCount = 0;
      let rollupErrors = 0;

      // Process in batches
      const userBatchSize = 50;
      for (let i = 0; i < users.length; i += userBatchSize) {
        const userBatch = users.slice(i, i + userBatchSize);

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
          console.log(
            `   📊 Rolled up ${rollupCount}/${users.length} users${
              rollupErrors > 0 ? ` (${rollupErrors} errors)` : ""
            }`
          );
        }
      }

      console.log(
        `\n✅ Rolled up ${rollupCount} member networks${
          rollupErrors > 0 ? ` (${rollupErrors} errors)` : ""
        }\n`
      );
    }

    // Final summary
    console.log("📊 Summary:");
    const edgeCountResult = await db.query(
      "SELECT COUNT(*) as count FROM relationship_edges WHERE guild_id = $1",
      [guildId]
    );
    const pairCountResult = await db.query(
      "SELECT COUNT(*) as count FROM relationship_pairs WHERE guild_id = $1",
      [guildId]
    );

    if (edgeCountResult.success && edgeCountResult.data) {
      console.log(`   🔗 Relationship edges: ${edgeCountResult.data[0].count}`);
    }
    if (pairCountResult.success && pairCountResult.data) {
      console.log(`   👥 Relationship pairs: ${pairCountResult.data[0].count}`);
    }

    console.log("\n✅ Regeneration complete!");
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

regenerateRelationships();
