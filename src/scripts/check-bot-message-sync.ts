import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { config } from "../config/index.js";

const BOT_USER_ID = "1290873223944343714";

async function checkBotMessageSync(): Promise<void> {
	console.log("🔍 Checking bot message sync status...\n");

	const db = new PostgreSQLManager();
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
		],
	});

	try {
		// Connect to database
		await db.connect();
		console.log("✅ Connected to database\n");

		// Connect to Discord
		await client.login(config.botToken);
		console.log("✅ Connected to Discord\n");

		// Wait for client to be ready
		await new Promise<void>((resolve) => {
			if (client.isReady()) {
				resolve();
			} else {
				client.once("ready", () => resolve());
			}
		});

		// Get all guilds
		const guilds = client.guilds.cache;
		console.log(`📊 Found ${guilds.size} guild(s)\n`);

		for (const [guildId, guild] of guilds) {
			console.log(`\n═══════════════════════════════════════════════════`);
			console.log(`🏰 Guild: ${guild.name} (${guildId})`);
			console.log(`═══════════════════════════════════════════════════\n`);

			// Check database counts
			const dbMentionCount = await db.query(
				`SELECT COUNT(*) as count
				FROM messages
				WHERE guild_id = $1
					AND (content LIKE '%${BOT_USER_ID}%' OR content LIKE '%<@${BOT_USER_ID}>%')
					AND author_id != '${BOT_USER_ID}'`,
				[guildId]
			);

			const dbTotalMessages = await db.query(
				`SELECT COUNT(*) as count
				FROM messages
				WHERE guild_id = $1`,
				[guildId]
			);

			const dbBotMessages = await db.query(
				`SELECT COUNT(*) as count
				FROM messages
				WHERE guild_id = $1 AND author_id = '${BOT_USER_ID}'`,
				[guildId]
			);

			console.log("📦 DATABASE:");
			console.log(
				`  Total messages: ${dbTotalMessages.data?.[0]?.count || 0}`
			);
			console.log(`  Bot messages: ${dbBotMessages.data?.[0]?.count || 0}`);
			console.log(`  Bot mentions: ${dbMentionCount.data?.[0]?.count || 0}`);

			// Check Discord API counts
			let discordMentionCount = 0;
			let discordTotalMessages = 0;
			let discordBotMessages = 0;
			const channelCounts: Record<
				string,
				{ name: string; dbCount: number; discordCount: number; mentions: number }
			> = {};

			const channels = guild.channels.cache.filter(
				(ch) => ch.isTextBased() && !ch.isThread()
			);

			console.log(
				`\n🔍 Scanning ${channels.size} text channels from Discord API...\n`
			);

			for (const [channelId, channel] of channels) {
				if (!channel.isTextBased() || channel.isThread()) continue;

				try {
					// Fetch messages from Discord (last 100)
					const messages = await channel.messages.fetch({ limit: 100 });

					const mentionsInChannel = messages.filter(
						(msg) =>
							(msg.content.includes(BOT_USER_ID) ||
								msg.content.includes(`<@${BOT_USER_ID}>`)) &&
							msg.author.id !== BOT_USER_ID
					).size;

					const botMessagesInChannel = messages.filter(
						(msg) => msg.author.id === BOT_USER_ID
					).size;

					discordTotalMessages += messages.size;
					discordMentionCount += mentionsInChannel;
					discordBotMessages += botMessagesInChannel;

					// Check DB count for this channel
					const dbChannelCount = await db.query(
						`SELECT COUNT(*) as count
						FROM messages
						WHERE guild_id = $1 AND channel_id = $2`,
						[guildId, channelId]
					);

					const dbChannelMentions = await db.query(
						`SELECT COUNT(*) as count
						FROM messages
						WHERE guild_id = $1 AND channel_id = $2
							AND (content LIKE '%${BOT_USER_ID}%' OR content LIKE '%<@${BOT_USER_ID}>%')
							AND author_id != '${BOT_USER_ID}'`,
						[guildId, channelId]
					);

					const dbCount = Number.parseInt(
						dbChannelCount.data?.[0]?.count || "0"
					);
					const dbMentions = Number.parseInt(
						dbChannelMentions.data?.[0]?.count || "0"
					);

					if (mentionsInChannel > 0 || dbMentions > 0) {
						channelCounts[channelId] = {
							name: channel.name,
							dbCount,
							discordCount: messages.size,
							mentions: mentionsInChannel,
						};
					}
				} catch (error: any) {
					if (error.code === 50001) {
						// Missing access
						console.log(`  ⚠️  #${channel.name}: No access`);
					} else {
						console.log(`  ❌ #${channel.name}: ${error.message}`);
					}
				}
			}

			console.log("\n📊 DISCORD API (last 100 messages per channel):");
			console.log(`  Total messages scanned: ${discordTotalMessages}`);
			console.log(`  Bot messages found: ${discordBotMessages}`);
			console.log(`  Bot mentions found: ${discordMentionCount}`);

			console.log("\n📋 CHANNELS WITH BOT MENTIONS:");
			console.log(
				"─────────────────────────────────────────────────────────"
			);
			console.log(
				"Channel Name          | Discord Mentions | DB Mentions | DB Messages | Discord Messages (last 100)"
			);
			console.log(
				"─────────────────────────────────────────────────────────"
			);

			for (const [channelId, data] of Object.entries(channelCounts)) {
				const name = data.name.padEnd(20, " ");
				const discordMentions = data.mentions.toString().padStart(16, " ");
				const dbMentions = "?"; // We'd need to query this
				const dbMessages = data.dbCount.toString().padStart(11, " ");
				const discordMessages = data.discordCount.toString().padStart(25, " ");

				console.log(
					`${name} | ${discordMentions} | ${dbMentions.padStart(11, " ")} | ${dbMessages} | ${discordMessages}`
				);
			}

			console.log("\n💡 ANALYSIS:");
			if (discordMentionCount > (dbMentionCount.data?.[0]?.count || 0)) {
				const missing =
					discordMentionCount - (dbMentionCount.data?.[0]?.count || 0);
				console.log(
					`⚠️  SYNC ISSUE: ${missing} bot mentions found in Discord but not in database`
				);
				console.log(
					`   (Note: Discord API only returns last 100 messages per channel)`
				);
				console.log(
					`   If database has more mentions than Discord API, those are from older messages`
				);
			} else if (
				(dbMentionCount.data?.[0]?.count || 0) > discordMentionCount
			) {
				console.log(
					`✅ Database has ${(dbMentionCount.data?.[0]?.count || 0) - discordMentionCount} additional mentions (likely from older messages)`
				);
			} else {
				console.log("✅ Sync appears correct for recent messages");
			}

			// Check if Discord reports 260 mentions total
			console.log(
				"\n📌 NOTE: Discord's server search shows ~260 mentions total"
			);
			console.log(
				"   The API scan above only checks last 100 messages per channel"
			);
			console.log(
				"   To verify full sync, we need to check if older messages were synced"
			);

			// Check oldest and newest messages in DB
			const oldestMsg = await db.query(
				`SELECT created_at, content
				FROM messages
				WHERE guild_id = $1 AND author_id != '${BOT_USER_ID}'
					AND (content LIKE '%${BOT_USER_ID}%' OR content LIKE '%<@${BOT_USER_ID}>%')
				ORDER BY created_at ASC
				LIMIT 1`,
				[guildId]
			);

			const newestMsg = await db.query(
				`SELECT created_at, content
				FROM messages
				WHERE guild_id = $1 AND author_id != '${BOT_USER_ID}'
					AND (content LIKE '%${BOT_USER_ID}%' OR content LIKE '%<@${BOT_USER_ID}>%')
				ORDER BY created_at DESC
				LIMIT 1`,
				[guildId]
			);

			if (oldestMsg.data && oldestMsg.data.length > 0) {
				console.log(
					"\n⏰ MESSAGE RANGE IN DATABASE:"
				);
				console.log(
					`   Oldest mention: ${new Date(oldestMsg.data[0].created_at).toLocaleString()}`
				);
				console.log(
					`   Newest mention: ${new Date(newestMsg.data[0].created_at).toLocaleString()}`
				);
			}
		}

		console.log("\n✅ Analysis complete!\n");
	} catch (error) {
		console.error("❌ Error:", error);
	} finally {
		await db.disconnect();
		await client.destroy();
	}
}

checkBotMessageSync().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
