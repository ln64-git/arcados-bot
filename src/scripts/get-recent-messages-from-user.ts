import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function getRecentMessagesFromUser() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		const userId = "99195129516007424";
		console.log(`🔹 Getting recent messages from user ${userId}...`);

		// Get all messages and filter by author_id
		const allMessages = await db.getMessages();
		const userMessages = allMessages.filter((msg) => msg.author_id === userId);

		console.log(`🔹 Found ${userMessages.length} messages from user ${userId}`);

		if (userMessages.length > 0) {
			console.log("🔹 Recent messages from this user:");
			userMessages.slice(0, 10).forEach((msg, index) => {
				console.log(`${index + 1}. [${msg.timestamp}] ${msg.content}`);
				console.log(`   Channel: ${msg.channel_id}, Guild: ${msg.guild_id}`);
				console.log(`   Message ID: ${msg.id}`);
				console.log("");
			});

			if (userMessages.length > 10) {
				console.log(`... and ${userMessages.length - 10} more messages`);
			}
		} else {
			console.log("🔸 No messages found from this user");
		}

		// Also show some stats
		if (userMessages.length > 0) {
			const channels = [...new Set(userMessages.map((msg) => msg.channel_id))];
			const guilds = [...new Set(userMessages.map((msg) => msg.guild_id))];

			console.log("🔹 Stats:");
			console.log(`   Total messages: ${userMessages.length}`);
			console.log(`   Channels: ${channels.length} (${channels.join(", ")})`);
			console.log(`   Guilds: ${guilds.length} (${guilds.join(", ")})`);

			const oldestMessage = userMessages[userMessages.length - 1];
			const newestMessage = userMessages[0];
			console.log(
				`   Date range: ${oldestMessage.timestamp} to ${newestMessage.timestamp}`,
			);
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

getRecentMessagesFromUser().catch(console.error);
