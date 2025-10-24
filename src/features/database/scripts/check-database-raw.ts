import * as dotenv from "dotenv";
import { Surreal } from "surrealdb";

dotenv.config();

async function checkDatabaseRaw() {
	const db = new Surreal();

	try {
		console.log("🔹 Connecting to SurrealDB...");
		await db.connect(process.env.SURREAL_URL!);

		await db.signin({
			username: process.env.SURREAL_USERNAME || "root",
			password: process.env.SURREAL_PASSWORD || "root",
		});

		await db.use({
			namespace: process.env.SURREAL_NAMESPACE!,
			database: process.env.SURREAL_DATABASE!,
		});

		console.log("🔹 Connected successfully");
		console.log(`🔹 Using namespace: ${process.env.SURREAL_NAMESPACE}`);
		console.log(`🔹 Using database: ${process.env.SURREAL_DATABASE}`);

		// Check what tables exist
		console.log("🔹 Checking database info...");
		const info = await db.query("INFO FOR DB");
		console.log("Database info keys:", Object.keys(info[0] || {}));

		// Check messages table specifically
		console.log("🔹 Checking messages table...");
		const messages = await db.query("SELECT * FROM messages LIMIT 5");
		console.log("Messages query result:", messages);

		// Check if there are any records with 'message' in the table name
		console.log("🔹 Checking for message-related tables...");
		const messageTables = Object.keys(info[0] || {}).filter((key) =>
			key.includes("message"),
		);
		console.log("Message-related tables:", messageTables);

		// Try to find the specific message we saw being synced
		console.log("🔹 Checking for specific message 1430354568461684818...");
		const specificMessage = await db.query(
			"SELECT * FROM messages:1430354568461684818",
		);
		console.log("Specific message:", specificMessage);
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.close();
		console.log("🔹 Disconnected");
	}
}

checkDatabaseRaw().catch(console.error);
