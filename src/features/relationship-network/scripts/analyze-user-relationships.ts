import { SurrealDBManager } from "../../../database/SurrealDBManager";
import type {
	DatabaseResult,
	RelationshipEntry,
	SurrealMember,
} from "../../../database/schema";
import { RelationshipNetworkManager } from "../RelationshipNetworkManager";

/**
 * Script to analyze a single user's relationship network
 *
 * This script provides detailed analysis of a user's relationships including:
 * - Top relationships by affinity score
 * - Interaction breakdowns
 * - Relationship network statistics
 * - Comparison with other users
 */

interface UserAnalysisResult {
	user_id: string;
	guild_id: string;
	total_relationships: number;
	top_relationships: RelationshipEntry[];
	network_stats: {
		average_affinity: number;
		highest_affinity: number;
		lowest_affinity: number;
		relationships_above_50: number;
		relationships_above_25: number;
		relationships_above_10: number;
	};
	interaction_summary: {
		total_interactions: number;
		most_recent_interaction?: Date;
		oldest_interaction?: Date;
	};
	computed_at: Date;
}

async function analyzeUserRelationships(
	userId: string,
	guildId: string,
	limit = 20,
): Promise<UserAnalysisResult> {
	console.log(
		`🔹 Analyzing relationship network for user ${userId} in guild ${guildId}...`,
	);

	const db = new SurrealDBManager();
	const relationshipManager = new RelationshipNetworkManager(db);

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Get user's relationship network
		const relationshipsResult = await relationshipManager.getTopRelationships(
			userId,
			guildId,
			100, // Get more relationships for better analysis
		);

		if (!relationshipsResult.success || !relationshipsResult.data) {
			throw new Error(
				`Failed to get relationships: ${relationshipsResult.error}`,
			);
		}

		const relationships = relationshipsResult.data;
		const topRelationships = relationships.slice(0, limit);

		// Calculate network statistics
		const affinityScores = relationships.map((r) => r.affinity_score);
		const averageAffinity =
			affinityScores.length > 0
				? affinityScores.reduce((sum, score) => sum + score, 0) /
					affinityScores.length
				: 0;

		const networkStats = {
			average_affinity: Math.round(averageAffinity * 100) / 100,
			highest_affinity: Math.max(...affinityScores, 0),
			lowest_affinity: Math.min(...affinityScores, 0),
			relationships_above_50: affinityScores.filter((s) => s >= 50).length,
			relationships_above_25: affinityScores.filter((s) => s >= 25).length,
			relationships_above_10: affinityScores.filter((s) => s >= 10).length,
		};

		// Calculate interaction summary
		const interactionCounts = relationships.map(
			(r) => r.interaction_count || 0,
		);
		const totalInteractions = interactionCounts.reduce(
			(sum, count) => sum + count,
			0,
		);

		const lastInteractions = relationships
			.map((r) => r.last_interaction)
			.filter((d) => d !== undefined) as Date[];

		const mostRecentInteraction =
			lastInteractions.length > 0
				? new Date(Math.max(...lastInteractions.map((d) => d.getTime())))
				: undefined;

		const oldestInteraction =
			lastInteractions.length > 0
				? new Date(Math.min(...lastInteractions.map((d) => d.getTime())))
				: undefined;

		const result: UserAnalysisResult = {
			user_id: userId,
			guild_id: guildId,
			total_relationships: relationships.length,
			top_relationships: topRelationships,
			network_stats: networkStats,
			interaction_summary: {
				total_interactions,
				most_recent_interaction: mostRecentInteraction,
				oldest_interaction: oldestInteraction,
			},
			computed_at: new Date(),
		};

		// Print analysis results
		printUserAnalysis(result);

		return result;
	} catch (error) {
		console.error("🔸 Error analyzing user relationships:", error);
		throw error;
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from database");
	}
}

