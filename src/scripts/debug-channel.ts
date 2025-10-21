import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function debugChannel() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		console.log("🔹 Checking channel 1430035574772994090...");

		// Check if channel exists and its properties
		const channelResult = await db.query(
			"SELECT * FROM channels WHERE id = $channel_id",
			{ channel_id: "1430035574772994090" },
		);

		console.log("Channel data:", JSON.stringify(channelResult, null, 2));

		// Check active voice sessions for this channel
		const sessionsResult = await db.getActiveVoiceSessionsByChannel(
			"1430035574772994090",
		);
		console.log(
			"Active sessions result:",
			JSON.stringify(sessionsResult, null, 2),
		);

		// Check all voice sessions for this channel (including inactive)
		const allSessionsResult = await db.query(
			"SELECT * FROM voice_sessions WHERE channel_id = $channel_id",
			{ channel_id: "1430035574772994090" },
		);

		console.log("All sessions:", JSON.stringify(allSessionsResult, null, 2));
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

debugChannel();
