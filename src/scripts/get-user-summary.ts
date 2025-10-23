#!/usr/bin/env npx tsx

import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { PostgreSQLManager } from "../database/PostgreSQLManager.js";
import type { MemberData, RelationshipEntry } from "../database/PostgreSQLManager.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface UserSummaryResult {
	user: {
		id: string;
		username: string;
		display_name: string;
		global_name?: string;
		summary?: string;
		keywords?: string[];
		emojis?: string[];
		notes?: string[];
		joined_at: Date;
		roles: string[];
	};
	relationships: Array<{
		user_id: string;
		username: string;
		display_name: string;
		affinity_percentage: number;
		interaction_count: number;
		last_interaction: Date;
		summary?: string;
		keywords?: string[];
		emojis?: string[];
		notes?: string[];
	}>;
	total_relationships: number;
	retrieved_at: Date;
}

async function getUserSummary(userId: string, guildId: string): Promise<UserSummaryResult> {
	console.log(`🔹 Getting user summary for ${userId} in guild ${guildId}...`);

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

		// Get user data
		console.log("🔹 Retrieving user data...");
		const userResult = await db.query(`
			SELECT 
				user_id,
				username,
				display_name,
				global_name,
				summary,
				keywords,
				emojis,
				notes,
				joined_at,
				roles
			FROM members 
			WHERE user_id = $1 AND guild_id = $2
		`, [userId, guildId]);

		if (!userResult.success || !userResult.data || userResult.data.length === 0) {
			throw new Error(`🔸 User ${userId} not found in guild ${guildId}`);
		}

		const userData = userResult.data[0];
		console.log(`✅ Found user: ${userData.username}`);

		// Get user's relationships with metadata
		console.log("🔹 Retrieving user relationships...");
		const relationshipsResult = await db.query(`
			SELECT 
				rn.user_id,
				rn.affinity_percentage,
				rn.interaction_count,
				rn.last_interaction,
				rn.summary as relationship_summary,
				rn.keywords as relationship_keywords,
				rn.emojis as relationship_emojis,
				rn.notes as relationship_notes,
				rel_member.username,
				rel_member.display_name,
				rel_member.summary,
				rel_member.keywords,
				rel_member.emojis,
				rel_member.notes
			FROM members m
			CROSS JOIN LATERAL (
				SELECT 
					jsonb_array_elements(relationship_network) as rel
			) rn_expanded
			CROSS JOIN LATERAL (
				SELECT 
					(rel->>'user_id')::text as user_id,
					(rel->>'affinity_percentage')::float as affinity_percentage,
					(rel->>'interaction_count')::int as interaction_count,
					(rel->>'last_interaction')::timestamp as last_interaction,
					rel->>'summary' as summary,
					rel->'keywords' as keywords,
					rel->'emojis' as emojis,
					rel->'notes' as notes
			) rn
			LEFT JOIN members rel_member ON rel_member.user_id = rn.user_id AND rel_member.guild_id = m.guild_id
			WHERE m.user_id = $1 AND m.guild_id = $2
			ORDER BY rn.affinity_percentage DESC
			LIMIT 50
		`, [userId, guildId]);

		if (!relationshipsResult.success) {
			throw new Error(`🔸 Failed to get relationships: ${relationshipsResult.error}`);
		}

		const relationships = relationshipsResult.data || [];
		console.log(`✅ Found ${relationships.length} relationships`);

		// Format the result
		const result: UserSummaryResult = {
			user: {
				id: userData.user_id,
				username: userData.username,
				display_name: userData.display_name,
				global_name: userData.global_name,
				summary: userData.summary,
				keywords: userData.keywords || [],
				emojis: userData.emojis || [],
				notes: userData.notes || [],
				joined_at: new Date(userData.joined_at),
				roles: userData.roles || []
			},
			relationships: relationships.map(rel => ({
				user_id: rel.user_id,
				username: rel.username,
				display_name: rel.display_name,
				affinity_percentage: rel.affinity_percentage,
				interaction_count: rel.interaction_count,
				last_interaction: new Date(rel.last_interaction),
				summary: rel.relationship_summary || undefined,
				keywords: rel.relationship_keywords || [],
				emojis: rel.relationship_emojis || [],
				notes: rel.relationship_notes || []
			})),
			total_relationships: relationships.length,
			retrieved_at: new Date()
		};

		await db.disconnect();
		return result;
		
	} catch (error) {
		console.error("🔸 Error getting user summary:", error);
		throw error;
	}
}

