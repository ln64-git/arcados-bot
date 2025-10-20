import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function compareStates() {
	const dbManager = new SurrealDBManager();
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildVoiceStates,
		],
	});

	try {
		console.log("🔍 Comparing Database vs Discord Live State...\n");

		// Connect to Discord
		await client.login(process.env.DISCORD_BOT_TOKEN);
		await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for cache to populate

		// Connect to database
		await dbManager.connect();

		const guildId = "1254694808228986912";
		const guild = await client.guilds.fetch(guildId);

		// Get Discord live state
		console.log("📡 DISCORD LIVE STATE:");
		const discordVoiceStates = new Map<string, string>(); // userId -> channelId

		for (const [userId, voiceState] of guild.voiceStates.cache) {
			if (voiceState.channelId) {
				discordVoiceStates.set(userId, voiceState.channelId);
				console.log(
					`   ✓ ${userId} in channel ${voiceState.channel?.name} (${voiceState.channelId})`,
				);
			}
		}
		console.log(`   Total: ${discordVoiceStates.size} users in voice\n`);

		// Get database state
		console.log("💾 DATABASE STATE:");
		const dbResult = await dbManager.db.query(
			"SELECT * FROM voice_states WHERE guild_id = $guild_id AND channel_id IS NOT NONE",
			{ guild_id: guildId },
		);
		const dbVoiceStates = (dbResult[0] as any[]) || [];
		const dbMap = new Map<string, string>(); // userId -> channelId

		for (const state of dbVoiceStates) {
			dbMap.set(state.user_id, state.channel_id);
			console.log(`   ✓ ${state.user_id} in channel ${state.channel_id}`);
		}
		console.log(`   Total: ${dbVoiceStates.length} users in voice\n`);

		// Compare
		console.log("🔍 COMPARISON RESULTS:");

		// Users in Discord but not in DB
		const missingInDB: string[] = [];
		for (const [userId, channelId] of discordVoiceStates) {
			if (!dbMap.has(userId)) {
				missingInDB.push(`${userId} (should be in ${channelId})`);
			} else if (dbMap.get(userId) !== channelId) {
				console.log(`   ⚠️  MISMATCH: User ${userId}`);
				console.log(`      Discord: ${channelId}`);
				console.log(`      Database: ${dbMap.get(userId)}`);
			}
		}

		// Users in DB but not in Discord
		const extraInDB: string[] = [];
		for (const [userId, channelId] of dbMap) {
			if (!discordVoiceStates.has(userId)) {
				extraInDB.push(`${userId} (channel_id: ${channelId})`);
			}
		}

		if (missingInDB.length === 0 && extraInDB.length === 0) {
			console.log("   ✅ PERFECT SYNC - Database matches Discord exactly!");
		} else {
			if (missingInDB.length > 0) {
				console.log(`   🔸 MISSING IN DATABASE (${missingInDB.length} users):`);
				missingInDB.forEach((u) => console.log(`      - ${u}`));
			}
			if (extraInDB.length > 0) {
				console.log(
					`   🔸 EXTRA IN DATABASE (${extraInDB.length} users - stale data):`,
				);
				extraInDB.forEach((u) => console.log(`      - ${u}`));
			}
		}

		// Check "not in voice" records
		const notInVoiceResult = await dbManager.db.query(
			"SELECT * FROM voice_states WHERE guild_id = $guild_id AND channel_id IS NONE",
			{ guild_id: guildId },
		);
		const notInVoice = (notInVoiceResult[0] as any[]) || [];
		console.log(
			`\n📊 Users marked as "not in voice" in DB: ${notInVoice.length}`,
		);
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await dbManager.disconnect();
		await client.destroy();
	}
}

compareStates().catch(console.error);
