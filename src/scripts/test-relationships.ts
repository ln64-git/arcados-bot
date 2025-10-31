import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";
import { RelationshipNetworkManager } from "../features/relationship-network/NetworkManager";

interface UserNameMap {
  [userId: string]: {
    display_name: string;
    username: string;
  };
}

async function getUserNames(
  db: PostgreSQLManager,
  userIds: string[],
  guildId: string
): Promise<UserNameMap> {
  if (userIds.length === 0) return {};

  const result = await db.query(
    `SELECT user_id, display_name, username 
     FROM members 
     WHERE user_id = ANY($1::text[]) AND guild_id = $2 AND active = true`,
    [userIds, guildId]
  );

  const nameMap: UserNameMap = {};
  if (result.success && result.data) {
    for (const member of result.data as any[]) {
      nameMap[member.user_id] = {
        display_name: member.display_name || member.username || member.user_id,
        username: member.username || member.user_id,
      };
    }
  }

  // Fallback for missing users
  for (const userId of userIds) {
    if (!nameMap[userId]) {
      nameMap[userId] = {
        display_name: userId,
        username: userId,
      };
    }
  }

  return nameMap;
}

function formatUserName(nameMap: UserNameMap, userId: string): string {
  const user = nameMap[userId];
  if (!user) return userId;
  return user.display_name !== user.user_id ? user.display_name : user.username;
}

