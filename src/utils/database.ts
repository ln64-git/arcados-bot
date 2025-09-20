import { Db, MongoClient } from "mongodb";

let db: Db;

export async function getDatabase(): Promise<Db> {
    if (!db) {
        const mongoClient = new MongoClient(
            process.env.MONGO_URI || "mongodb://localhost:27017",
        );
        try {
            await mongoClient.connect();
            console.log("Connected to MongoDB.");
            db = mongoClient.db("discordData");
        } catch (error) {
            console.error("Error connecting to MongoDB:", error);
            process.exit(1);
        }
    }
    return db;
}
