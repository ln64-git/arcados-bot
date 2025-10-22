import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function testGetMessages() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test the new getMessages method
		console.log("🔹 Testing getMessages method...");
		const allMessages = await db.getMessages();
		console.log("🔹 All messages count:", allMessages.length);

		if (allMessages.length > 0) {
			console.log("🔹 First message:", allMessages[0]);
		}

		// Test filtering by guild
		console.log("🔹 Testing getMessages with guild filter...");
		const guildMessages = await db.getMessages("1254694808228986912");
		console.log("🔹 Guild messages count:", guildMessages.length);

		// Test filtering by channel
		console.log("🔹 Testing getMessages with channel filter...");
		const channelMessages = await db.getMessages(
			"1254694808228986912",
			"1430111461547446402",
		);
		console.log("🔹 Channel messages count:", channelMessages.length);

		// Test with limit
		console.log("🔹 Testing getMessages with limit...");
		const limitedMessages = await db.getMessages(undefined, undefined, 5);
		console.log("🔹 Limited messages count:", limitedMessages.length);
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testGetMessages().catch(console.error);