function printUserAnalysis(analysis: UserAnalysisResult): void {
	console.log("\n🔹 User Relationship Analysis");
	console.log("=".repeat(50));
	console.log(`👤 User ID: ${analysis.user_id}`);
	console.log(`🏰 Guild ID: ${analysis.guild_id}`);
	console.log(`📊 Total Relationships: ${analysis.total_relationships}`);
	console.log(`🕒 Analyzed at: ${analysis.computed_at.toISOString()}`);

	console.log("\n📈 Network Statistics:");
	console.log(
		`   - Average Affinity: ${analysis.network_stats.average_affinity}`,
	);
	console.log(
		`   - Highest Affinity: ${analysis.network_stats.highest_affinity}`,
	);
	console.log(
		`   - Lowest Affinity: ${analysis.network_stats.lowest_affinity}`,
	);
	console.log(
		`   - Relationships ≥50: ${analysis.network_stats.relationships_above_50}`,
	);
	console.log(
		`   - Relationships ≥25: ${analysis.network_stats.relationships_above_25}`,
	);
	console.log(
		`   - Relationships ≥10: ${analysis.network_stats.relationships_above_10}`,
	);

	console.log("\n💬 Interaction Summary:");
	console.log(
		`   - Total Interactions: ${analysis.interaction_summary.total_interactions}`,
	);
	if (analysis.interaction_summary.most_recent_interaction) {
		console.log(
			`   - Most Recent: ${analysis.interaction_summary.most_recent_interaction.toISOString()}`,
		);
	}
	if (analysis.interaction_summary.oldest_interaction) {
		console.log(
			`   - Oldest: ${analysis.interaction_summary.oldest_interaction.toISOString()}`,
		);
	}

	console.log("\n🏆 Top Relationships:");
	analysis.top_relationships.forEach((rel, index) => {
		const interactionInfo = rel.interaction_count
			? ` (${rel.interaction_count} interactions)`
			: "";
		const lastInteraction = rel.last_interaction
			? ` - Last: ${rel.last_interaction.toISOString().split("T")[0]}`
			: "";

		console.log(
			`   ${index + 1}. ${rel.user_id}: ${rel.affinity_score}${interactionInfo}${lastInteraction}`,
		);
	});
}

/**
 * Compare two users' relationship networks
 */
async function compareUserRelationships(
	user1Id: string,
	user2Id: string,
	guildId: string,
): Promise<void> {
	console.log(
		`🔹 Comparing relationship networks for ${user1Id} and ${user2Id}...`,
	);

	try {
		const [analysis1, analysis2] = await Promise.all([
			analyzeUserRelationships(user1Id, guildId, 10),
			analyzeUserRelationships(user2Id, guildId, 10),
		]);

		console.log("\n🔹 User Comparison");
		console.log("=".repeat(50));
		console.log(`👤 User 1: ${user1Id}`);
		console.log(`👤 User 2: ${user2Id}`);
		console.log(`🏰 Guild: ${guildId}`);

		console.log("\n📊 Comparison:");
		console.log(
			`   User 1 Total Relationships: ${analysis1.total_relationships}`,
		);
		console.log(
			`   User 2 Total Relationships: ${analysis2.total_relationships}`,
		);
		console.log(
			`   User 1 Average Affinity: ${analysis1.network_stats.average_affinity}`,
		);
		console.log(
			`   User 2 Average Affinity: ${analysis2.network_stats.average_affinity}`,
		);
		console.log(
			`   User 1 Highest Affinity: ${analysis1.network_stats.highest_affinity}`,
		);
		console.log(
			`   User 2 Highest Affinity: ${analysis2.network_stats.highest_affinity}`,
		);

		// Check if users have each other in their networks
		const user1HasUser2 = analysis1.top_relationships.some(
			(r) => r.user_id === user2Id,
		);
		const user2HasUser1 = analysis2.top_relationships.some(
			(r) => r.user_id === user1Id,
		);

		console.log("\n🔗 Mutual Relationships:");
		console.log(
			`   ${user1Id} has ${user2Id} in network: ${user1HasUser2 ? "✅" : "❌"}`,
		);
		console.log(
			`   ${user2Id} has ${user1Id} in network: ${user2HasUser1 ? "✅" : "❌"}`,
		);

		if (user1HasUser2) {
			const relationship = analysis1.top_relationships.find(
				(r) => r.user_id === user2Id,
			);
			console.log(`   Affinity score: ${relationship?.affinity_score}`);
		}

		if (user2HasUser1) {
			const relationship = analysis2.top_relationships.find(
				(r) => r.user_id === user1Id,
			);
			console.log(`   Affinity score: ${relationship?.affinity_score}`);
		}
	} catch (error) {
		console.error("🔸 Error comparing users:", error);
		throw error;
	}
}