function formatUserSummary(summary: UserSummaryResult): void {
	console.log("\n🔹 User Summary Report");
	console.log("=".repeat(60));
	
	// User basic info
	console.log(`👤 User: ${summary.user.display_name} (@${summary.user.username})`);
	if (summary.user.global_name) {
		console.log(`🌐 Global Name: ${summary.user.global_name}`);
	}
	console.log(`🆔 User ID: ${summary.user.id}`);
	console.log(`📅 Joined: ${summary.user.joined_at.toISOString().split('T')[0]}`);
	console.log(`🎭 Roles: ${summary.user.roles.length} roles`);
	
	// User metadata
	console.log("\n📝 User Metadata:");
	if (summary.user.summary) {
		console.log(`   Summary: ${summary.user.summary}`);
	} else {
		console.log("   Summary: Not available");
	}
	
	if (summary.user.keywords && summary.user.keywords.length > 0) {
		console.log(`   Keywords: ${summary.user.keywords.join(', ')}`);
	} else {
		console.log("   Keywords: Not available");
	}
	
	if (summary.user.emojis && summary.user.emojis.length > 0) {
		console.log(`   Emojis: ${summary.user.emojis.join(' ')}`);
	} else {
		console.log("   Emojis: Not available");
	}
	
	if (summary.user.notes && summary.user.notes.length > 0) {
		console.log(`   Notes: ${summary.user.notes.join(', ')}`);
	} else {
		console.log("   Notes: Not available");
	}
	
	// Relationships
	console.log(`\n🔗 Relationships (${summary.total_relationships} total):`);
	console.log("-".repeat(60));
	
	if (summary.relationships.length === 0) {
		console.log("   No relationships found");
	} else {
		summary.relationships.forEach((rel, index) => {
			console.log(`\n${index + 1}. ${rel.display_name} (@${rel.username})`);
			console.log(`   🆔 User ID: ${rel.user_id}`);
			console.log(`   📊 Affinity: ${rel.affinity_percentage.toFixed(1)}%`);
			console.log(`   💬 Interactions: ${rel.interaction_count}`);
			console.log(`   🕒 Last Interaction: ${rel.last_interaction.toISOString().split('T')[0]}`);
			
			if (rel.summary) {
				console.log(`   📝 Summary: ${rel.summary}`);
			}
			
			if (rel.keywords && rel.keywords.length > 0) {
				console.log(`   🏷️ Keywords: ${rel.keywords.join(', ')}`);
			}
			
			if (rel.emojis && rel.emojis.length > 0) {
				console.log(`   😀 Emojis: ${rel.emojis.join(' ')}`);
			}
			
			if (rel.notes && rel.notes.length > 0) {
				console.log(`   📋 Notes: ${rel.notes.join(', ')}`);
			}
		});
	}
	
	console.log(`\n🕒 Retrieved at: ${summary.retrieved_at.toISOString()}`);
}

function formatUserSummaryJSON(summary: UserSummaryResult): void {
	console.log(JSON.stringify(summary, null, 2));
}

async function main() {
	const args = process.argv.slice(2);
	
	if (args.length < 2) {
		console.log("Usage:");
		console.log("  npx tsx get-user-summary.ts <user-id> <guild-id> [--json]");
		console.log("");
		console.log("Examples:");
		console.log("  npx tsx get-user-summary.ts 123456789012345678 987654321098765432");
		console.log("  npx tsx get-user-summary.ts 123456789012345678 987654321098765432 --json");
		console.log("");
		console.log("Options:");
		console.log("  --json    Output in JSON format instead of formatted text");
		process.exit(1);
	}
	
	const userId = args[0];
	const guildId = args[1];
	const jsonOutput = args.includes('--json');
	
	try {
		const summary = await getUserSummary(userId, guildId);
		
		if (jsonOutput) {
			formatUserSummaryJSON(summary);
		} else {
			formatUserSummary(summary);
		}
		
		console.log("\n✅ User summary retrieved successfully!");
		
	} catch (error) {
		console.error("🔸 Script failed:", error);
		process.exit(1);
	}
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

export { getUserSummary, formatUserSummary, formatUserSummaryJSON };
