import { SurrealDBManager } from "../database/SurrealDBManager";

async function checkVoiceHistory() {
	const dbManager = new SurrealDBManager();

	try {
		console.log("🔹 Checking voice history...");

		// Connect to database
		const connected = await dbManager.connect();
		if (!connected) {
			console.error("🔸 Failed to connect to database");
			return;
		}

		// Get recent voice history (last 50 events)
		const result = await dbManager.db.query(
			"SELECT * FROM voice_history ORDER BY timestamp DESC LIMIT 50",
		);
		const history =
			((result[0] as Record<string, unknown>)?.result as any[]) || [];

		console.log(`\n📊 Recent Voice History (${history.length} events):`);

		if (history.length === 0) {
			console.log("   No voice history found");
		} else {
			for (const event of history) {
				const timestamp = new Date(event.timestamp).toLocaleString();
				const eventType = event.event_type;
				const userId = event.user_id;

				let eventDesc = "";
				switch (eventType) {
					case "join":
						eventDesc = `joined ${event.to_channel_id}`;
						break;
					case "leave":
						eventDesc = `left ${event.from_channel_id}`;
						break;
					case "switch":
						eventDesc = `switched from ${event.from_channel_id} to ${event.to_channel_id}`;
						break;
					case "state_change":
						eventDesc = `changed state in ${event.channel_id}`;
						break;
				}

				const status = [];
				if (event.self_mute) status.push("🔇");
				if (event.self_deaf) status.push("🔇");
				if (event.server_mute) status.push("🔇");
				if (event.server_deaf) status.push("🔇");
				if (event.streaming) status.push("📺");
				if (event.self_video) status.push("📹");

				const statusStr = status.length > 0 ? ` ${status.join("")}` : " 🔊👂";

				console.log(`   ${timestamp} - ${userId} ${eventDesc}${statusStr}`);

				if (event.session_id) {
					console.log(`      Session: ${event.session_id}`);
				}
				if (event.session_duration) {
					console.log(`      Duration: ${event.session_duration}s`);
				}
			}
		}

		// Show summary by event type
		const summaryResult = await dbManager.db.query(`
			SELECT event_type, count() as count 
			FROM voice_history 
			GROUP BY event_type 
			ORDER BY count DESC
		`);
		const summary =
			((summaryResult[0] as Record<string, unknown>)?.result as any[]) || [];

		console.log(`\n📈 Event Summary:`);
		for (const item of summary) {
			console.log(`   ${item.event_type}: ${item.count} events`);
		}
	} catch (error) {
		console.error("🔸 Error checking voice history:", error);
	} finally {
		await dbManager.disconnect();
	}
}

checkVoiceHistory()
	.then(() => {
		console.log("\n🔹 Check complete");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Script failed:", error);
		process.exit(1);
	});
