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
					} else if (channelId === "1428282734173880440") {
						channelName = "➕ New Channel";
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
							"1070403737547456532": "user_1070403737547456532",
							"1103796698960109718": "user_1103796698960109718",
							"1118381544411762789": "user_1118381544411762789",
							"1135808419849310308": "marvinsdc",
							"1230794756423028739": "user_1230794756423028739",
							"1260890317453000778": "user_1260890317453000778",
							"1301566367392075876": "user_1301566367392075876",
							"133833763422601218": "omcswain",
							"1384677464961192007": "binary_crash",
							"1425975573364080731": "wink16218",
							"176430138001457162": "user_176430138001457162",
							"221379384890753024": "pachycephalosaurus.",
							"303261092858298368": "slio333marmare",
							"324175599356739584": "user_324175599356739584",
							"354543127450615808": "itswinkithink",
							"354823920010002432": "ln64.exe",
							"399700403618316298": "user_399700403618316298",
							"411916947773587456": "user_411916947773587456",
							"443764130197798923": "nikkoontario",
							"727327856786538606": "user_727327856786538606",
							"762112646681722890": "user_762112646681722890",
							"773561252907581481": "buffforagirl",
							"778719049143025664": "user_778719049143025664",
							"785381394775539732": "user_785381394775539732",
							"794441487177089025": "user_794441487177089025",
							"804569322970284032": "shinji_ikari5049",
							"883034611393896478": "user_883034611393896478",
							"886340655671046176": "user_886340655671046176",
							"889682674594218045": "user_889682674594218045",
							"957858331744161823": "kelsszz",
							"99195129516007424": "user_99195129516007424",
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
