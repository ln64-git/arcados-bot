import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function processVoiceUserLeaveActions() {
	const db = new SurrealDBManager();
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.GuildMembers,
		],
	});

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB Cloud");

		// Get only voice_user_leave actions
		const result = await db.query(
			"SELECT * FROM actions WHERE type = 'voice_user_leave' AND executed = false AND active = true",
		);

		if (result[0]) {
			const actions = result[0] as any[];
			console.log(`🔹 Found ${actions.length} voice_user_leave actions`);

			for (const action of actions) {
				console.log(`🔹 Processing voice_user_leave action: ${action.id}`);

				try {
					// Parse the payload
					const payload = JSON.parse(action.payload);
					console.log(`   Channel ID: ${payload.channel_id}`);
					console.log(`   User ID: ${payload.user_id}`);
					console.log(`   Was owner: ${payload.was_owner}`);

					// Check if channel is empty and delete if it's a user channel
					const guild = client.guilds.cache.get(payload.guild_id);
					if (guild) {
						const channel = guild.channels.cache.get(payload.channel_id);
						if (channel && channel.isVoiceBased()) {
							const memberCount = channel.members.size;
							console.log(`   Channel has ${memberCount} members`);

							if (memberCount === 0) {
								// Verify this is actually a user channel before deleting
								const channelInfo = await db.query(
									"SELECT is_user_channel FROM channels WHERE id = $channel_id",
									{ channel_id: `channels:${payload.channel_id}` },
								);

								const channelData = (
									channelInfo[0] as Record<string, unknown>
								)?.[0] as Record<string, unknown>;
								const isUserChannel = channelData?.is_user_channel;

								if (isUserChannel) {
									console.log(
										`   ✅ Channel ${payload.channel_id} is empty user channel, creating delete action`,
									);
									await db.createAction({
										guild_id: payload.guild_id,
										type: "voice_channel_delete",
										payload: {
											channel_id: payload.channel_id,
											guild_id: payload.guild_id,
											reason: "Channel empty after user left",
										},
									});
								} else {
									console.log(
										`   ⚠️ Channel ${payload.channel_id} is empty but not a user channel, not deleting`,
									);
								}
							} else {
								console.log(
									`   ⚠️ Channel ${payload.channel_id} is not empty, not deleting`,
								);
							}
						} else {
							console.log(
								`   ⚠️ Channel ${payload.channel_id} not found or not a voice channel`,
							);
						}
					} else {
						console.log(`   ⚠️ Guild ${payload.guild_id} not found`);
					}

					// Mark as executed
					let cleanId: string;
					if (typeof action.id === "string") {
						cleanId = action.id.replace(/^actions:/, "");
					} else {
						cleanId = action.id.id;
					}

					await db.markActionExecuted(`actions:${cleanId}`);
					console.log(`   ✅ Marked as executed`);
				} catch (error) {
					console.error(`   🔸 Failed to process action ${action.id}:`, error);
				}
			}
		} else {
			console.log("🔹 No voice_user_leave actions found");
		}

		console.log("🔹 Voice user leave processing completed");
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		client.destroy();
	}
}

processVoiceUserLeaveActions();
