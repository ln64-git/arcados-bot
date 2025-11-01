import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager";

async function consolidateSegments() {
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
      console.error("🔸 Usage: npm run consolidate:segments <guild_id>");
      console.error("   Or set GUILD_ID in .env");
      return;
    }

    console.log("🔹 Consolidating overlapping segments...\n");

    // Find segments in the same channel that overlap in time with shared participants
    const segmentsResult = await db.query(
      `SELECT id, channel_id, participants, start_time, end_time, message_ids, message_count
       FROM conversation_segments
       WHERE guild_id = $1
       ORDER BY channel_id, start_time ASC`,
      [guildId]
    );

    if (!segmentsResult.success || !segmentsResult.data) {
      console.error("🔸 Failed to fetch segments:", segmentsResult.error);
      return;
    }

    const segments = segmentsResult.data;
    console.log(`   Found ${segments.length} total segments\n`);

    const processed = new Set<string>();
    const toDelete = new Set<string>();
    let consolidated = 0;

    for (let i = 0; i < segments.length; i++) {
      const seg1 = segments[i];
      if (processed.has(seg1.id) || toDelete.has(seg1.id)) continue;

      const seg1Participants = Array.isArray(seg1.participants)
        ? new Set(seg1.participants)
        : new Set();

      // Look for nearby segments to merge (within 30 minutes)
      const seg1Start = new Date(seg1.start_time).getTime();
      const seg1End = new Date(seg1.end_time).getTime();
      const mergeWindow = 30 * 60 * 1000; // 30 minutes

      const toMerge: any[] = [seg1];

      for (let j = i + 1; j < segments.length; j++) {
        const seg2 = segments[j];
        if (seg1.channel_id !== seg2.channel_id) break; // Different channel

        if (processed.has(seg2.id) || toDelete.has(seg2.id)) continue;

        const seg2Start = new Date(seg2.start_time).getTime();
        const seg2End = new Date(seg2.end_time).getTime();

        // Check if segments are within merge window
        const timeGap = Math.min(
          Math.abs(seg2Start - seg1End),
          Math.abs(seg2End - seg1Start)
        );

        if (timeGap > mergeWindow) continue;

        // Check for participant overlap
        const seg2Participants = Array.isArray(seg2.participants)
          ? new Set(seg2.participants)
          : new Set();

        const hasOverlap = Array.from(seg1Participants).some((p) =>
          seg2Participants.has(p)
        );

        if (hasOverlap) {
          toMerge.push(seg2);
        }
      }

      // Merge if we found segments to combine
      if (toMerge.length > 1) {
        const allParticipants = new Set<string>();
        const allMessageIds = new Set<string>();
        let earliestStart = Infinity;
        let latestEnd = -Infinity;

        for (const seg of toMerge) {
          const participants = Array.isArray(seg.participants)
            ? seg.participants
            : [];
          participants.forEach((p: string) => allParticipants.add(p));

          const msgIds = Array.isArray(seg.message_ids) ? seg.message_ids : [];
          msgIds.forEach((id: string) => allMessageIds.add(id));

          const start = new Date(seg.start_time).getTime();
          const end = new Date(seg.end_time).getTime();
          earliestStart = Math.min(earliestStart, start);
          latestEnd = Math.max(latestEnd, end);
        }

        const mergedParticipants = Array.from(allParticipants).sort();
        const mergedMessageIds = Array.from(allMessageIds);

        // Use the first segment's ID as the merged segment ID
        const keepId = toMerge[0].id;

        // Update the kept segment
        await db.query(
          `UPDATE conversation_segments
           SET participants = $1::TEXT[],
               message_ids = $2::TEXT[],
               message_count = $3,
               start_time = $4,
               end_time = $5
           WHERE id = $6`,
          [
            mergedParticipants,
            mergedMessageIds,
            mergedMessageIds.length,
            new Date(earliestStart),
            new Date(latestEnd),
            keepId,
          ]
        );

        // Mark others for deletion
        for (let k = 1; k < toMerge.length; k++) {
          toDelete.add(toMerge[k].id);
          processed.add(toMerge[k].id);
        }

        consolidated += toMerge.length - 1;
        processed.add(keepId);
        console.log(
          `   🔗 Merged ${toMerge.length} segments in channel ${seg1.channel_id}`
        );
      } else {
        processed.add(seg1.id);
      }
    }

    // Delete merged segments
    if (toDelete.size > 0) {
      const deleteIds = Array.from(toDelete);
      const deleteResult = await db.query(
        `DELETE FROM conversation_segments WHERE id = ANY($1::TEXT[])`,
        [deleteIds]
      );

      if (deleteResult.success) {
        const deleted = (deleteResult.data as any)?.rowCount || 0;
        console.log(`\n✅ Consolidated ${consolidated} segments (deleted ${deleted})`);
      }
    } else {
      console.log("\n✅ No segments to consolidate");
    }
  } catch (error) {
    console.error("🔸 Error:", error);
  } finally {
    await db.disconnect();
  }
}

consolidateSegments();

