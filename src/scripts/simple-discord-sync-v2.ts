import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";

dotenv.config();

interface SimpleMessage {
	id: string;
	content: string;
	author_id: string;
	author_username: string;
	channel_id: string;
	channel_name: string;
	guild_id: string;
	guild_name: string;
	timestamp: Date;
	created_at: Date;
	updated_at: Date;
	active: boolean;
}

class SimpleDiscordSync {
	private client: Client;
	private db: SurrealDBManager;
	private guildId: string;

	constructor() {
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
			],
		});
		this.db = new SurrealDBManager();
		this.guildId = process.env.GUILD_ID!;
	}

	async start() {
		console.log("🔹 Starting SIMPLE Discord Sync...");
		console.log(`🔹 Target Guild ID: ${this.guildId}`);

		try {
			// Connect to Discord
			console.log("🔹 Connecting to Discord...");
			await this.client.login(process.env.BOT_TOKEN);
			console.log("✅ Connected to Discord");

			// Connect to SurrealDB
			console.log("🔹 Connecting to SurrealDB...");
			await this.db.connect();
			console.log("✅ Connected to SurrealDB");

			// Wait a bit for client to initialize
			console.log("🔹 Waiting for Discord client to initialize...");
			await new Promise((resolve) => setTimeout(resolve, 5000));

			// Get the guild
			const guild = this.client.guilds.cache.get(this.guildId);
			if (!guild) {
				console.log("🔹 Guild not in cache, fetching...");
				const fetchedGuild = await this.client.guilds.fetch(this.guildId);
				if (!fetchedGuild) {
					throw new Error(`Guild ${this.guildId} not found!`);
				}
				console.log(`✅ Found guild: ${fetchedGuild.name}`);
				await this.syncAllMessages(fetchedGuild);
			} else {
				console.log(`✅ Found guild: ${guild.name}`);
				await this.syncAllMessages(guild);
			}
		} catch (error) {
			console.error("❌ Error:", error);
		} finally {
			await this.cleanup();
		}
	}

	private async syncAllMessages(guild: any) {
		console.log(`🔹 Syncing ALL messages from guild: ${guild.name}`);

		// Get all text channels
		const textChannels = guild.channels.cache.filter(
			(channel: any) =>
				channel.type === ChannelType.GuildText &&
				channel.permissionsFor(guild.members.me)?.has("ViewChannel"),
		);

		console.log(`🔹 Found ${textChannels.size} text channels`);

		let totalMessages = 0;
		let totalChannels = 0;

		for (const [channelId, channel] of textChannels) {
			totalChannels++;
			console.log(
				`\n🔹 [${totalChannels}/${textChannels.size}] Syncing channel: ${channel.name}`,
			);

			try {
				const channelMessages = await this.syncChannelMessages(channel, guild);
				totalMessages += channelMessages;
				console.log(
					`✅ Synced ${channelMessages} messages from ${channel.name}`,
				);
			} catch (error) {
				console.error(`❌ Error syncing channel ${channel.name}:`, error);
			}
		}

		console.log(`\n🎉 SYNC COMPLETE!`);
		console.log(`✅ Total channels synced: ${totalChannels}`);
		console.log(`✅ Total messages synced: ${totalMessages}`);
	}

	private async syncChannelMessages(channel: any, guild: any): Promise<number> {
		let messageCount = 0;
		let lastMessageId: string | undefined;

		console.log(`   🔹 Fetching messages from ${channel.name}...`);

		while (true) {
			try {
				// Fetch messages in batches of 100
				const options: any = { limit: 100 };
				if (lastMessageId) {
					options.before = lastMessageId;
				}

				const messages = await channel.messages.fetch(options);

				if (messages.size === 0) {
					break; // No more messages
				}

				// Process each message
				for (const [messageId, message] of messages) {
					// Skip bot messages
					if (message.author.bot) continue;

					const simpleMessage: SimpleMessage = {
						id: messageId,
						content: message.content || "",
						author_id: message.author.id,
						author_username: message.author.username,
						channel_id: channel.id,
						channel_name: channel.name,
						guild_id: guild.id,
						guild_name: guild.name,
						timestamp: message.createdAt,
						created_at: message.createdAt,
						updated_at: new Date(),
						active: true,
					};

					// Insert into database
					await this.insertMessage(simpleMessage);
					messageCount++;

					// Update last message ID for pagination
					lastMessageId = messageId;
				}

				console.log(
					`   🔹 Processed ${messages.size} messages (total: ${messageCount})`,
				);

				// Small delay to avoid rate limits
				await new Promise((resolve) => setTimeout(resolve, 100));
			} catch (error) {
				console.error(
					`   ❌ Error fetching messages from ${channel.name}:`,
					error,
				);
				break;
			}
		}

		return messageCount;
	}

	private async insertMessage(message: SimpleMessage) {
		try {
			await this.db.query(
				`INSERT INTO messages (
					id, content, author_id, author_username, 
					channel_id, channel_name, guild_id, guild_name,
					timestamp, created_at, updated_at, active
				) VALUES (
					$id, $content, $author_id, $author_username,
					$channel_id, $channel_name, $guild_id, $guild_name,
					$timestamp, $created_at, $updated_at, $active
				)`,
				{
					id: `messages:${message.id}`,
					content: message.content,
					author_id: message.author_id,
					author_username: message.author_username,
					channel_id: message.channel_id,
					channel_name: message.channel_name,
					guild_id: message.guild_id,
					guild_name: message.guild_name,
					timestamp: message.timestamp,
					created_at: message.created_at,
					updated_at: message.updated_at,
					active: message.active,
				},
			);
		} catch (error) {
			// Ignore duplicate key errors
			if (!error.message.includes("already exists")) {
				console.error(`❌ Error inserting message ${message.id}:`, error);
			}
		}
	}

	private async cleanup() {
		console.log("🔹 Cleaning up...");
		await this.db.disconnect();
		await this.client.destroy();
		console.log("✅ Cleanup complete");
	}
}

// Start the sync
const sync = new SimpleDiscordSync();
sync.start().catch(console.error);
