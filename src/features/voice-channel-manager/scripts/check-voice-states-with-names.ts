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

		// Get all voice channels from database
		const channelsResult = await dbManager.db.query(
			"SELECT * FROM channels WHERE guildId = $guild_id AND type = 2",
			{ guild_id: "1254694808228986912" },
		);
		const channels = (channelsResult[0] as any[]) || [];

		// Get all voice states
		const voiceStatesResult = await dbManager.db.query(
			"SELECT * FROM voice_states WHERE guild_id = $guild_id",
			{ guild_id: "1254694808228986912" },
		);
		const voiceStates = (voiceStatesResult[0] as any[]) || [];

		console.log(
			`\n📊 Voice Channels & States (${channels.length} channels, ${voiceStates.length} users):`,
		);

		if (channels.length === 0) {
			console.log("   No voice channels found in database");
		} else {
			console.log(`\n🏰 Guild: Arcados (1254694808228986912)`);

			// Group voice states by channel
			const statesByChannel = new Map<string, any[]>();
			const notInVoiceStates: any[] = [];

			for (const state of voiceStates) {
				if (state.channel_id) {
					if (!statesByChannel.has(state.channel_id)) {
						statesByChannel.set(state.channel_id, []);
					}
					statesByChannel.get(state.channel_id)!.push(state);
				} else {
					notInVoiceStates.push(state);
				}
			}

			// Show all channels (including empty ones)
			for (const channel of channels) {
				const channelStates = statesByChannel.get(channel.discordId) || [];

				if (channelStates.length === 0) {
					console.log(
						`   📢 Channel: ${channel.channelName} (0 users) - EMPTY`,
					);
				} else {
					console.log(
						`   📢 Channel: ${channel.channelName} (${channelStates.length} users):`,
					);

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

			// Show users not in voice
			if (notInVoiceStates.length > 0) {
				console.log(`   📢 Not in voice (${notInVoiceStates.length} users):`);

				for (const state of notInVoiceStates) {
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
							`         Joined: ${new Date(state.joined_at).toLocaleString()}`,
						);
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
