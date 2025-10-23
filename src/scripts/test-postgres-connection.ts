#!/usr/bin/env npx tsx

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { PostgreSQLManager } from "../database/PostgreSQLManager.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function testPostgreSQLConnection() {
	console.log("🔹 Testing PostgreSQL connection...");

	if (!process.env.POSTGRES_URL) {
		console.error("🔸 POSTGRES_URL not found in environment variables");
		console.error("🔸 Please add POSTGRES_URL to your .env file");
		process.exit(1);
	}

	console.log(`🔹 PostgreSQL URL: ${process.env.POSTGRES_URL.substring(0, 20)}...`);

	const db = new PostgreSQLManager();
	
	try {
		const connected = await db.connect();
		
		if (connected) {
			console.log("✅ Successfully connected to PostgreSQL!");
			
			// Test a simple query
			console.log("🔹 Testing database query...");
			const result = await db.query("SELECT version()");
			
			if (result.success && result.data) {
				console.log("✅ Database query successful!");
				console.log(`🔹 PostgreSQL version: ${result.data[0].version}`);
			} else {
				console.error("🔸 Database query failed:", result.error);
			}
			
			// Test schema initialization
			console.log("🔹 Testing schema initialization...");
			await db.disconnect();
			await db.connect(); // This will trigger schema initialization
			console.log("✅ Schema initialization completed!");
			
		} else {
			console.error("🔸 Failed to connect to PostgreSQL");
			process.exit(1);
		}
		
		await db.disconnect();
		console.log("✅ Connection test completed successfully!");
		
	} catch (error) {
		console.error("🔸 Error testing PostgreSQL connection:", error);
		process.exit(1);
	}
}

testPostgreSQLConnection().catch((error) => {
	console.error("🔸 Unhandled error:", error);
	process.exit(1);
});
