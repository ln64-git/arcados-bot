import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function checkVoiceStatesWithNames() {
	const dbManager = new SurrealDBManager();
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildVoiceStates,
		],
	});

	try {
		console.log("🔹 Checking current voice states with Discord names...");

		// Connect to Discord
		await client.login(process.env.DISCORD_BOT_TOKEN);

		// Connect to database
		const connected = await dbManager.connect();
		if (!connected) {
			console.error("🔸 Failed to connect to database");
			return;
		}

		// Get all voice states
		const result = await dbManager.db.query(
			"SELECT * FROM voice_states WHERE guild_id = $guild_id",
			{ guild_id: "1254694808228986912" },
		);
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
					// Map known channel IDs to names
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
						// Fetch user info from Discord
						let userName = state.user_id;
						try {
							const user = await client.users.fetch(state.user_id);
							userName = user.displayName || user.username;
						} catch (error) {
							// If fetch fails, keep the user ID
							userName = `user_${state.user_id}`;
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
								`         Joined: ${new Date(
									state.joined_at,
								).toLocaleString()}`,
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
		await client.destroy();
		console.log("\n🔹 Check complete");
	}
}

checkVoiceStatesWithNames().catch(console.error);
