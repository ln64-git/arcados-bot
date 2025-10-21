import { SurrealDBManager } from "../database/SurrealDBManager.js";

async function fixActionsSchema() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Drop the existing payload field and recreate it as string
		console.log("🔹 Dropping existing payload field...");
		await db.query("REMOVE FIELD payload ON actions");

		console.log("🔹 Creating payload field as string...");
		await db.query("DEFINE FIELD payload ON actions TYPE string");

		console.log("✅ Actions schema fixed!");
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

fixActionsSchema();
