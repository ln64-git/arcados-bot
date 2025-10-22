import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";

dotenv.config();

async function checkRealDiscordMessages() {
	console.log("🔹 Checking for REAL Discord messages (not test data)...");
	
	const db = new SurrealDBManager();
	
	try {
		await db.connect();
		console.log("✅ Connected to SurrealDB Cloud");
		
		const messages = await db.getMessages();
		console.log(`🔹 Total messages in database: ${messages.length}`);
		
		// Filter out test messages (look for patterns that indicate test data)
		const realMessages = messages.filter(msg => {
			const content = msg.content?.toLowerCase() || '';
			return !content.includes('test') && 
				   !content.includes('auto-generated') && 
				   !content.includes('second auto-generated') &&
				   content.length > 0 &&
				   content !== '(no content)';
		});
		
		console.log(`🔹 Real Discord messages (excluding test data): ${realMessages.length}`);
		
		const userId = "99195129516007424";
		const userRealMessages = realMessages.filter(msg => msg.author_id === userId);
		console.log(`🔹 Real messages from user ${userId}: ${userRealMessages.length}`);
		
		if (userRealMessages.length > 0) {
			userRealMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
			
			console.log("\n🔹 REAL Discord messages from this user:");
			console.log("=" .repeat(80));
			
			userRealMessages.forEach((msg, i) => {
				console.log(`${i + 1}. [${new Date(msg.timestamp).toLocaleString()}]`);
				console.log(`   Content: "${msg.content}"`);
				console.log(`   Channel: ${msg.channel_id}`);
				console.log(`   Guild: ${msg.guild_id}`);
				console.log();
			});
		} else {
			console.log("🔹 No real Discord messages found for this user");
			console.log("🔹 This suggests Discord sync hasn't captured real messages yet");
		}
		
		// Show all real messages to see what we actually have
		console.log("\n🔹 All real messages in database:");
		realMessages.forEach((msg, i) => {
			console.log(`${i + 1}. [${new Date(msg.timestamp).toLocaleString()}] User: ${msg.author_id}`);
			console.log(`   Content: "${msg.content}"`);
			console.log(`   Channel: ${msg.channel_id}`);
			console.log();
		});
		
	} catch (error) {
		console.error("❌ Error:", error);
	} finally {
		await db.disconnect();
		console.log("✅ Disconnected");
	}
}

checkRealDiscordMessages().catch(console.error);
