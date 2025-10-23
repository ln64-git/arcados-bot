#!/usr/bin/env npx tsx

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { Client, GatewayIntentBits } from "discord.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function debugDiscordConnection() {
	console.log("🔹 Debugging Discord connection...");

	if (!process.env.BOT_TOKEN) {
		console.error("🔸 BOT_TOKEN not found");
		process.exit(1);
	}

	if (!process.env.GUILD_ID) {
		console.error("🔸 GUILD_ID not found");
		process.exit(1);
	}

	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.GuildMembers,
		],
	});

	try {
		console.log("🔹 Logging in to Discord...");
		await client.login(process.env.BOT_TOKEN);
		console.log("✅ Logged in to Discord");

		console.log("🔹 Waiting for ready event...");
		await new Promise<void>((resolve) => {
			client.once("ready", () => {
				console.log(`✅ Bot ready! Logged in as ${client.user?.tag}`);
				resolve();
			});
		});

		console.log("🔹 Fetching guild...");
		const guild = await client.guilds.fetch(process.env.GUILD_ID);
		console.log(`✅ Found guild: ${guild.name} (${guild.memberCount} members)`);

		console.log("🔹 Fetching channels...");
		await guild.channels.fetch();
		console.log(`✅ Found ${guild.channels.cache.size} channels`);

		console.log("🔹 Fetching roles...");
		await guild.roles.fetch();
		console.log(`✅ Found ${guild.roles.cache.size} roles`);

		console.log("🔹 Fetching members...");
		await guild.members.fetch();
		console.log(`✅ Found ${guild.members.cache.size} members`);

		console.log("✅ All Discord data fetched successfully!");

	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await client.destroy();
		console.log("🔹 Discord client destroyed");
	}
}

debugDiscordConnection().catch((error) => {
	console.error("🔸 Unhandled error:", error);
	process.exit(1);
});

