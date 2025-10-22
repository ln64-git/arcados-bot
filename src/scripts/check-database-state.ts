import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function checkDatabaseState() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Check database info to see what tables exist
		console.log("🔹 Checking database info...");
		try {
			const dbInfo = await db.db.query("INFO FOR DB");
			const tables = dbInfo[0]?.result?.tables || {};
			const messageTables = Object.keys(tables).filter((key) =>
				key.startsWith("messages:"),
			);
			console.log("🔹 Found message tables:", messageTables.length);
			console.log("🔹 First 10 message tables:", messageTables.slice(0, 10));
		} catch (error) {
			console.log("🔸 Database info failed:", error.message);
		}

		// Try to select from the messages table directly
		console.log("🔹 Trying direct table select...");
		try {
			const directSelect = await db.db.select("messages");
			console.log("🔹 Direct select result:", directSelect.length, "messages");
			if (directSelect.length > 0) {
				console.log("🔹 First message:", directSelect[0]);
			}
		} catch (error) {
			console.log("🔸 Direct select failed:", error.message);
		}

		// Try a different query approach
		console.log("🔹 Trying alternative query...");
		try {
			const altQuery = await db.db.query("SELECT * FROM messages LIMIT 5");
			console.log(
				"🔹 Alternative query result:",
				altQuery[0]?.result?.length || 0,
				"messages",
			);
		} catch (error) {
			console.log("🔸 Alternative query failed:", error.message);
		}

		// Check if there are any records at all
		console.log("🔹 Checking for any records...");
		try {
			const anyRecords = await db.db.query(
				"SELECT * FROM messages WHERE active = true LIMIT 1",
			);
			console.log(
				"🔹 Any records query result:",
				anyRecords[0]?.result?.length || 0,
				"messages",
			);
		} catch (error) {
			console.log("🔸 Any records query failed:", error.message);
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

checkDatabaseState().catch(console.error);
