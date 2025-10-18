import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";

async function checkGuildId() {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
		],
	});

	try {
		console.log("🔹 Connecting to Discord...");
		await client.login(process.env.BOT_TOKEN);

		await new Promise((resolve) => client.once("ready", resolve));
		console.log("🔹 Bot is ready");

		const guildId = process.env.GUILD_ID;
		console.log(`🔹 Expected guild ID from .env: ${guildId}`);

		const guild = await client.guilds.fetch(guildId!);
		console.log(`🔹 Found guild: ${guild.name} (${guild.id})`);

		// Check a few channels
		const channels = guild.channels.cache.filter(
			(ch) => ch.isTextBased() && !ch.isDMBased(),
		);
		console.log(`🔹 Found ${channels.size} text channels:`);

		for (const [id, channel] of channels) {
			console.log(`  - ${channel.name} (${id})`);
		}

		// Check a channel's messages
		const firstChannel = channels.first();
		if (firstChannel && firstChannel.isTextBased()) {
			console.log(`🔹 Checking messages in ${firstChannel.name}...`);
			const messages = await firstChannel.messages.fetch({ limit: 3 });
			console.log(`🔹 Found ${messages.size} messages:`);

			for (const [id, message] of messages) {
				console.log(
					`  - Message ${id}: guildId=${message.guildId}, channelId=${message.channelId}`,
				);
			}
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await client.destroy();
		console.log("🔹 Disconnected");
	}
}

checkGuildId().catch(console.error);
