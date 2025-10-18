import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";

async function checkBotGuilds() {
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

		console.log("🔹 Bot is connected to these guilds:");
		for (const [id, guild] of client.guilds.cache) {
			console.log(`  - ${guild.name} (${id})`);
		}

		const envGuildId = process.env.GUILD_ID;
		console.log(`\n🔹 GUILD_ID from .env: ${envGuildId}`);

		const envGuild = client.guilds.cache.get(envGuildId!);
		if (envGuild) {
			console.log(`🔹 Found guild from .env: ${envGuild.name}`);
		} else {
			console.log(`🔸 Guild ${envGuildId} not found in bot's guilds`);
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await client.destroy();
		console.log("🔹 Disconnected");
	}
}

checkBotGuilds().catch(console.error);
