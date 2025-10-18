import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function testMessageInsert() {
	const db = new SurrealDBManager();

	try {
		console.log("🔹 Connecting to SurrealDB...");
		await db.connect();
		console.log("🔹 Connected successfully");

		const guildId = "1004111007611895808";
		const testMessage = {
			id: "test-message-123",
			guild_id: guildId,
			channel_id: "test-channel-456",
			author_id: "test-author-789",
			content: "This is a test message",
			timestamp: new Date(),
			active: true,
			created_at: new Date(),
			updated_at: new Date(),
		};

		console.log("🔹 Inserting test message...");
		const result = await db.upsertMessage(testMessage);
		console.log("🔹 Insert result:", result);

		if (result.success) {
			console.log("🔹 Test message inserted successfully");

			// Try to retrieve it
			console.log("🔹 Retrieving test message...");
			const retrieveResult = await db.getMessage("test-message-123");
			console.log("🔹 Retrieve result:", retrieveResult);

			// Try to query it
			console.log("🔹 Querying test message...");
			const queryResult = await db.db.query(
				`SELECT * FROM messages WHERE id = 'messages:test-message-123'`,
			);
			console.log("🔹 Query result:", queryResult);
		} else {
			console.error("🔸 Failed to insert test message:", result.error);
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testMessageInsert().catch(console.error);