/**
 * Get relationship network statistics for a guild
 */
async function getGuildNetworkStats(guildId: string): Promise<void> {
	console.log(`🔹 Getting network statistics for guild ${guildId}...`);

	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Get all members in guild
		const membersResult = await db.getMembersByGuild(guildId);
		if (!membersResult.success) {
			throw new Error(`Failed to get guild members: ${membersResult.error}`);
		}

		const members = membersResult.data || [];
		console.log(`🔹 Found ${members.length} members in guild`);

		let totalRelationships = 0;
		let membersWithNetworks = 0;
		const totalAffinityScores: number[] = [];

		for (const member of members) {
			const networkResult = await db.getMemberRelationshipNetwork(
				member.user_id,
				guildId,
			);
			if (
				networkResult.success &&
				networkResult.data &&
				networkResult.data.length > 0
			) {
				membersWithNetworks++;
				totalRelationships += networkResult.data.length;
				totalAffinityScores.push(
					...networkResult.data.map((r) => r.affinity_score),
				);
			}
		}

		const averageAffinity =
			totalAffinityScores.length > 0
				? totalAffinityScores.reduce((sum, score) => sum + score, 0) /
					totalAffinityScores.length
				: 0;

		console.log("\n🔹 Guild Network Statistics");
		console.log("=".repeat(50));
		console.log(`🏰 Guild ID: ${guildId}`);
		console.log(`👥 Total Members: ${members.length}`);
		console.log(`🔗 Members with Networks: ${membersWithNetworks}`);
		console.log(`📊 Total Relationships: ${totalRelationships}`);
		console.log(
			`📈 Average Affinity Score: ${Math.round(averageAffinity * 100) / 100}`,
		);
		console.log(`🎯 Highest Affinity: ${Math.max(...totalAffinityScores, 0)}`);
		console.log(`📉 Lowest Affinity: ${Math.min(...totalAffinityScores, 0)}`);
	} catch (error) {
		console.error("🔸 Error getting guild stats:", error);
		throw error;
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from database");
	}
}

// Export functions for use in other scripts
export {
	analyzeUserRelationships,
	compareUserRelationships,
	getGuildNetworkStats,
};

// CLI interface
async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.log("Usage:");
		console.log("  npm run analyze-user <user-id> <guild-id> [limit]");
		console.log("  npm run compare-users <user1-id> <user2-id> <guild-id>");
		console.log("  npm run guild-stats <guild-id>");
		console.log("");
		console.log("Examples:");
		console.log("  npm run analyze-user 123456789012345678 987654321098765432");
		console.log(
			"  npm run analyze-user 123456789012345678 987654321098765432 15",
		);
		console.log(
			"  npm run compare-users 123456789012345678 987654321098765432 111111111111111111",
		);
		console.log("  npm run guild-stats 111111111111111111");
		process.exit(1);
	}

	const command = args[0];

	try {
		switch (command) {
			case "analyze":
			case "user": {
				if (args.length < 3) {
					console.log(
						"🔸 Missing required arguments: <user-id> <guild-id> [limit]",
					);
					process.exit(1);
				}
				const limit = args[3] ? Number.parseInt(args[3]) : 20;
				await analyzeUserRelationships(args[1], args[2], limit);
				break;
			}

			case "compare":
				if (args.length < 4) {
					console.log(
						"🔸 Missing required arguments: <user1-id> <user2-id> <guild-id>",
					);
					process.exit(1);
				}
				await compareUserRelationships(args[1], args[2], args[3]);
				break;

			case "guild":
			case "stats":
				if (args.length < 2) {
					console.log("🔸 Missing required argument: <guild-id>");
					process.exit(1);
				}
				await getGuildNetworkStats(args[1]);
				break;

			default:
				console.log("🔸 Unknown command:", command);
				console.log("Available commands: analyze, compare, guild");
				process.exit(1);
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
