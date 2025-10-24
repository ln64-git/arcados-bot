import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";

dotenv.config();

const GUILD_ID = process.env.GUILD_ID || "1254694808228986912";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
	console.error("❌ Missing DISCORD_TOKEN environment variable");
	console.log("🔹 Using GUILD_ID:", GUILD_ID);
	process.exit(1);
}

console.log("🔹 Starting CONTINUATION Discord Sync...");
console.log("🔹 Target Guild ID:", GUILD_ID);

async function main() {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
		],
	});

	try {
		// Connect to Discord
		console.log("🔹 Connecting to Discord...");
		await client.login(DISCORD_TOKEN);
		console.log("✅ Connected to Discord");

		// Connect to SurrealDB
		console.log("🔹 Connecting to SurrealDB...");
		const db = new SurrealDBManager();
		await db.connect();
		console.log("✅ Connected to SurrealDB");

		// Wait for Discord client to initialize
		console.log("🔹 Waiting for Discord client to initialize...");
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const guild = client.guilds.cache.get(GUILD_ID);
		if (!guild) {
			throw new Error("Guild not found");
		}

		console.log("✅ Found guild:", guild.name);
		console.log("🔹 Continuing sync from where we left off...");

		// Get all text channels
		const textChannels = guild.channels.cache.filter(
			(channel) => channel.type === 0 && channel.isTextBased(),
		);

		console.log("🔹 Found", textChannels.size, "text channels");

		// Channels we've already processed (from previous sync)
		const completedChannels = [
			"selfies-irl",
			"lush",
			"ai",
			"gaming",
			"news",
			"butterz",
			"temagami-x-frankie",
			"ant-hill",
			"alex",
			"youtube",
			"polls",
			"америка",
		];

		let totalMessages = 0;
		let processedChannels = 0;
		const failedChannels: string[] = [];

		for (const [channelId, channel] of textChannels) {
			// Skip channels we've already processed
			if (completedChannels.includes(channel.name)) {
				console.log(`⏭️  Skipping already processed channel: ${channel.name}`);
				continue;
			}

			processedChannels++;
			console.log(
				`\n🔹 [${processedChannels}/${textChannels.size - completedChannels.length}] Syncing channel: ${channel.name}`,
			);

			try {
				let channelMessages = 0;
				let lastMessageId: string | undefined;
				let batchCount = 0;
				const maxBatches = 50; // Limit batches per channel
				const batchSize = 100;

				while (batchCount < maxBatches) {
					batchCount++;

					console.log(
						`   🔹 Batch ${batchCount}: Fetching messages from ${channel.name}...`,
					);

					const messages = await channel.messages.fetch({
						limit: batchSize,
						before: lastMessageId,
					});

					if (messages.size === 0) {
						console.log(`   ✅ No more messages in ${channel.name}`);
						break;
					}

					// Process messages
					let batchMessages = 0;
					for (const [messageId, message] of messages) {
						try {
							// Skip bot messages and system messages
							if (message.author.bot || message.system) {
								continue;
							}

							// Store message in database
							await db.upsertMessage({
								id: `messages:${message.guildId}:${message.id}`,
								guild_id: message.guildId!,
								channel_id: message.channelId,
								user_id: message.author.id,
								content: message.content,
								created_at: message.createdAt,
								updated_at: message.editedAt || message.createdAt,
								active: true,
							});

							batchMessages++;
							channelMessages++;
							totalMessages++;
						} catch (error) {
							console.log(
								`   🔸 Error processing message ${messageId}:`,
								error,
							);
							// Continue with next message
						}
					}

					console.log(
						`   🔹 Processed ${batchMessages} messages (channel total: ${channelMessages})`,
					);

					// Update lastMessageId for next batch
					const lastMessage = messages.last();
					if (lastMessage) {
						lastMessageId = lastMessage.id;
					}

					// Small delay to avoid rate limits
					await new Promise((resolve) => setTimeout(resolve, 100));
				}

				console.log(
					`✅ Synced ${channelMessages} messages from ${channel.name}`,
				);

				// If we hit max batches, log it
				if (batchCount >= maxBatches) {
					console.log(
						`⚠️  Hit max batches (${maxBatches}) for ${channel.name}, moving to next channel`,
					);
				}
			} catch (error) {
				console.log(`🔸 Error syncing channel ${channel.name}:`, error);
				failedChannels.push(channel.name);
				// Continue with next channel
			}

			// Small delay between channels
			await new Promise((resolve) => setTimeout(resolve, 200));
		}

		console.log("\n🎉 CONTINUATION SYNC COMPLETE!");
		console.log("📊 Summary:");
		console.log(`   ✅ New messages synced: ${totalMessages}`);
		console.log(
			`   ✅ Channels processed: ${processedChannels}/${textChannels.size - completedChannels.length}`,
		);
		console.log(`   🔸 Failed channels: ${failedChannels.length}`);
		console.log(
			`   📈 Total messages in database: ${totalMessages + 5352}+ (including previous sync)`,
		);

		if (failedChannels.length > 0) {
			console.log("   🔸 Failed channels:", failedChannels.join(", "));
		}
	} catch (error) {
		console.error("❌ Sync failed:", error);
	} finally {
		await client.destroy();
		process.exit(0);
	}
}

// Handle process termination
process.on("SIGINT", () => {
	console.log("\n🔸 Received SIGINT, shutting down gracefully...");
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.log("\n🔸 Received SIGTERM, shutting down gracefully...");
	process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
