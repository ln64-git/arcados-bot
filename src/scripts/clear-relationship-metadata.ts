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

interface ClearStats {
	total_members: number;
	members_with_relationships: number;
	total_relationships_cleared: number;
	members_updated: number;
	errors: number;
}

async function clearRelationshipMetadata(guildId?: string, confirm = false): Promise<ClearStats> {
	console.log("🔹 Clearing relationship metadata (summary, keywords, emojis) from all users...");
	
	if (!process.env.POSTGRES_URL) {
		throw new Error("🔸 POSTGRES_URL not found in environment variables");
	}

	const db = new PostgreSQLManager();
	const stats: ClearStats = {
		total_members: 0,
		members_with_relationships: 0,
		total_relationships_cleared: 0,
		members_updated: 0,
		errors: 0
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
			console.log("\n🔹 Preview of relationship metadata to be cleared:");
			console.log("-".repeat(60));
			
			let previewCount = 0;
			for (const member of members.slice(0, 5)) { // Show first 5 as preview
				const relationships = member.relationship_network || [];
				console.log(`👤 ${member.display_name} (@${member.username})`);
				console.log(`   Guild: ${member.guild_id}`);
				console.log(`   Relationships: ${relationships.length}`);
				
				relationships.slice(0, 3).forEach((rel: any, index: number) => {
					const hasMetadata = rel.summary || (rel.keywords && rel.keywords.length > 0) || (rel.emojis && rel.emojis.length > 0);
					console.log(`   ${index + 1}. User ${rel.user_id}: ${hasMetadata ? 'Has metadata' : 'No metadata'}`);
				});
				
				if (relationships.length > 3) {
					console.log(`   ... and ${relationships.length - 3} more`);
				}
				console.log("");
				previewCount++;
			}
			
			if (members.length > 5) {
				console.log(`... and ${members.length - 5} more members`);
			}
			
			console.log("\n⚠️  This will clear summary, keywords, and emojis from ALL relationship entries");
			console.log("⚠️  The relationship data (affinity_percentage, interaction_count, last_interaction) will be preserved");
			console.log("\nTo proceed, run with --confirm flag");
			console.log("Example: npx tsx clear-relationship-metadata.ts --confirm");
			if (guildId) {
				console.log(`Example: npx tsx clear-relationship-metadata.ts ${guildId} --confirm`);
			}
			
			await db.disconnect();
			return stats;
		}

		// Process each member
		console.log("\n🔹 Clearing relationship metadata...");
		let processedCount = 0;
		
		for (const member of members) {
			try {
				const relationships = member.relationship_network || [];
				let relationshipsCleared = 0;
				
				// Clear metadata from each relationship entry
				const cleanedRelationships = relationships.map((rel: any) => {
					const hasMetadata = rel.summary || (rel.keywords && rel.keywords.length > 0) || (rel.emojis && rel.emojis.length > 0);
					
					if (hasMetadata) {
						relationshipsCleared++;
					}
					
					// Return relationship with metadata cleared but core data preserved
					return {
						user_id: rel.user_id,
						affinity_percentage: rel.affinity_percentage,
						interaction_count: rel.interaction_count,
						last_interaction: rel.last_interaction,
						notes: rel.notes || [] // Keep notes as they might be manually added
					};
				});
				
				// Update the member's relationship network
				const updateResult = await db.query(`
					UPDATE members 
					SET 
						relationship_network = $1,
						updated_at = NOW()
					WHERE user_id = $2 AND guild_id = $3
				`, [JSON.stringify(cleanedRelationships), member.user_id, member.guild_id]);
				
				if (updateResult.success) {
					stats.members_updated++;
					stats.total_relationships_cleared += relationshipsCleared;
					
					if (relationshipsCleared > 0) {
						console.log(`✅ ${member.display_name}: cleared ${relationshipsCleared}/${relationships.length} relationships`);
					}
				} else {
					console.log(`🔸 Failed to update ${member.display_name}: ${updateResult.error}`);
					stats.errors++;
				}
				
				processedCount++;
				
				// Progress indicator
				if (processedCount % 10 === 0) {
					console.log(`🔹 Progress: ${processedCount}/${members.length} members processed`);
				}
				
			} catch (error) {
				console.log(`🔸 Error processing ${member.display_name}: ${error}`);
				stats.errors++;
			}
		}

		console.log("\n✅ Relationship metadata clearing completed!");
		await db.disconnect();
		
	} catch (error) {
		console.error("🔸 Error clearing relationship metadata:", error);
		throw error;
	}
	
	return stats;
}

function printStats(stats: ClearStats): void {
	console.log("\n🔹 Clearing Statistics");
	console.log("=".repeat(40));
	console.log(`👥 Total members processed: ${stats.total_members}`);
	console.log(`🔗 Members with relationships: ${stats.members_with_relationships}`);
	console.log(`✅ Members updated successfully: ${stats.members_updated}`);
	console.log(`🧹 Total relationship entries cleared: ${stats.total_relationships_cleared}`);
	console.log(`🔸 Errors encountered: ${stats.errors}`);
	
	if (stats.errors > 0) {
		console.log("\n⚠️  Some errors occurred during processing. Check the logs above for details.");
	}
}

async function main() {
	const args = process.argv.slice(2);
	
	let guildId: string | undefined;
	let confirm = false;
	
	// Parse arguments
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		
		if (arg === '--confirm') {
			confirm = true;
		} else if (arg === '--help' || arg === '-h') {
			console.log("Usage:");
			console.log("  npx tsx clear-relationship-metadata.ts [guild-id] [--confirm]");
			console.log("");
			console.log("Arguments:");
			console.log("  guild-id    Optional guild ID to limit clearing to specific guild");
			console.log("  --confirm   Required to actually perform the clearing operation");
			console.log("");
			console.log("Examples:");
			console.log("  npx tsx clear-relationship-metadata.ts                    # Preview all guilds");
			console.log("  npx tsx clear-relationship-metadata.ts --confirm          # Clear all guilds");
			console.log("  npx tsx clear-relationship-metadata.ts 123456789 --confirm # Clear specific guild");
			console.log("");
			console.log("This script clears summary, keywords, and emojis from relationship entries");
			console.log("while preserving affinity_percentage, interaction_count, last_interaction, and notes.");
			process.exit(0);
		} else if (!arg.startsWith('--')) {
			// Assume it's a guild ID
			guildId = arg;
		}
	}
	
	try {
		const stats = await clearRelationshipMetadata(guildId, confirm);
		printStats(stats);
		
		if (!confirm) {
			console.log("\n💡 Run with --confirm to actually perform the clearing operation");
		} else {
			console.log("\n✅ Relationship metadata clearing completed successfully!");
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

export { clearRelationshipMetadata, printStats };
