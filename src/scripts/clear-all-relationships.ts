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

interface ClearStats {
	total_members: number;
	members_with_relationships: number;
	members_cleared: number;
	total_relationships_cleared: number;
	errors: number;
}

async function clearAllRelationshipData(
	guildId?: string,
	confirm = false,
): Promise<ClearStats> {
	console.log("🔹 Clearing ALL relationship data from all users...");

	if (!process.env.POSTGRES_URL) {
		throw new Error("🔸 POSTGRES_URL not found in environment variables");
	}

	const db = new PostgreSQLManager();
	const stats: ClearStats = {
		total_members: 0,
		members_with_relationships: 0,
		members_cleared: 0,
		total_relationships_cleared: 0,
		errors: 0,
	};

	try {
		const connected = await db.connect();

		if (!connected) {
			throw new Error("🔸 Failed to connect to PostgreSQL");
		}

		console.log("✅ Connected to PostgreSQL");

		// Get all members (optionally filtered by guild)
		console.log("🔹 Retrieving members...");
		let membersQuery = `
			SELECT 
				user_id, 
				guild_id, 
				username, 
				display_name,
				relationship_network
			FROM members 
			WHERE relationship_network IS NOT NULL 
			AND jsonb_array_length(relationship_network) > 0
		`;

		const queryParams: string[] = [];
		if (guildId) {
			membersQuery += ` AND guild_id = $1`;
			queryParams.push(guildId);
		}

		membersQuery += ` ORDER BY guild_id, username`;

		const membersResult = await db.query(membersQuery, queryParams);

		if (!membersResult.success || !membersResult.data) {
			throw new Error(`🔸 Failed to get members: ${membersResult.error}`);
		}

		const members = membersResult.data;
		stats.total_members = members.length;
		stats.members_with_relationships = members.length;

		console.log(`✅ Found ${members.length} members with relationships`);

		if (members.length === 0) {
			console.log("🔹 No members with relationships found");
			await db.disconnect();
			return stats;
		}

		// Show preview of what will be cleared
		if (!confirm) {
			console.log("\n🔹 Preview of relationship data to be cleared:");
			console.log("-".repeat(60));

			let totalRelationships = 0;
			for (const member of members.slice(0, 5)) {
				// Show first 5 as preview
				const relationships = member.relationship_network || [];
				totalRelationships += relationships.length;
				console.log(`👤 ${member.display_name} (@${member.username})`);
				console.log(`   Guild: ${member.guild_id}`);
				console.log(`   Relationships: ${relationships.length}`);

				relationships.slice(0, 3).forEach((rel: any, index: number) => {
					console.log(
						`   ${index + 1}. User ${rel.user_id}: ${rel.affinity_percentage}% affinity, ${rel.interaction_count} interactions`,
					);
				});

				if (relationships.length > 3) {
					console.log(`   ... and ${relationships.length - 3} more`);
				}
				console.log("");
			}

			if (members.length > 5) {
				console.log(`... and ${members.length - 5} more members`);
			}

			// Calculate total relationships across all members
			const allMembersResult = await db.query(membersQuery, queryParams);
			if (allMembersResult.success && allMembersResult.data) {
				const totalAllRelationships = allMembersResult.data.reduce(
					(sum: number, member: any) => {
						return sum + (member.relationship_network?.length || 0);
					},
					0,
				);
				console.log(
					`\n📊 Total relationships to be cleared: ${totalAllRelationships}`,
				);
			}

			console.log("\n⚠️  This will COMPLETELY CLEAR all relationship data");
			console.log(
				"⚠️  This includes affinity_percentage, interaction_count, last_interaction, and all metadata",
			);
			console.log(
				"⚠️  User profiles (summary, keywords, emojis) will be preserved",
			);
			console.log("\nTo proceed, run with --confirm flag");
			console.log("Example: npx tsx clear-all-relationships.ts --confirm");
			if (guildId) {
				console.log(
					`Example: npx tsx clear-all-relationships.ts ${guildId} --confirm`,
				);
			}

			await db.disconnect();
			return stats;
		}

		// Process each member - completely clear relationship_network
		console.log("\n🔹 Clearing all relationship data...");
		let processedCount = 0;

		for (const member of members) {
			try {
				const relationships = member.relationship_network || [];
				const relationshipCount = relationships.length;

				// Clear the entire relationship_network field
				const updateResult = await db.query(
					`
					UPDATE members 
					SET 
						relationship_network = '[]',
						updated_at = NOW()
					WHERE user_id = $1 AND guild_id = $2
				`,
					[member.user_id, member.guild_id],
				);

				if (updateResult.success) {
					stats.members_cleared++;
					stats.total_relationships_cleared += relationshipCount;

					if (relationshipCount > 0) {
						console.log(
							`✅ ${member.display_name}: cleared ${relationshipCount} relationships`,
						);
					}
				} else {
					console.log(
						`🔸 Failed to update ${member.display_name}: ${updateResult.error}`,
					);
					stats.errors++;
				}

				processedCount++;

				// Progress indicator
				if (processedCount % 10 === 0) {
					console.log(
						`🔹 Progress: ${processedCount}/${members.length} members processed`,
					);
				}
			} catch (error) {
				console.log(`🔸 Error processing ${member.display_name}: ${error}`);
				stats.errors++;
			}
		}

		console.log("\n✅ All relationship data clearing completed!");
		await db.disconnect();
	} catch (error) {
		console.error("🔸 Error clearing relationship data:", error);
		throw error;
	}

	return stats;
}

