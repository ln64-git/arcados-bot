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

async function debugRelationshipQuery(userId: string, guildId: string) {
	console.log(
		`🔹 Debugging relationship query for user ${userId} in guild ${guildId}...`,
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

		// First, let's see what messages this user has
		console.log("🔹 Checking user's messages...");
		const userMessagesResult = await db.query(
			`
			SELECT 
				author_id,
				channel_id,
				created_at,
				content
			FROM messages 
			WHERE guild_id = $1 
				AND author_id = $2
				AND active = true
			ORDER BY created_at DESC
			LIMIT 10
		`,
			[guildId, userId],
		);

		if (userMessagesResult.success && userMessagesResult.data) {
			console.log(
				`✅ Found ${userMessagesResult.data.length} messages from this user`,
			);
			userMessagesResult.data.forEach((msg, index) => {
				console.log(
					`   ${index + 1}. ${msg.created_at}: ${msg.content.substring(0, 50)}...`,
				);
			});
		}

		// Now let's see what the interaction query returns
		console.log("\n🔹 Testing interaction query...");
		const interactionsResult = await db.query(
			`
			WITH user_messages AS (
				SELECT 
					m1.author_id,
					m2.author_id as interacted_with,
					COUNT(*) as interaction_count,
					MAX(m1.created_at) as last_interaction
				FROM messages m1
				JOIN messages m2 ON m1.channel_id = m2.channel_id 
					AND m1.created_at BETWEEN m2.created_at - INTERVAL '1 hour' 
					AND m2.created_at + INTERVAL '1 hour'
					AND m1.author_id != m2.author_id
				WHERE m1.guild_id = $1 
					AND m1.author_id = $2
					AND m1.active = true 
					AND m2.active = true
				GROUP BY m1.author_id, m2.author_id
			),
			total_interactions AS (
				SELECT SUM(interaction_count) as total
				FROM user_messages
			)
			SELECT 
				um.interacted_with,
				um.interaction_count,
				um.last_interaction,
				CASE 
					WHEN ti.total > 0 THEN ROUND((um.interaction_count::float / ti.total) * 100)
					ELSE 0 
				END as affinity_percentage
			FROM user_messages um
			CROSS JOIN total_interactions ti
			WHERE um.interaction_count >= 3
			ORDER BY um.interaction_count DESC
			LIMIT 20
		`,
			[guildId, userId],
		);

		if (interactionsResult.success && interactionsResult.data) {
			console.log(
				`✅ Interaction query returned ${interactionsResult.data.length} results`,
			);
			interactionsResult.data.forEach((rel, index) => {
				console.log(
					`   ${index + 1}. User ${rel.interacted_with}: ${rel.interaction_count} interactions, ${rel.affinity_percentage}% affinity`,
				);
			});
		} else {
			console.log(`🔸 Interaction query failed: ${interactionsResult.error}`);
		}

		// Let's also check what users exist in the guild
		console.log("\n🔹 Checking guild members...");
		const membersResult = await db.query(
			`
			SELECT user_id, username, display_name
			FROM members 
			WHERE guild_id = $1 AND active = true
			ORDER BY username
			LIMIT 10
		`,
			[guildId],
		);

		if (membersResult.success && membersResult.data) {
			console.log(`✅ Found ${membersResult.data.length} members in guild`);
			membersResult.data.forEach((member, index) => {
				console.log(
					`   ${index + 1}. ${member.display_name} (@${member.username}) - ${member.user_id}`,
				);
			});
		}

		await db.disconnect();
	} catch (error) {
		console.error("🔸 Error debugging relationship query:", error);
		throw error;
	}
}

async function main() {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.log("Usage:");
		console.log("  npx tsx debug-relationship-query.ts <user-id> <guild-id>");
		console.log("");
		console.log("Example:");
		console.log(
			"  npx tsx debug-relationship-query.ts 354823920010002432 1254694808228986912",
		);
		process.exit(1);
	}

	const userId = args[0];
	const guildId = args[1];

	try {
		await debugRelationshipQuery(userId, guildId);
		console.log("\n✅ Debug completed!");
	} catch (error) {
		console.error("🔸 Script failed:", error);
		process.exit(1);
	}
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
