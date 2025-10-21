import { Client, GatewayIntentBits } from "discord.js";
import { config } from "../config/index.js";
import { SurrealDBManager } from "../database/SurrealDBManager.js";
import { DatabaseActions } from "../features/discord-sync/actions.js";
import { VoiceChannelManager } from "../features/voice-channel-manager/VoiceChannelManager.js";

async function startMinimalBot() {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.GuildMembers,
		],
	});

	const db = new SurrealDBManager();
	const botStartTime = new Date();

	try {
		console.log("🔹 Starting minimal bot for testing...");
		console.log(`🔹 Bot start time: ${botStartTime.toISOString()}`);

		// Connect to Discord
		await client.login(config.botToken);
		console.log("🔹 Connected to Discord");

		// Connect to database
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Initialize actions manager
		const actions = new DatabaseActions(client, db);

		// Initialize voice channel manager
		if (config.spawnChannelId) {
			const voiceChannelManager = new VoiceChannelManager(
				client,
				db,
				config.spawnChannelId,
			);
			await voiceChannelManager.initialize();
			console.log("🔹 Voice Channel Manager ready!");

			// Set up live query for instant action processing
			await db.subscribeToActions((action, data) => {
				console.log(`🔹 Action ${action}:`, data);

				if (action === "CREATE") {
					// Only process actions created after bot started
					const actionData = data as any;
					const actionCreatedAt = new Date(actionData.created_at);

					if (actionCreatedAt >= botStartTime) {
						console.log(
							"🔹 New action created, triggering immediate processing...",
						);
						actions.triggerActionProcessing().catch((error) => {
							console.error("🔸 Failed to trigger action processing:", error);
						});
					} else {
						console.log(
							`🔹 Ignoring old action created at ${actionCreatedAt.toISOString()} (before bot start)`,
						);
					}
				}
			});

			// Set up voice state change handlers
			client.on("voiceStateUpdate", async (oldState, newState) => {
				const guild = newState.guild;
				const user = newState.member?.user;

				if (!user) return;

				console.log(`🔹 Voice state update: ${user.username} (${user.id})`);

				// User joined a voice channel
				if (!oldState.channelId && newState.channelId) {
					console.log(
						`🔹 ${user.username} joined voice channel ${newState.channelId}`,
					);

					// Check if it's the spawn channel
					if (newState.channelId === config.spawnChannelId) {
						console.log(`🔹 ${user.username} joined spawn channel!`);

						// Use the voice channel manager to handle spawn join
						try {
							await voiceChannelManager.handleSpawnJoin(
								newState.member!,
								guild,
							);
							console.log(`✅ Handled spawn join for ${user.username}`);
						} catch (error) {
							console.error(
								`🔸 Error handling spawn join for ${user.username}:`,
								error,
							);
						}
					}
				}

				// User left a voice channel
				if (oldState.channelId && !newState.channelId) {
					console.log(
						`🔹 ${user.username} left voice channel ${oldState.channelId}`,
					);

					// Create voice_user_leave action
					try {
						const leaveAction = {
							guild_id: guild.id,
							type: "voice_user_leave",
							payload: {
								user_id: user.id,
								guild_id: guild.id,
								channel_id: oldState.channelId,
								was_owner: false, // We'll determine this from the channel data
							},
						};

						console.log("🔹 Creating voice_user_leave action...");
						const result = await db.createAction(leaveAction);

						if (result.success) {
							console.log(
								`✅ Created voice_user_leave action for ${user.username}`,
							);
						} else {
							console.error(
								`🔸 Failed to create voice_user_leave action:`,
								result.error,
							);
						}
					} catch (error) {
						console.error(`🔸 Error creating voice_user_leave action:`, error);
					}
				}

				// User switched channels
				if (
					oldState.channelId &&
					newState.channelId &&
					oldState.channelId !== newState.channelId
				) {
					console.log(
						`🔹 ${user.username} switched from ${oldState.channelId} to ${newState.channelId}`,
					);
				}
			});

			console.log("🔹 Minimal bot ready for testing!");
			console.log("🔹 Join the spawn channel to test voice channel creation");
			console.log("🔹 Press Ctrl+C to stop");

			// Keep the bot running
			process.on("SIGINT", async () => {
				console.log("\n🔹 Shutting down minimal bot...");
				await db.disconnect();
				await client.destroy();
				process.exit(0);
			});
		} else {
			console.error("🔸 No spawn channel ID configured");
		}
	} catch (error) {
		console.error("🔸 Error:", error);
		await db.disconnect();
		await client.destroy();
	}
}

startMinimalBot();
