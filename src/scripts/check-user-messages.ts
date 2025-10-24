import { SurrealDBManager } from "../database/SurrealDBManager";
import dotenv from "dotenv";

dotenv.config();

async function checkUserMessages() {
	const db = SurrealDBManager.getInstance();
	try {
		await db.connect();
		console.log("🔹 Connected to database");

		const userId = "99195129516007424";
		console.log(`🔹 Checking messages for user ${userId}...`);

		// Get all messages
		const allMessages = await db.getMessages();
		console.log(`🔹 Total messages in database: ${allMessages.length}`);

		// Filter by user
		const userMessages = allMessages.filter((msg) => msg.author_id === userId);
		console.log(`🔹 Messages from user ${userId}: ${userMessages.length}`);

		if (userMessages.length === 0) {
			console.log("🔹 No messages found for this user");
			return;
		}

		// Sort by timestamp ascending (earliest first)
		userMessages.sort(
			(a, b) =>
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);

		console.log("\n🔹 Earliest 5 messages from this user:");
		console.log("=".repeat(80));

		const earliestMessages = userMessages.slice(0, 5);
		earliestMessages.forEach((msg, index) => {
			console.log(
				`${index + 1}. [${new Date(msg.timestamp).toLocaleString()}]`,
			);
			console.log(`   Content: "${msg.content || "(No content)"}"`);
			console.log(`   Channel: ${msg.channel_id}`);
			console.log(`   Guild: ${msg.guild_id}`);
			console.log(`   Message ID: ${msg.id}`);
			console.log();
		});

		// Show some stats
		const channels = [...new Set(userMessages.map((msg) => msg.channel_id))];
		const guilds = [...new Set(userMessages.map((msg) => msg.guild_id))];
		const oldestMessage = userMessages[0];
		const newestMessage = userMessages[userMessages.length - 1];

		console.log("🔹 User Activity Summary:");
		console.log(`   Total messages: ${userMessages.length}`);
		console.log(`   Channels: ${channels.length} (${channels.join(", ")})`);
		console.log(`   Guilds: ${guilds.length} (${guilds.join(", ")})`);
		console.log(
			`   Date range: ${new Date(oldestMessage.timestamp).toLocaleString()} to ${new Date(newestMessage.timestamp).toLocaleString()}`,
		);
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

checkUserMessages().catch(console.error);
