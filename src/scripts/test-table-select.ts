import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function testTableSelect() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test different ways to access the messages table
		console.log("🔹 Test 1: db.db.select('messages')");
		try {
			const result1 = await db.db.select("messages");
			console.log("🔹 Select result:", result1.length, "messages");
		} catch (error) {
			console.log("🔸 Select failed:", error.message);
		}

		console.log("🔹 Test 2: db.db.query('SELECT * FROM messages')");
		try {
			const result2 = await db.db.query("SELECT * FROM messages");
			console.log(
				"🔹 Query result:",
				result2[0]?.result?.length || 0,
				"messages",
			);
		} catch (error) {
			console.log("🔸 Query failed:", error.message);
		}

		console.log("🔹 Test 3: db.db.query('SELECT * FROM messages LIMIT 5')");
		try {
			const result3 = await db.db.query("SELECT * FROM messages LIMIT 5");
			console.log(
				"🔹 Query with limit result:",
				result3[0]?.result?.length || 0,
				"messages",
			);
		} catch (error) {
			console.log("🔸 Query with limit failed:", error.message);
		}

		console.log("🔹 Test 4: db.db.query('SELECT count() FROM messages')");
		try {
			const result4 = await db.db.query("SELECT count() FROM messages");
			console.log(
				"🔹 Count result:",
				result4[0]?.result?.[0]?.["count()"] || 0,
				"messages",
			);
		} catch (error) {
			console.log("🔸 Count failed:", error.message);
		}

		console.log("🔹 Test 5: Direct select by ID");
		try {
			const result5 = await db.db.select("messages:test-message-123");
			console.log(
				"🔹 Direct select result:",
				result5.length > 0 ? "Found" : "Not found",
			);
		} catch (error) {
			console.log("🔸 Direct select failed:", error.message);
		}

		// Check database info
		console.log("🔹 Test 6: Database info");
		try {
			const dbInfo = await db.db.query("INFO FOR DB");
			console.log("🔹 Database info:", JSON.stringify(dbInfo, null, 2));
		} catch (error) {
			console.log("🔸 Database info failed:", error.message);
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

testTableSelect().catch(console.error);
