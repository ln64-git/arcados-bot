import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager.js";
import { discordMessageToSurreal } from "../database/schema.js";

async function healMessages() {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
		],
	});

	const db = new SurrealDBManager();

	try {
		console.log("🔹 Connecting to Discord and SurrealDB...");
		await Promise.all([
			client.login(process.env.BOT_TOKEN),
			db.connect(),
		]);

		console.log("🔹 Connected successfully");

		// Wait for client to be ready
		await new Promise((resolve) => client.once("ready", resolve));
		console.log("🔹 Discord client ready");

		// Get the guild (Arcados)
		const guild = client.guilds.cache.get("1254694808228986912");
		if (!guild) {
			console.log("🔸 Guild not found");
			return;
		}

		console.log(`🔹 Healing messages for guild: ${guild.name}`);

		let totalSynced = 0;
		let totalChannels = 0;

		// Sync messages from all text channels
		for (const channel of guild.channels.cache.values()) {
			if (channel.isTextBased() && !channel.isDMBased()) {
				totalChannels++;
				console.log(`🔹 Syncing messages from channel: ${channel.name}`);

				try {
					// Fetch recent messages (last 100 per channel)
					const messages = await channel.messages.fetch({ limit: 100 });
					console.log(`🔹 Found ${messages.size} messages in ${channel.name}`);

					let channelSynced = 0;
					for (const message of messages.values()) {
						// Skip bot messages
						if (message.author.bot) continue;

						// Check if message exists in DB
						const existing = await db.db.select(`messages:${message.id}`);
						if (!existing || existing.length === 0) {
							// Message doesn't exist, sync it
							const messageData = discordMessageToSurreal(message);
							const result = await db.upsertMessage(messageData);

							if (result.success) {
								channelSynced++;
								totalSynced++;
								console.log(
									`🔹 Synced message ${message.id}: "${message.content.substring(0, 50)}..."`,
								);
							} else {
								console.error(
									`🔸 Failed to sync message ${message.id}:`,
									result.error,
								);
							}
						}
					}

					console.log(
						`🔹 Synced ${channelSynced} new messages from ${channel.name}`,
					);
				} catch (error) {
					console.error(
						`🔸 Error syncing messages from channel ${channel.name}:`,
						error,
					);
				}
			}
		}

		console.log(`🔹 Message healing complete:`);
		console.log(`   - Channels processed: ${totalChannels}`);
		console.log(`   - Messages synced: ${totalSynced}`);

		// Check if the specific message is now in the database
		const testMessageId = "1428938626594639964";
		console.log(
			`🔹 Checking if message ${testMessageId} is now in database...`,
		);

		const testResult = await db.db.select(`messages:${testMessageId}`);
		if (testResult && testResult.length > 0) {
			const message = testResult[0];
			console.log(`🔹 ✅ Message found in database:`);
			console.log(`   Content: "${message.content}"`);
			console.log(`   Author: ${message.author_id}`);
			console.log(`   Channel: ${message.channel_id}`);
			console.log(`   Timestamp: ${message.timestamp}`);
		} else {
			console.log(`🔸 ❌ Message ${testMessageId} still not found in database`);
		}
	} catch (error) {
		console.error("🔸 Error during message healing:", error);
	} finally {
		await Promise.all([client.destroy(), db.disconnect()]);
		console.log("🔹 Disconnected");
	}
}

healMessages().catch(console.error);