async function regenerateRelationshipNetworks(guildId?: string): Promise<void> {
	console.log("\n🔹 Regenerating relationship networks...");

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

		// Get all members in the guild
		let membersQuery = `SELECT user_id, username, display_name FROM members WHERE active = true`;
		const queryParams: string[] = [];

		if (guildId) {
			membersQuery += ` AND guild_id = $1`;
			queryParams.push(guildId);
		}

		membersQuery += ` ORDER BY username`;

		const membersResult = await db.query(membersQuery, queryParams);

		if (!membersResult.success || !membersResult.data) {
			throw new Error(`🔸 Failed to get members: ${membersResult.error}`);
		}

		const members = membersResult.data;
		console.log(`✅ Found ${members.length} members to process`);

		// Process each member
		let processedMembers = 0;
		for (const member of members) {
			const userId = member.user_id;
			console.log(`🔹 Processing relationships for ${member.username}...`);

			// Get message interactions for this user
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
				[guildId || "1254694808228986912", userId],
			);

			// Build relationship network
			if (!interactionsResult.success || !interactionsResult.data) {
				console.log(`🔸 Failed to get interactions for ${member.username}`);
				continue;
			}

			const relationships = interactionsResult.data.map((row) => ({
				user_id: row.interacted_with,
				affinity_percentage: Math.min(row.affinity_percentage, 100),
				interaction_count: row.interaction_count,
				last_interaction: new Date(row.last_interaction),
			}));

			// Update the member's relationship network
			const updateResult = await db.query(
				`
				UPDATE members 
				SET 
					relationship_network = $1,
					updated_at = NOW()
				WHERE user_id = $2 AND guild_id = $3
			`,
				[
					JSON.stringify(relationships),
					userId,
					guildId || "1254694808228986912",
				],
			);

			if (updateResult.success) {
				console.log(
					`✅ ${member.username}: generated ${relationships.length} relationships`,
				);
			} else {
				console.log(
					`🔸 Failed to update ${member.username}: ${updateResult.error}`,
				);
			}

			processedMembers++;

			// Progress indicator
			if (processedMembers % 10 === 0) {
				console.log(
					`🔹 Progress: ${processedMembers}/${members.length} members processed`,
				);
			}
		}

		console.log(
			`\n✅ Relationship networks regenerated for ${processedMembers} members`,
		);
		await db.disconnect();
	} catch (error) {
		console.error("🔸 Error regenerating relationship networks:", error);
		throw error;
	}
}

function printStats(stats: ClearStats): void {
	console.log("\n🔹 Clearing Statistics");
	console.log("=".repeat(40));
	console.log(`👥 Total members processed: ${stats.total_members}`);
	console.log(
		`🔗 Members with relationships: ${stats.members_with_relationships}`,
	);
	console.log(`✅ Members cleared successfully: ${stats.members_cleared}`);
	console.log(
		`🧹 Total relationship entries cleared: ${stats.total_relationships_cleared}`,
	);
	console.log(`🔸 Errors encountered: ${stats.errors}`);

	if (stats.errors > 0) {
		console.log(
			"\n⚠️  Some errors occurred during processing. Check the logs above for details.",
		);
	}
}

async function main() {
	const args = process.argv.slice(2);

	let guildId: string | undefined;
	let confirm = false;
	let regenerate = false;

	// Parse arguments
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--confirm") {
			confirm = true;
		} else if (arg === "--regenerate") {
			regenerate = true;
		} else if (arg === "--help" || arg === "-h") {
			console.log("Usage:");
			console.log(
				"  npx tsx clear-all-relationships.ts [guild-id] [--confirm] [--regenerate]",
			);
			console.log("");
			console.log("Arguments:");
			console.log(
				"  guild-id      Optional guild ID to limit clearing to specific guild",
			);
			console.log(
				"  --confirm     Required to actually perform the clearing operation",
			);
			console.log(
				"  --regenerate  Regenerate relationship networks after clearing",
			);
			console.log("");
			console.log("Examples:");
			console.log(
				"  npx tsx clear-all-relationships.ts                    # Preview all guilds",
			);
			console.log(
				"  npx tsx clear-all-relationships.ts --confirm          # Clear all guilds",
			);
			console.log(
				"  npx tsx clear-all-relationships.ts --confirm --regenerate # Clear and regenerate",
			);
			console.log(
				"  npx tsx clear-all-relationships.ts 123456789 --confirm # Clear specific guild",
			);
			console.log("");
			console.log(
				"This script COMPLETELY CLEARS all relationship data including:",
			);
			console.log("- affinity_percentage");
			console.log("- interaction_count");
			console.log("- last_interaction");
			console.log("- summary, keywords, emojis, notes");
			console.log("");
			console.log("User profiles (summary, keywords, emojis) are preserved.");
			process.exit(0);
		} else if (!arg.startsWith("--")) {
			// Assume it's a guild ID
			guildId = arg;
		}
	}

	try {
		const stats = await clearAllRelationshipData(guildId, confirm);
		printStats(stats);

		if (!confirm) {
			console.log(
				"\n💡 Run with --confirm to actually perform the clearing operation",
			);
		} else {
			console.log("\n✅ Relationship data clearing completed successfully!");

			if (regenerate) {
				await regenerateRelationshipNetworks(guildId);
			}
		}
	} catch (error) {
		console.error("🔸 Script failed:", error);
		process.exit(1);
	}
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

export { clearAllRelationshipData, regenerateRelationshipNetworks, printStats };
