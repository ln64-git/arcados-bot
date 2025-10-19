import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager";

const TARGET_GUILD_ID = "1254694808228986912"; // Arcados

async function main() {
	console.log("🔹 Starting cleanup and resync of voice states...");

	// Initialize database
	const dbManager = new SurrealDBManager();
	await dbManager.connect();

	// Initialize Discord client
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.GuildMembers,
		],
	});

	await client.login(process.env.DISCORD_BOT_TOKEN);

	// Wait for bot to be ready
	await new Promise<void>((resolve) => {
		client.once("ready", () => {
			console.log("🔹 Discord client ready");
			resolve();
		});
	});

	try {
		// Step 1: Get all voice states from database
		console.log("\n🔹 Step 1: Fetching all voice states from database...");
		const dbResult = await dbManager.db.query(
			"SELECT * FROM voice_states WHERE guild_id = $guild_id",
			{ guild_id: TARGET_GUILD_ID },
		);
		const dbVoiceStates = (dbResult[0] as Record<string, unknown>[]) || [];
		console.log(`   Found ${dbVoiceStates.length} voice states in database`);

		// Step 2: Get current voice states from Discord
		console.log("\n🔹 Step 2: Fetching current voice states from Discord...");
		const guild = client.guilds.cache.get(TARGET_GUILD_ID);
		if (!guild) {
			console.error("🔸 Guild not found!");
			return;
		}

		const liveVoiceUsers = new Set<string>();
		for (const [userId, voiceState] of guild.voiceStates.cache) {
			if (voiceState.channelId) {
				liveVoiceUsers.add(userId);
				console.log(
					`   ${voiceState.member?.user.username} in ${voiceState.channel?.name}`,
				);
			}
		}
		console.log(`   Found ${liveVoiceUsers.size} users in voice channels`);

		// Step 3: Clear channel_id for users NOT in voice
		console.log(
			"\n🔹 Step 3: Clearing channel_id for users not currently in voice...",
		);
		let clearedCount = 0;
		let errorCount = 0;

		for (const voiceState of dbVoiceStates) {
			const userId = voiceState.user_id as string;
			const isInVoice = liveVoiceUsers.has(userId);
			const hasChannelId =
				voiceState.channel_id !== null &&
				voiceState.channel_id !== undefined &&
				voiceState.channel_id !== "NONE";

			// If user is NOT in voice but has a channel_id, clear it
			if (!isInVoice && hasChannelId) {
				try {
					const voiceStateId = (voiceState.id as { id: string }).id;
					const updateQuery = `
						UPDATE type::thing("voice_states", $id) SET 
							channel_id = NONE,
							updated_at = time::now()
					`;
					await dbManager.db.query(updateQuery, { id: voiceStateId });
					clearedCount++;
					console.log(`   ✓ Cleared channel_id for user ${userId}`);
				} catch (error) {
					errorCount++;
					console.error(
						`   ✗ Failed to clear channel_id for user ${userId}:`,
						error,
					);
				}
			}
		}

		console.log(
			`\n🔹 Cleanup complete: ${clearedCount} records cleared, ${errorCount} errors`,
		);

		// Step 4: Verify cleanup
		console.log("\n🔹 Step 4: Verifying cleanup...");
		const verifyResult = await dbManager.db.query(
			"SELECT * FROM voice_states WHERE guild_id = $guild_id AND channel_id IS NOT NONE",
			{ guild_id: TARGET_GUILD_ID },
		);
		const remainingInVoice =
			(verifyResult[0] as Record<string, unknown>[]) || [];
		console.log(
			`   ${remainingInVoice.length} users still marked as in voice channels`,
		);

		// Display remaining users
		for (const state of remainingInVoice) {
			console.log(`   - User ${state.user_id} in channel ${state.channel_id}`);
		}

		// Step 5: Compare with Discord live state
		console.log(
			"\n🔹 Step 5: Comparing database state with Discord live state...",
		);
		const dbUserIds = new Set(remainingInVoice.map((s) => s.user_id as string));
		const discrepancies: string[] = [];

		for (const userId of liveVoiceUsers) {
			if (!dbUserIds.has(userId)) {
				discrepancies.push(`Missing in DB: ${userId}`);
			}
		}

		for (const userId of dbUserIds) {
			if (!liveVoiceUsers.has(userId)) {
				discrepancies.push(`Extra in DB: ${userId}`);
			}
		}

		if (discrepancies.length > 0) {
			console.log(`   Found ${discrepancies.length} discrepancies:`);
			for (const disc of discrepancies) {
				console.log(`   - ${disc}`);
			}
		} else {
			console.log("   ✓ Database and Discord states match!");
		}
	} catch (error) {
		console.error("🔸 Error during cleanup:", error);
	} finally {
		await client.destroy();
		await dbManager.disconnect();
		console.log("\n🔹 Cleanup script complete");
		process.exit(0);
	}
}

main();
