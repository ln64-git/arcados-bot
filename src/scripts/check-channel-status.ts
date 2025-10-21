import { Client, GatewayIntentBits } from "discord.js";

async function checkChannelStatus() {
	const client = new Client({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
	});

	try {
		await client.login(process.env.DISCORD_TOKEN);
		console.log("🔹 Bot logged in");

		const guild = client.guilds.cache.get("1254694808228986912");
		if (!guild) {
			console.log("🔸 Guild not found");
			return;
		}

		const channelId = "1430054756574957609";
		const channel = await guild.channels.fetch(channelId);
		
		if (channel) {
			console.log(`🔹 Channel found: ${channel.name} (${channel.id})`);
			if (channel.isVoiceBased()) {
				console.log(`🔹 Member count: ${channel.members.size}`);
				console.log(`🔹 Members: ${Array.from(channel.members.keys()).join(', ')}`);
			}
		} else {
			console.log(`🔸 Channel ${channelId} not found (may have been deleted)`);
		}

	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await client.destroy();
	}
}

checkChannelStatus();
