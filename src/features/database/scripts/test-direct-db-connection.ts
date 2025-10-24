import { Surreal } from "surrealdb";
import dotenv from "dotenv";

dotenv.config();

const TARGET_USER_ID = "99195129516007424";

console.log("🔍 Direct Database Connection Test...");
console.log("🔹 Target User ID:", TARGET_USER_ID);

async function main() {
	const db = new Surreal();

	try {
		console.log("🔹 Connecting directly to SurrealDB...");

		// Try to connect with environment variables
		const url = process.env.SURREAL_URL || "ws://localhost:8000/rpc";
		const namespace = process.env.SURREAL_NAMESPACE || "test";
		const database = process.env.SURREAL_DATABASE || "test";

		console.log("🔹 Connection details:");
		console.log(`   URL: ${url}`);
		console.log(`   Namespace: ${namespace}`);
		console.log(`   Database: ${database}`);

		await db.connect(url);
		console.log("✅ Connected to SurrealDB");

		// Try to authenticate
		if (process.env.SURREAL_USERNAME && process.env.SURREAL_PASSWORD) {
			console.log("🔹 Authenticating with username/password...");
			await db.signin({
				username: process.env.SURREAL_USERNAME,
				password: process.env.SURREAL_PASSWORD,
			});
			console.log("✅ Authenticated");
		} else if (process.env.SURREAL_TOKEN) {
			console.log("🔹 Authenticating with token...");
			await db.authenticate(process.env.SURREAL_TOKEN);
			console.log("✅ Authenticated");
		} else {
			console.log("⚠️  No authentication provided");
		}

		// Use namespace and database
		await db.use(namespace, database);
		console.log("✅ Using namespace and database");

		// Test basic query
		console.log("🔹 Testing basic query...");
		const result = await db.query("SELECT * FROM messages LIMIT 5");
		console.log("✅ Query result:", result);

		// Count all messages
		console.log("🔹 Counting all messages...");
		const countResult = await db.query("SELECT count() FROM messages");
		console.log("✅ Message count:", countResult);

		// Check for target user messages
		console.log("🔹 Checking for target user messages...");
		const userMessages = await db.query(
			"SELECT * FROM messages WHERE author_id = $user_id LIMIT 10",
			{
				user_id: TARGET_USER_ID,
			},
		);
		console.log("✅ Target user messages:", userMessages);

		// List all tables
		console.log("🔹 Listing all tables...");
		const tables = await db.query("INFO FOR DB");
		console.log("✅ Database info:", tables);
	} catch (error) {
		console.error("❌ Direct connection failed:", error);
	} finally {
		await db.close();
		process.exit(0);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
