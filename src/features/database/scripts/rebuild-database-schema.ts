import * as dotenv from "dotenv";
import { SurrealDBManager } from "../database/SurrealDBManager";

dotenv.config();

async function rebuildDatabaseSchema() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		console.log(
			"🔸 Rebuilding database schema with consistent snake_case naming...",
		);

		// Step 1: Check current state
		console.log("🔹 Step 1: Checking current database state...");
		const tables = [
			"guilds",
			"channels",
			"members",
			"roles",
			"messages",
			"actions",
			"sync_metadata",
		];

		for (const table of tables) {
			try {
				const tableInfo = await db.db.query(`INFO FOR TABLE ${table}`);
				console.log(`🔹 ${table} info:`, JSON.stringify(tableInfo, null, 2));
			} catch (error) {
				console.log(`🔸 Error checking table ${table}:`, error.message);
			}
		}

		// Step 2: Create tables if they don't exist
		console.log("🔹 Step 2: Creating tables...");
		const createTableQueries = [
			"DEFINE TABLE guilds SCHEMAFULL;",
			"DEFINE TABLE channels SCHEMAFULL;",
			"DEFINE TABLE members SCHEMAFULL;",
			"DEFINE TABLE roles SCHEMAFULL;",
			"DEFINE TABLE messages SCHEMAFULL;",
			"DEFINE TABLE actions SCHEMAFULL;",
			"DEFINE TABLE sync_metadata SCHEMAFULL;",
		];

		for (const query of createTableQueries) {
			try {
				await db.db.query(query);
				console.log(`🔹 Executed: ${query}`);
			} catch (error) {
				console.log(`🔸 Error executing "${query}":`, error.message);
			}
		}

		// Step 3: Define fields for messages table (most important for our testing)
		console.log("🔹 Step 3: Defining message fields...");
		const messageFields = [
			"DEFINE FIELD id ON messages TYPE string;",
			"DEFINE FIELD channel_id ON messages TYPE string;",
			"DEFINE FIELD guild_id ON messages TYPE string;",
			"DEFINE FIELD author_id ON messages TYPE string;",
			"DEFINE FIELD content ON messages TYPE string;",
			"DEFINE FIELD timestamp ON messages TYPE datetime;",
			"DEFINE FIELD attachments ON messages TYPE array<object> DEFAULT [];",
			"DEFINE FIELD embeds ON messages TYPE array<object> DEFAULT [];",
			"DEFINE FIELD created_at ON messages TYPE datetime;",
			"DEFINE FIELD updated_at ON messages TYPE datetime;",
			"DEFINE FIELD active ON messages TYPE bool DEFAULT true;",
		];

		for (const query of messageFields) {
			try {
				await db.db.query(query);
				console.log(`🔹 Executed: ${query}`);
			} catch (error) {
				console.log(`🔸 Error executing "${query}":`, error.message);
			}
		}

		// Step 4: Create message indexes
		console.log("🔹 Step 4: Creating message indexes...");
		const messageIndexes = [
			"DEFINE INDEX idx_messages_guild_author ON messages FIELDS guild_id, author_id;",
			"DEFINE INDEX idx_messages_guild_timestamp ON messages FIELDS guild_id, timestamp;",
			"DEFINE INDEX idx_messages_channel_timestamp ON messages FIELDS channel_id, timestamp;",
		];

		for (const query of messageIndexes) {
			try {
				await db.db.query(query);
				console.log(`🔹 Executed: ${query}`);
			} catch (error) {
				console.log(`🔸 Error executing "${query}":`, error.message);
			}
		}

		// Step 5: Verify messages table
		console.log("🔹 Step 5: Verifying messages table...");
		try {
			const tableInfo = await db.db.query(`INFO FOR TABLE messages`);
			console.log(
				`🔹 Messages table info:`,
				JSON.stringify(tableInfo, null, 2),
			);
		} catch (error) {
			console.log(`🔸 Error verifying messages table:`, error.message);
		}

		console.log("🔹 Database schema rebuild completed!");
	} catch (error) {
		console.error("🔸 Error during schema rebuild:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected");
	}
}

rebuildDatabaseSchema().catch(console.error);