async function testRelationships() {
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
    const userId = process.argv[3];

    if (!guildId) {
      console.error("🔸 Usage: npm run test:relationships <guild_id> [user_id]");
      console.error("   Or set GUILD_ID in .env");
      return;
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Testing Relationships for Guild: ${guildId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Summary stats
    console.log("📊 Summary Statistics");
    console.log("──────────────────────────────────────────────────────────");

    const edgeCount = await db.query(
      "SELECT COUNT(*) as count FROM relationship_edges WHERE guild_id = $1",
      [guildId]
    );
    if (edgeCount.success && edgeCount.data) {
      console.log(`   🔗 Relationship edges: ${edgeCount.data[0].count.toLocaleString()}`);
    }

    const segmentCount = await db.query(
      "SELECT COUNT(*) as count FROM conversation_segments WHERE guild_id = $1",
      [guildId]
    );
    if (segmentCount.success && segmentCount.data) {
      console.log(`   💬 Conversation segments: ${segmentCount.data[0].count.toLocaleString()}`);
    }

    const pairCount = await db.query(
      "SELECT COUNT(*) as count FROM relationship_pairs WHERE guild_id = $1",
      [guildId]
    );
    if (pairCount.success && pairCount.data) {
      console.log(`   👥 Relationship pairs: ${pairCount.data[0].count.toLocaleString()}\n`);
    }

    // Top relationships by interaction count
    console.log("🏆 Top 10 Relationships (by total interactions)");
    console.log("──────────────────────────────────────────────────────────");
    const topEdges = await db.query(
      `SELECT 
         user_a, user_b, 
         msg_a_to_b, msg_b_to_a, mentions, replies, reactions,
         total, last_interaction
       FROM relationship_edges
       WHERE guild_id = $1
       ORDER BY total DESC
       LIMIT 10`,
      [guildId]
    );

    if (topEdges.success && topEdges.data) {
      // Get all unique user IDs
      const userIds = new Set<string>();
      for (const edge of topEdges.data as any[]) {
        userIds.add(edge.user_a);
        userIds.add(edge.user_b);
      }

      const nameMap = await getUserNames(db, Array.from(userIds), guildId);

      for (let i = 0; i < topEdges.data.length; i++) {
        const edge = topEdges.data[i] as any;
        const date = new Date(edge.last_interaction).toLocaleDateString();
        const userA = formatUserName(nameMap, edge.user_a);
        const userB = formatUserName(nameMap, edge.user_b);

        console.log(
          `\n   ${(i + 1).toString().padStart(2, " ")}. ${userA} ↔ ${userB}`
        );
        console.log(`       Total: ${edge.total.toLocaleString()} interactions`);
        console.log(
          `       Messages: ${edge.msg_a_to_b} → ${edge.msg_b_to_a} | Mentions: ${edge.mentions} | Replies: ${edge.replies} | Reactions: ${edge.reactions}`
        );
        console.log(`       Last interaction: ${date}`);
      }
    }

    // Top conversation segments
    console.log("\n💬 Top 10 Conversation Segments (by message count)");
    console.log("──────────────────────────────────────────────────────────");
    const topSegments = await db.query(
      `SELECT 
         cs.id, cs.channel_id, cs.participants, cs.message_count,
         cs.start_time, cs.end_time, c.name as channel_name
       FROM conversation_segments cs
       LEFT JOIN channels c ON cs.channel_id = c.id
       WHERE cs.guild_id = $1
       ORDER BY cs.message_count DESC
       LIMIT 10`,
      [guildId]
    );

    if (topSegments.success && topSegments.data) {
      // Get all unique user IDs
      const userIds = new Set<string>();
      for (const seg of topSegments.data as any[]) {
        for (const pid of seg.participants || []) {
          userIds.add(pid);
        }
      }

      const nameMap = await getUserNames(db, Array.from(userIds), guildId);

      // Get channel names
      const channelIds = new Set(
        (topSegments.data as any[]).map((s) => s.channel_id)
      );
      const channelsResult = await db.query(
        `SELECT id, name FROM channels WHERE id = ANY($1::text[]) AND guild_id = $2`,
        [Array.from(channelIds), guildId]
      );
      const channelMap = new Map<string, string>();
      if (channelsResult.success && channelsResult.data) {
        for (const ch of channelsResult.data as any[]) {
          channelMap.set(ch.id, ch.name || ch.id);
        }
      }

      for (let i = 0; i < topSegments.data.length; i++) {
        const seg = topSegments.data[i] as any;
        const start = new Date(seg.start_time).toLocaleString();
        const duration =
          (new Date(seg.end_time).getTime() -
            new Date(seg.start_time).getTime()) /
          (1000 * 60);
        const participants = (seg.participants || []).map((pid: string) =>
          formatUserName(nameMap, pid)
        );
        const channelName = channelMap.get(seg.channel_id) || seg.channel_id;

        console.log(
          `\n   ${(i + 1).toString().padStart(2, " ")}. ${participants.join(" & ")}`
        );
        console.log(`       ${seg.message_count} messages • ${duration.toFixed(1)} minutes`);
        console.log(`       Channel: #${channelName} • ${start}`);
      }
    }

    // If user ID provided, show their relationship network
    if (userId) {
      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`👤 Relationship Network`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      const networkResult = await db.getMemberRelationshipNetwork(userId, guildId);
      if (networkResult.success && networkResult.data) {
        const network = networkResult.data;
        const userNameMap = await getUserNames(db, [userId], guildId);
        const userDisplayName = formatUserName(userNameMap, userId);

        console.log(`User: ${userDisplayName}`);
        console.log(`Found ${network.length} relationships\n`);

        // Get names for all related users
        const relatedUserIds = network.map((r) => r.user_id);
        const relatedNameMap = await getUserNames(db, relatedUserIds, guildId);

        console.log("Top Relationships");
        console.log("──────────────────────────────────────────────────────────");

        for (let i = 0; i < Math.min(network.length, 20); i++) {
          const rel = network[i];
          const date = new Date(rel.last_interaction).toLocaleDateString();
          const relatedName = formatUserName(relatedNameMap, rel.user_id);

          console.log(
            `\n   ${(i + 1).toString().padStart(2, " ")}. ${relatedName}`
          );
          console.log(
            `       Affinity: ${rel.affinity_percentage.toFixed(1)}% • ${rel.interaction_count.toLocaleString()} interactions`
          );
          if (rel.total_messages) {
            console.log(`       Messages: ${rel.total_messages.toLocaleString()}`);
          }
          console.log(`       Last interaction: ${date}`);
        }

        // Get dyad summary for top relationship
        if (network.length > 0) {
          const topRel = network[0];
          const topRelName = formatUserName(relatedNameMap, topRel.user_id);

          console.log(`\n🔍 Dyad Analysis: ${userDisplayName} ↔ ${topRelName}`);
          console.log("──────────────────────────────────────────────────────────");

          const dyadResult = await relationshipManager.getDyadSummary(
            userId,
            topRel.user_id,
            guildId
          );

          if (dyadResult.success && dyadResult.data) {
            if (dyadResult.data.a_to_b) {
              console.log(
                `\n   ${userDisplayName} → ${topRelName}: ${dyadResult.data.a_to_b.interaction_count.toLocaleString()} interactions`
              );
            }
            if (dyadResult.data.b_to_a) {
              console.log(
                `   ${topRelName} → ${userDisplayName}: ${dyadResult.data.b_to_a.interaction_count.toLocaleString()} interactions`
              );
            }

            // Get conversation segments for this pair
            const segmentsResult = await db.getSegmentsForParticipants(
              guildId,
              [userId, topRel.user_id],
              5
            );

            if (
              segmentsResult.success &&
              segmentsResult.data &&
              segmentsResult.data.length > 0
            ) {
              // Get channel names
              const segChannelIds = new Set(
                (segmentsResult.data as any[]).map((s) => s.channel_id)
              );
              const segChannelsResult = await db.query(
                `SELECT id, name FROM channels WHERE id = ANY($1::text[]) AND guild_id = $2`,
                [Array.from(segChannelIds), guildId]
              );
              const segChannelMap = new Map<string, string>();
              if (segChannelsResult.success && segChannelsResult.data) {
                for (const ch of segChannelsResult.data as any[]) {
                  segChannelMap.set(ch.id, ch.name || ch.id);
                }
              }

              console.log(`\n   Recent Conversations:`);
              for (const seg of segmentsResult.data as any[]) {
                const date = new Date(seg.start_time).toLocaleDateString();
                const duration =
                  (new Date(seg.end_time).getTime() -
                    new Date(seg.start_time).getTime()) /
                  (1000 * 60);
                const channelName =
                  segChannelMap.get(seg.channel_id) || seg.channel_id;
                console.log(
                  `\n   • ${seg.message_count} messages • ${duration.toFixed(1)} min • #${channelName} • ${date}`
                );
                if (seg.summary) {
                  console.log(`     "${seg.summary}"`);
                }
              }
            }
          }
        }
      } else {
        const userNameMap = await getUserNames(db, [userId], guildId);
        const userDisplayName = formatUserName(userNameMap, userId);
        console.log(
          `   🔸 No relationship network found for ${userDisplayName}\n     (User may not exist or have no relationships)`
        );
      }
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ Test complete");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

testRelationships();

