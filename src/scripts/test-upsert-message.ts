import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function testUpsertMessage() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test upserting a message
		console.log("🔹 Testing upsertMessage...");
		const testMessage = {
			id: "test-message-123",
			guild_id: "1254694808228986912",
			channel_id: "1430111461547446402",
			author_id: "99195129516007424",
			content: "Test message content",
			created_at: new Date(),
			updated_at: new Date(),
		};

		const result = await db.upsertMessage(testMessage);
		console.log("🔹 Upsert result:", result);

		if (result.success) {
			console.log("🔹 Message upserted successfully");

			// Try to retrieve it
			console.log("🔹 Retrieving message...");
			const retrieved = await db.db.select("messages:test-message-123");
			console.log("🔹 Retrieved message:", retrieved);

			// Try to query it
			console.log("🔹 Querying message...");
			const queried = await db.db.query(
				"SELECT * FROM messages WHERE id = 'test-message-123'",
			);
			console.log("🔹 Queried message:", queried);
		} else {
			console.error("🔸 Failed to upsert message:", result.error);
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testUpsertMessage().catch(console.error);
