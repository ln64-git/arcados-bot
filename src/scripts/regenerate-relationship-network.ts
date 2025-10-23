#!/usr/bin/env npx tsx

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { PostgreSQLManager, RelationshipEntry } from "../database/PostgreSQLManager.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function regenerateRelationshipNetwork() {
	console.log("🔹 Regenerating relationship network from message interactions...");

	if (!process.env.POSTGRES_URL) {
		console.error("🔸 POSTGRES_URL not found in environment variables");
		process.exit(1);
	}

	const db = new PostgreSQLManager();
	
	try {
		const connected = await db.connect();
		
		if (!connected) {
			console.error("🔸 Failed to connect to PostgreSQL");
			process.exit(1);
		}

		console.log("✅ Connected to PostgreSQL");

		const guildId = '1254694808228986912';

		// Get all members in the guild
		console.log("🔹 Fetching all members...");
		const membersResult = await db.query(`
			SELECT user_id, username, display_name 
			FROM members 
			WHERE guild_id = $1 AND active = true
		`, [guildId]);

		if (!membersResult.success || !membersResult.data || !membersResult.data.length) {
			console.log("🔸 No members found in guild");
			await db.disconnect();
			return;
		}

		console.log(`✅ Found ${membersResult.data.length} members`);

		// Process each member
		let processedMembers = 0;
		for (const member of membersResult.data) {
			const userId = member.user_id;
			console.log(`🔹 Processing relationships for ${member.username}...`);

			// Get message interactions for this user
			const interactionsResult = await db.query(`
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
			`, [guildId, userId]);

			// Build relationship network
			if (!interactionsResult.success || !interactionsResult.data) {
				console.log(`🔸 Failed to get interactions for ${member.username}`);
				continue;
			}

			const relationships: RelationshipEntry[] = interactionsResult.data.map(row => ({
				user_id: row.interacted_with,
				affinity_percentage: Math.min(row.affinity_percentage, 100),
				interaction_count: row.interaction_count,
				last_interaction: new Date(row.last_interaction),
				summary: undefined,
				keywords: [],
				emojis: [],
				notes: []
			}));

			// Update the member's relationship network
			if (relationships.length > 0) {
				const memberId = `${guildId}-${userId}`;
				const updateResult = await db.updateMemberRelationshipNetwork(memberId, relationships);
				
				if (updateResult.success) {
					console.log(`✅ Updated ${relationships.length} relationships for ${member.username}`);
				} else {
					console.error(`🔸 Failed to update relationships for ${member.username}: ${updateResult.error}`);
				}
			} else {
				console.log(`🔹 No significant relationships found for ${member.username}`);
			}

			processedMembers++;
			
			// Progress indicator
			if (processedMembers % 50 === 0) {
				console.log(`🔹 Processed ${processedMembers}/${membersResult.data.length} members...`);
			}
		}

		console.log(`✅ Relationship network regeneration completed for ${processedMembers} members`);
		
		await db.disconnect();
		
	} catch (error) {
		console.error("🔸 Error regenerating relationship network:", error);
		process.exit(1);
	}
}

regenerateRelationshipNetwork().catch((error) => {
	console.error("🔸 Unhandled error:", error);
	process.exit(1);
});
