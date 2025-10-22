import { SurrealDBManager } from "../database/SurrealDBManager";
import dotenv from "dotenv";

dotenv.config();

async function quickCheck() {
	console.log("🔹 Starting quick check...");
	
	const db = SurrealDBManager.getInstance();
	
	try {
		console.log("🔹 Attempting to connect...");
		await db.connect();
		console.log("🔹 Connected successfully!");
		
		console.log("🔹 Getting messages...");
		const messages = await db.getMessages();
		console.log(`🔹 Found ${messages.length} total messages`);
		
		const userId = "99195129516007424";
		const userMessages = messages.filter(msg => msg.author_id === userId);
		console.log(`🔹 Found ${userMessages.length} messages from user ${userId}`);
		
		if (userMessages.length > 0) {
			// Sort by timestamp ascending (earliest first)
			userMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
			
			console.log("\n🔹 Earliest 5 messages:");
			const earliest = userMessages.slice(0, 5);
			earliest.forEach((msg, i) => {
				console.log(`${i + 1}. [${new Date(msg.timestamp).toLocaleString()}] "${msg.content || '(No content)'}"`);
			});
		}
		
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		console.log("🔹 Disconnecting...");
		await db.disconnect();
		console.log("🔹 Done!");
	}
}

quickCheck().catch(console.error);
