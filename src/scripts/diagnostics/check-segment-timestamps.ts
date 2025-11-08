import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

async function checkSegmentTimestamps() {
	const db = new PostgreSQLManager();

	try {
		await db.connect();

		const segmentId = process.argv[2];
		if (!segmentId) {
			console.error("Usage: npx tsx src/scripts/check-segment-timestamps.ts <segment_id_prefix>");
			return;
		}

		const seg = await db.query(
			"SELECT id, message_ids, start_time, end_time FROM conversation_segments WHERE id LIKE $1",
			[`${segmentId}%`]
		);

		if (!seg.data || seg.data.length === 0) {
			console.log("No segment found");
			return;
		}

		const segment = seg.data[0];
		const msgIds = segment.message_ids;

		console.log(`\nSegment: ${segment.id}`);
		console.log(`Segment start_time: ${new Date(segment.start_time).toLocaleString()}`);
		console.log(`Segment end_time: ${new Date(segment.end_time).toLocaleString()}`);
		console.log(`Duration: ${((new Date(segment.end_time).getTime() - new Date(segment.start_time).getTime()) / (1000 * 60 * 60)).toFixed(1)} hours`);

		const msgs = await db.query(
			"SELECT id, created_at FROM messages WHERE id = ANY($1::TEXT[]) ORDER BY created_at ASC",
			[msgIds]
		);

		if (msgs.data && msgs.data.length > 0) {
			console.log(`\nActual ${msgs.data.length} messages:`);
			msgs.data.forEach((m, i) => {
				console.log(`  ${i + 1}. ${m.id} | ${new Date(m.created_at).toLocaleString()}`);
			});

			const firstMsg = msgs.data[0];
			const lastMsg = msgs.data[msgs.data.length - 1];
			const actualDuration = (new Date(lastMsg.created_at).getTime() - new Date(firstMsg.created_at).getTime()) / (1000 * 60 * 60);

			console.log(`\nActual message span: ${actualDuration.toFixed(1)} hours`);
			console.log(`First message: ${new Date(firstMsg.created_at).toLocaleString()}`);
			console.log(`Last message: ${new Date(lastMsg.created_at).toLocaleString()}`);

			if (Math.abs(actualDuration - ((new Date(segment.end_time).getTime() - new Date(segment.start_time).getTime()) / (1000 * 60 * 60))) > 1) {
				console.log("\n⚠️  WARNING: Segment timestamps don't match message timestamps!");
			}
		}

		await db.disconnect();
	} catch (error) {
		console.error("Error:", error);
	}
}

checkSegmentTimestamps();
