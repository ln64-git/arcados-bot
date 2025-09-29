import { type Db, MongoClient } from "mongodb";
import { config } from "../config";

let client: MongoClient | null = null;
let database: Db | null = null;

export async function getDatabase(): Promise<Db> {
	if (database) {
		return database;
	}

	if (!config.mongoUri) {
		throw new Error(
			"🔸 MongoDB URI is not configured. Please set MONGO_URI in your .env file.",
		);
	}

	try {
		client = new MongoClient(config.mongoUri);
		await client.connect();
		database = client.db(config.dbName);

		// Test the connection
		await database.admin().ping();

		return database;
	} catch (error) {
		throw error;
	}
}

export async function closeDatabase(): Promise<void> {
	if (client) {
		try {
			await client.close();
		} catch (_error) {
			// Database connection may already be closed
		}
		client = null;
		database = null;
	}
}

// Graceful shutdown
process.on("SIGINT", async () => {
	await closeDatabase();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	await closeDatabase();
	process.exit(0);
});
