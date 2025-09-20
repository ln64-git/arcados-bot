import { Db, MongoClient } from "mongodb";
import { config } from "../config";

let client: MongoClient | null = null;
let database: Db | null = null;

export async function getDatabase(): Promise<Db> {
    if (database) {
        return database;
    }

    if (!config.mongoUri) {
        throw new Error("🔸 MongoDB URI is not configured. Please set MONGO_URI in your .env file.");
    }

    try {
        console.log("🔹 Connecting to MongoDB...");
        client = new MongoClient(config.mongoUri);
        await client.connect();
        database = client.db(config.dbName);

        // Test the connection
        await database.admin().ping();
        console.log("🔹 Successfully connected to MongoDB");

        return database;
    } catch (error) {
        console.error("🔸 Failed to connect to MongoDB:", error);
        throw error;
    }
}

export async function closeDatabase(): Promise<void> {
    if (client) {
        try {
            await client.close();
            console.log("🔹 MongoDB connection closed");
        } catch (error) {
            console.error("🔸 Error closing MongoDB connection:", error);
        }
        client = null;
        database = null;
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    await closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeDatabase();
    process.exit(0);
});
