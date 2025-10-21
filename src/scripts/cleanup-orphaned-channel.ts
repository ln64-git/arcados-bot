import { Client, GatewayIntentBits } from "discord.js";

async function cleanupOrphanedChannel() {
	const client = new Client({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
	});

	try {
		await client.login(process.env.DISCORD_TOKEN);
		console.log("🔹 Bot logged in");

		const channelId = "1430032653586796635";
		const channel = await client.channels.fetch(channelId);

		if (channel && channel.isVoiceBased()) {
			console.log(`🔹 Found channel: ${channel.name} (${channel.id})`);
			console.log(`🔹 Channel members: ${channel.members.size}`);

			if (channel.members.size === 0) {
				console.log("🔹 Channel is empty, deleting...");
				await channel.delete("Orphaned user channel cleanup");
				console.log("🔹 Channel deleted successfully");
			} else {
				console.log("🔹 Channel has members, not deleting");
			}
		} else {
			console.log("🔹 Channel not found or not a voice channel");
		}
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await client.destroy();
	}
}

cleanupOrphanedChannel();
