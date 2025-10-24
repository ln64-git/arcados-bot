import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";

dotenv.config();

async function testSurrealCloudConnection() {
	console.log("🔹 Testing SurrealDB Cloud connection...");
	console.log("🔹 Environment variables:");
	console.log(`   SURREAL_URL: ${process.env.SURREAL_URL || "NOT SET"}`);
	console.log(
		`   SURREAL_NAMESPACE: ${process.env.SURREAL_NAMESPACE || "NOT SET"}`,
	);
	console.log(
		`   SURREAL_DATABASE: ${process.env.SURREAL_DATABASE || "NOT SET"}`,
	);
	console.log(
		`   SURREAL_USERNAME: ${process.env.SURREAL_USERNAME || "NOT SET"}`,
	);
	console.log(
		`   SURREAL_TOKEN: ${process.env.SURREAL_TOKEN ? "SET" : "NOT SET"}`,
	);

	const db = new SurrealDBManager();

	try {
		console.log("\n🔹 Attempting to connect to SurrealDB Cloud...");
		await db.connect();
		console.log("✅ Connected successfully!");

		console.log("\n🔹 Testing message retrieval...");
		const messages = await db.getMessages();
		console.log(`✅ Found ${messages.length} total messages`);

		const userId = "99195129516007424";
		const userMessages = messages.filter((msg) => msg.author_id === userId);
		console.log(`✅ Found ${userMessages.length} messages from user ${userId}`);

		if (userMessages.length > 0) {
			// Sort by timestamp ascending (earliest first)
			userMessages.sort(
				(a, b) =>
					new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
			);

			console.log("\n🔹 Earliest 5 messages from this user:");
			console.log("=".repeat(80));

			const earliest = userMessages.slice(0, 5);
			earliest.forEach((msg, i) => {
				console.log(`${i + 1}. [${new Date(msg.timestamp).toLocaleString()}]`);
				console.log(`   Content: "${msg.content || "(No content)"}"`);
				console.log(`   Channel: ${msg.channel_id}`);
				console.log(`   Guild: ${msg.guild_id}`);
				console.log();
			});

			// Show summary
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
		} else {
			console.log("🔹 No messages found for this user");
		}
	} catch (error) {
		console.error("❌ Connection failed:", error);
		console.log("\n🔹 Troubleshooting tips:");
		console.log(
			"   1. Make sure you have a .env file with your SurrealDB Cloud credentials",
		);
		console.log(
			"   2. Check that SURREAL_URL is correct (should start with wss://)",
		);
		console.log("   3. Verify your username/password or token");
		console.log("   4. Ensure your SurrealDB Cloud instance is running");
	} finally {
		console.log("\n🔹 Disconnecting...");
		await db.disconnect();
		console.log("✅ Disconnected");
	}
}

testSurrealCloudConnection().catch(console.error);
