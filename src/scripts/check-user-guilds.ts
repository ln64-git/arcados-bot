#!/usr/bin/env tsx

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function checkUserInGuilds() {
	const client = new Client({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
	});

	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		await client.login(process.env.DISCORD_BOT_TOKEN);
		console.log("🔹 Connected to Discord");

		const userId = "354823920010002432";

		console.log(`🔹 Checking user ${userId} across all guilds...`);
		console.log(`🔹 Bot is in ${client.guilds.cache.size} guilds`);

		// Check each guild
		for (const guild of client.guilds.cache.values()) {
			console.log(`\n🔹 Checking guild: ${guild.name} (${guild.id})`);

			// Check if user is in this guild
			const member = guild.members.cache.get(userId);
			if (member) {
				console.log(`🔹 ✅ User found in guild ${guild.name}`);
				console.log(`🔹 Username: ${member.user.username}`);
				console.log(`🔹 Display Name: ${member.displayName}`);
				console.log(`🔹 Global Name: ${member.user.globalName}`);
				console.log(`🔹 Avatar: ${member.user.avatar}`);
				console.log(`🔹 Nickname: ${member.nickname}`);

				// Check database for this user in this guild
				const dbResult = await db.getMember(userId, guild.id);
				if (dbResult.success && dbResult.data) {
					console.log(`🔹 ✅ User found in database for guild ${guild.name}`);
					console.log(`🔹 DB Username: ${dbResult.data.username}`);
					console.log(`🔹 DB Display Name: ${dbResult.data.display_name}`);
					console.log(`🔹 DB Profile Hash: ${dbResult.data.profile_hash}`);
					console.log(
						`🔹 DB History Entries: ${dbResult.data.profile_history?.length || 0}`,
					);
				} else {
					console.log(
						`🔸 ❌ User NOT found in database for guild ${guild.name}`,
					);
					console.log(`🔸 Error: ${dbResult.error}`);
				}
			} else {
				console.log(`🔸 User not found in guild ${guild.name}`);
			}
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		await client.destroy();
		console.log("🔹 Disconnected");
	}
}

checkUserInGuilds().catch(console.error);
