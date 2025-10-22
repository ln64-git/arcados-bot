import { SurrealDBManager } from "../database/SurrealDBManager.js";
import dotenv from "dotenv";

dotenv.config();

async function wipeDatabase() {
	console.log("🔹 WIPING DATABASE - Starting fresh...");
	
	const db = new SurrealDBManager();
	
	try {
		await db.connect();
		console.log("✅ Connected to SurrealDB Cloud");
		
		// Wipe all message data
		console.log("🔹 Deleting all messages...");
		await db.query("DELETE messages");
		
		console.log("🔹 Deleting all members...");
		await db.query("DELETE members");
		
		console.log("🔹 Deleting all channels...");
		await db.query("DELETE channels");
		
		console.log("🔹 Deleting all guilds...");
		await db.query("DELETE guilds");
		
		console.log("✅ Database wiped clean!");
		
	} catch (error) {
		console.error("❌ Error wiping database:", error);
	} finally {
		await db.disconnect();
		console.log("✅ Disconnected");
	}
}

wipeDatabase().catch(console.error);
