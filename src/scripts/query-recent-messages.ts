import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";

dotenv.config();

console.log("🔍 Querying Database for Recent Messages...");

async function main() {
	try {
		// Connect to SurrealDB
		console.log("🔹 Connecting to SurrealDB...");
		const db = new SurrealDBManager();
		await db.connect();
		console.log("✅ Connected to SurrealDB");

		// Get recent messages
		console.log("🔹 Fetching recent messages...");
		const messages = await db.getMessages();

		if (messages.length === 0) {
			console.log("❌ No messages found in database");
			return;
		}

		console.log(`✅ Found ${messages.length} total messages`);

		// Sort by creation date (most recent first)
		const recentMessages = messages
			.sort(
				(a, b) =>
					new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
			)
			.slice(0, 20); // Get 20 most recent

		console.log("\n📨 RECENT MESSAGES (Last 20):");
		console.log("=".repeat(80));

		recentMessages.forEach((msg, index) => {
			const date = new Date(msg.created_at).toLocaleString();
			const content =
				msg.content.length > 100
					? msg.content.substring(0, 100) + "..."
					: msg.content;

			console.log(`${index + 1}. [${date}]`);
			console.log(`   Author: ${msg.author_id}`);
			console.log(`   Channel: ${msg.channel_id}`);
			console.log(`   Content: "${content}"`);
			console.log(`   ID: ${msg.id}`);
			console.log("");
		});

		// Show message count by user
		console.log("👥 MESSAGE COUNT BY USER:");
		console.log("=".repeat(40));
		const userCounts = {};
		messages.forEach((msg) => {
			userCounts[msg.author_id] = (userCounts[msg.author_id] || 0) + 1;
		});

		const sortedUsers = Object.entries(userCounts)
			.sort(([, a], [, b]) => b - a)
			.slice(0, 10);

		sortedUsers.forEach(([userId, count]) => {
			console.log(`   ${userId}: ${count} messages`);
		});

		// Show date range
		console.log("\n📅 DATE RANGE:");
		console.log("=".repeat(40));
		const dates = messages.map((msg) => new Date(msg.created_at));
		const oldest = new Date(Math.min(...dates));
		const newest = new Date(Math.max(...dates));
		const daysDiff = (newest - oldest) / (1000 * 60 * 60 * 24);

		console.log(`   Oldest: ${oldest.toLocaleString()}`);
		console.log(`   Newest: ${newest.toLocaleString()}`);
		console.log(`   Span: ${daysDiff.toFixed(1)} days`);
	} catch (error) {
		console.error("❌ Query failed:", error);
	} finally {
		process.exit(0);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
