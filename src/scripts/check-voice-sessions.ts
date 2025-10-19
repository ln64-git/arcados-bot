import { SurrealDBManager } from "../database/SurrealDBManager";

async function checkVoiceSessions() {
	const dbManager = new SurrealDBManager();

	try {
		console.log("🔹 Checking voice sessions...");

		// Connect to database
		const connected = await dbManager.connect();
		if (!connected) {
			console.error("🔸 Failed to connect to database");
			return;
		}

		// Get recent sessions (last 20)
		const result = await dbManager.db.query(
			"SELECT * FROM voice_sessions ORDER BY joined_at DESC LIMIT 20",
		);
		const sessions =
			((result[0] as Record<string, unknown>)?.result as any[]) || [];

		console.log(`\n📊 Recent Voice Sessions (${sessions.length}):`);

		if (sessions.length === 0) {
			console.log("   No voice sessions found");
		} else {
			for (const session of sessions) {
				const joinedAt = new Date(session.joined_at).toLocaleString();
				const leftAt = session.left_at
					? new Date(session.left_at).toLocaleString()
					: "Active";
				const duration = Math.floor(session.duration / 60); // Convert to minutes
				const active = session.active ? "🟢" : "🔴";

				console.log(`\n   ${active} Session: ${session.id}`);
				console.log(`      User: ${session.user_id}`);
				console.log(`      Guild: ${session.guild_id}`);
				console.log(`      Channel: ${session.channel_id}`);
				console.log(`      Joined: ${joinedAt}`);
				console.log(`      Left: ${leftAt}`);
				console.log(`      Duration: ${duration} minutes`);

				if (session.channels_visited && session.channels_visited.length > 0) {
					console.log(
						`      Channels visited: ${session.channels_visited.join(", ")}`,
					);
				}

				if (session.switch_count > 0) {
					console.log(`      Channel switches: ${session.switch_count}`);
				}

				// Show time spent in different states
				const timeMuted = Math.floor(session.time_muted / 60);
				const timeDeafened = Math.floor(session.time_deafened / 60);
				const timeStreaming = Math.floor(session.time_streaming / 60);

				if (timeMuted > 0 || timeDeafened > 0 || timeStreaming > 0) {
					console.log(`      State time:`);
					if (timeMuted > 0)
						console.log(`         Muted: ${timeMuted} minutes`);
					if (timeDeafened > 0)
						console.log(`         Deafened: ${timeDeafened} minutes`);
					if (timeStreaming > 0)
						console.log(`         Streaming: ${timeStreaming} minutes`);
				}
			}
		}

		// Show active sessions
		const activeResult = await dbManager.db.query(
			"SELECT * FROM voice_sessions WHERE active = true",
		);
		const activeSessions =
			((activeResult[0] as Record<string, unknown>)?.result as any[]) || [];

		console.log(`\n🟢 Active Sessions (${activeSessions.length}):`);
		for (const session of activeSessions) {
			const joinedAt = new Date(session.joined_at).toLocaleString();
			const duration = Math.floor(
				(Date.now() - new Date(session.joined_at).getTime()) / 60000,
			);

			console.log(
				`   ${session.user_id} in ${session.channel_id} (${duration} minutes)`,
			);
		}

		// Show session statistics
		const statsResult = await dbManager.db.query(`
			SELECT 
				count() as total_sessions,
				sum(duration) as total_duration,
				math::mean(duration) as avg_duration,
				math::max(duration) as max_duration
			FROM voice_sessions 
			WHERE active = false
		`);
		const stats =
			((statsResult[0] as Record<string, unknown>)?.result as any[]) || [];

		if (stats.length > 0) {
			const stat = stats[0];
			console.log(`\n📈 Session Statistics:`);
			console.log(`   Total sessions: ${stat.total_sessions}`);
			console.log(
				`   Total duration: ${Math.floor(stat.total_duration / 3600)} hours`,
			);
			console.log(
				`   Average duration: ${Math.floor(stat.avg_duration / 60)} minutes`,
			);
			console.log(
				`   Longest session: ${Math.floor(stat.max_duration / 60)} minutes`,
			);
		}
	} catch (error) {
		console.error("🔸 Error checking voice sessions:", error);
	} finally {
		await dbManager.disconnect();
	}
}

checkVoiceSessions()
	.then(() => {
		console.log("\n🔹 Check complete");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Script failed:", error);
		process.exit(1);
	});
