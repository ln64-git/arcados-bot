import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function checkVoiceStates() {
	const dbManager = new SurrealDBManager();

	try {
		console.log("🔹 Checking current voice states...");

		// Connect to database
		const connected = await dbManager.connect();
		if (!connected) {
			console.error("🔸 Failed to connect to database");
			return;
		}

		// Get all voice states
		const result = await dbManager.db.query("SELECT * FROM voice_states");
		const voiceStates = (result[0] as any[]) || [];

		console.log(`\n📊 Current Voice States (${voiceStates.length}):`);

		if (voiceStates.length === 0) {
			console.log("   No users currently in voice channels");
		} else {
			// Group by guild
			const guilds = new Map<string, any[]>();
			for (const state of voiceStates) {
				if (!guilds.has(state.guild_id)) {
					guilds.set(state.guild_id, []);
				}
				guilds.get(state.guild_id)!.push(state);
			}

			for (const [guildId, states] of guilds) {
				console.log(`\n🏰 Guild: Arcados (${guildId})`);

				// Group by channel
				const channels = new Map<string, any[]>();
				for (const state of states) {
					const channelId = state.channel_id || "not-in-voice";
					if (!channels.has(channelId)) {
						channels.set(channelId, []);
					}
					channels.get(channelId)!.push(state);
				}

				for (const [channelId, channelStates] of channels) {
					let channelName = channelId;
					// Map known channel IDs to names based on the logs
					if (channelId === "1427152903260344350") {
						channelName = "🌿 - Cantina";
					}

					if (channelId === "not-in-voice") {
						console.log(`   📢 Not in voice (${channelStates.length} users):`);
					} else {
						console.log(
							`   📢 Channel: ${channelName} (${channelStates.length} users):`,
						);
					}

					for (const state of channelStates) {
						// Map known user IDs to names based on the logs
						let userName = state.user_id;
						const userMap: Record<string, string> = {
							"1135808419849310308": "marvinsdc",
							"133833763422601218": "omcswain",
							"1384677464961192007": "binary_crash",
							"221379384890753024": "pachycephalosaurus.",
							"303261092858298368": "slio333marmare",
							"354543127450615808": "itswinkithink",
							"354823920010002432": "ln64.exe",
							"443764130197798923": "nikkoontario",
							"773561252907581481": "buffforagirl",
							"804569322970284032": "shinji_ikari5049",
							"957858331744161823": "kelsszz",
						};

						if (userMap[state.user_id]) {
							userName = userMap[state.user_id];
						}

						const status = [];
						if (state.self_mute) status.push("🔇 Muted");
						if (state.self_deaf) status.push("🔇 Deafened");
						if (state.server_mute) status.push("🔇 Server Muted");
						if (state.server_deaf) status.push("🔇 Server Deafened");
						if (state.streaming) status.push("📺 Streaming");
						if (state.self_video) status.push("📹 Video");

						const statusStr =
							status.length > 0 ? ` (${status.join(", ")})` : " 🔊👂";
						console.log(`      ${userName}${statusStr}`);

						if (state.session_id) {
							console.log(`         Session: ${state.session_id}`);
						}
						if (state.joined_at) {
							console.log(
								`         Joined: ${new Date(state.joined_at).toLocaleString()}`,
							);
						}
					}
				}
			}
		}
	} catch (error) {
		console.error("🔸 Error checking voice states:", error);
	} finally {
		await dbManager.disconnect();
	}
}

checkVoiceStates()
	.then(() => {
		console.log("\n🔹 Check complete");
		process.exit(0);
	})
	.catch((error) => {
		console.error("🔸 Script failed:", error);
		process.exit(1);
	});
