import { type Db, MongoClient, type MongoClientOptions } from "mongodb";
import { config } from "../../config";

let client: MongoClient | null = null;
let database: Db | null = null;
let isConnecting = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000; // 1 second

// Optimized connection options for production
const mongoOptions: MongoClientOptions = {
	maxPoolSize: 10, // Maintain up to 10 socket connections
	minPoolSize: 2, // Maintain a minimum of 2 socket connections
	maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
	serverSelectionTimeoutMS: 5000, // How long to try selecting a server
	socketTimeoutMS: 45000, // How long a send or receive on a socket can take
	connectTimeoutMS: 10000, // How long to wait for a connection to be established
	heartbeatFrequencyMS: 10000, // How often to ping
	retryWrites: true, // Retry writes that fail due to transient network errors
	retryReads: true, // Retry reads that fail due to transient network errors
};

export async function getDatabase(): Promise<Db> {
	if (database) {
		return database;
	}

	if (isConnecting) {
		// Wait for existing connection attempt
		await new Promise((resolve) => setTimeout(resolve, 100));
		return getDatabase();
	}

	if (!config.mongoUri) {
		throw new Error(
			"🔸 MongoDB URI is not configured. Please set MONGO_URI in your .env file.",
		);
	}

	isConnecting = true;

	try {
		client = new MongoClient(config.mongoUri, mongoOptions);
		await client.connect();
		database = client.db(config.dbName);

		// Test the connection with timeout
		await Promise.race([
			database.admin().ping(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Connection timeout")), 5000),
			),
		]);

		connectionRetries = 0; // Reset retry counter on successful connection
		return database;
	} catch (error) {
		connectionRetries++;
		console.error(
			`🔸 MongoDB connection failed (attempt ${connectionRetries}/${MAX_RETRIES}):`,
			error,
		);

		if (connectionRetries < MAX_RETRIES) {
			// Exponential backoff retry
			const delay = RETRY_DELAY * 2 ** (connectionRetries - 1);
			await new Promise((resolve) => setTimeout(resolve, delay));
			isConnecting = false;
			return getDatabase();
		}

		throw new Error(
			`🔸 Failed to connect to MongoDB after ${MAX_RETRIES} attempts: ${error}`,
		);
	} finally {
		isConnecting = false;
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
