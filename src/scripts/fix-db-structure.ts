import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";

dotenv.config();

console.log("🔧 Fixing Database Structure - Consolidating Messages...");

async function main() {
	try {
		// Connect to SurrealDB
		console.log("🔹 Connecting to SurrealDB...");
		const db = new SurrealDBManager();
		await db.connect();
		console.log("✅ Connected to SurrealDB");

		// First, let's see what we have
		console.log("🔹 Checking current message count...");
		const currentMessages = await db.getMessages();
		console.log(`📊 Current messages in main table: ${currentMessages.length}`);

		// Try to find individual message tables
		console.log("🔹 Looking for individual message tables...");

		// Get database info
		const dbInfo = await db.db.query("INFO FOR DB");
		console.log("📋 Database structure:", JSON.stringify(dbInfo, null, 2));

		// Try to find tables that start with "messages:"
		console.log("🔹 Searching for scattered message records...");

		// Try a few common patterns
		const patterns = [
			"messages:1254694808228986912:*",
			"messages:*",
			"message:*",
		];

		let totalFound = 0;
		for (const pattern of patterns) {
			try {
				console.log(`🔍 Checking pattern: ${pattern}`);
				const result = await db.db.query(`SELECT * FROM ${pattern} LIMIT 10`);
				console.log(
					`   Found ${Array.isArray(result) ? result.length : 0} records`,
				);

				if (Array.isArray(result) && result.length > 0) {
					totalFound += result.length;
					console.log(`   Sample record:`, JSON.stringify(result[0], null, 2));
				}
			} catch (error) {
				console.log(`   Pattern ${pattern} not found or error:`, error.message);
			}
		}

		console.log(`📊 Total scattered records found: ${totalFound}`);

		// If we found scattered records, we need to consolidate them
		if (totalFound > 0) {
			console.log("🔧 Consolidating scattered message records...");

			// This is a complex operation - we'd need to:
			// 1. Find all scattered records
			// 2. Copy them to the main messages table
			// 3. Delete the scattered records

			console.log(
				"⚠️  Manual consolidation needed - scattered records detected",
			);
			console.log(
				"💡 Recommendation: Clear database and re-run sync with fixed script",
			);
		} else {
			console.log(
				"✅ No scattered records found - database structure is correct",
			);
		}

		// Test the fixed sync by running a small test
		console.log("🧪 Testing message insertion...");
		try {
			const testMessage = {
				guild_id: "1254694808228986912",
				channel_id: "test_channel",
				author_id: "test_user",
				content: "Test message for structure verification",
				created_at: new Date(),
				updated_at: new Date(),
				active: true,
			};

			const result = await db.upsertMessage(testMessage);
			if (result.success) {
				console.log("✅ Test message inserted successfully");

				// Verify it's in the main table
				const messages = await db.getMessages();
				const testMsg = messages.find(
					(m) => m.content === "Test message for structure verification",
				);
				if (testMsg) {
					console.log("✅ Test message found in main messages table");
					console.log(`   Message ID: ${testMsg.id}`);
				} else {
					console.log("❌ Test message not found in main table");
				}
			} else {
				console.log("❌ Test message insertion failed:", result.error);
			}
		} catch (error) {
			console.log("❌ Test insertion error:", error.message);
		}
	} catch (error) {
		console.error("❌ Database fix failed:", error);
	} finally {
		process.exit(0);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
