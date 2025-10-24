#!/usr/bin/env npx tsx

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { PostgreSQLManager } from "../database/PostgreSQLManager.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function checkStoredRelationships(userId: string, guildId: string) {
	console.log(
		`🔹 Checking stored relationships for user ${userId} in guild ${guildId}...`,
	);

	if (!process.env.POSTGRES_URL) {
		throw new Error("🔸 POSTGRES_URL not found in environment variables");
	}

	const db = new PostgreSQLManager();

	try {
		const connected = await db.connect();

		if (!connected) {
			throw new Error("🔸 Failed to connect to PostgreSQL");
		}

		console.log("✅ Connected to PostgreSQL");

		// Check what's actually stored in the database
		const storedResult = await db.query(
			`
			SELECT 
				user_id,
				username,
				display_name,
				relationship_network
			FROM members 
			WHERE user_id = $1 AND guild_id = $2
		`,
			[userId, guildId],
		);

		if (
			storedResult.success &&
			storedResult.data &&
			storedResult.data.length > 0
		) {
			const member = storedResult.data[0];
			console.log(
				`✅ Found member: ${member.display_name} (@${member.username})`,
			);
			console.log(`🔹 Stored relationship_network:`);
			console.log(JSON.stringify(member.relationship_network, null, 2));

			// Parse and show each relationship
			if (
				member.relationship_network &&
				Array.isArray(member.relationship_network)
			) {
				console.log(
					`\n🔹 Parsed relationships (${member.relationship_network.length} total):`,
				);
				member.relationship_network.forEach((rel, index) => {
					console.log(`   ${index + 1}. User ID: ${rel.user_id}`);
					console.log(`      Affinity: ${rel.affinity_percentage}%`);
					console.log(`      Interactions: ${rel.interaction_count}`);
					console.log(`      Last Interaction: ${rel.last_interaction}`);
					console.log("");
				});
			}
		} else {
			console.log("🔸 No member found");
		}

		await db.disconnect();
	} catch (error) {
		console.error("🔸 Error checking stored relationships:", error);
		throw error;
	}
}

async function main() {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.log("Usage:");
		console.log("  npx tsx check-stored-relationships.ts <user-id> <guild-id>");
		console.log("");
		console.log("Example:");
		console.log(
			"  npx tsx check-stored-relationships.ts 354823920010002432 1254694808228986912",
		);
		process.exit(1);
	}

	const userId = args[0];
	const guildId = args[1];

	try {
		await checkStoredRelationships(userId, guildId);
		console.log("\n✅ Check completed!");
	} catch (error) {
		console.error("🔸 Script failed:", error);
		process.exit(1);
	}
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
