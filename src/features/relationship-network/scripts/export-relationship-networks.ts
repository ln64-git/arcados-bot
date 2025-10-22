import { SurrealDBManager } from "../../../database/SurrealDBManager";
import type {
	DatabaseResult,
	RelationshipEntry,
	SurrealMember,
} from "../../../database/schema";
import { RelationshipNetworkManager } from "../RelationshipNetworkManager";

/**
 * Script to export relationship network data in various formats
 *
 * This script provides functionality to:
 * - Export relationship networks to JSON
 * - Export to CSV format for analysis
 * - Export specific user networks
 * - Export guild-wide network data
 */

interface ExportOptions {
	format: "json" | "csv";
	includeMetadata: boolean;
	includeInteractions: boolean;
	filterMinScore?: number;
	limit?: number;
}

interface NetworkExportData {
	guild_id: string;
	exported_at: string;
	total_members: number;
	members_with_networks: number;
	networks: {
		user_id: string;
		total_relationships: number;
		relationships: RelationshipEntry[];
	}[];
}

async function exportGuildNetworks(
	guildId: string,
	options: ExportOptions = {
		format: "json",
		includeMetadata: true,
		includeInteractions: true,
	},
): Promise<string> {
	console.log(`🔹 Exporting relationship networks for guild ${guildId}...`);

	const db = new SurrealDBManager();
	const relationshipManager = new RelationshipNetworkManager(db);

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

		const exportData: NetworkExportData = {
			guild_id: guildId,
			exported_at: new Date().toISOString(),
			total_members: members.length,
			members_with_networks: 0,
			networks: [],
		};

		// Process each member
		for (let i = 0; i < members.length; i++) {
			const member = members[i];
			console.log(
				`🔹 Processing member ${i + 1}/${members.length}: ${member.user_id}`,
			);

			// Get member's relationship network
			const networkResult = await relationshipManager.getTopRelationships(
				member.user_id,
				guildId,
				options.limit || 100,
			);

			if (networkResult.success && networkResult.data) {
				let relationships = networkResult.data;

				// Apply filters
				if (options.filterMinScore) {
					relationships = relationships.filter(
						(r) => r.affinity_score >= (options.filterMinScore || 0),
					);
				}

				if (relationships.length > 0) {
					exportData.members_with_networks++;
					exportData.networks.push({
						user_id: member.user_id,
						total_relationships: relationships.length,
						relationships: relationships,
					});
				}
			}
		}

		// Generate filename
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `relationship-networks-${guildId}-${timestamp}.${options.format}`;

		let output: string;

		if (options.format === "json") {
			output = JSON.stringify(exportData, null, 2);
		} else if (options.format === "csv") {
			output = generateCSV(exportData);
		} else {
			throw new Error(`Unsupported format: ${options.format}`);
		}

		// Write to file
		const fs = require("node:fs");
		const path = require("node:path");
		const outputPath = path.join(process.cwd(), "exports", filename);

		// Ensure exports directory exists
		const exportsDir = path.dirname(outputPath);
		if (!fs.existsSync(exportsDir)) {
			fs.mkdirSync(exportsDir, { recursive: true });
		}

		fs.writeFileSync(outputPath, output);
		console.log(`🔹 Exported to: ${outputPath}`);

		// Print summary
		console.log("\n🔹 Export Summary");
		console.log("=".repeat(50));
		console.log(`📁 File: ${filename}`);
		console.log(`📊 Format: ${options.format.toUpperCase()}`);
		console.log(`👥 Total Members: ${exportData.total_members}`);
		console.log(
			`🔗 Members with Networks: ${exportData.members_with_networks}`,
		);
		console.log(
			`📈 Total Relationships: ${exportData.networks.reduce((sum, n) => sum + n.total_relationships, 0)}`,
		);

		return outputPath;
	} catch (error) {
		console.error("🔸 Error exporting networks:", error);
		throw error;
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from database");
	}
}

function generateCSV(data: NetworkExportData): string {
	const lines: string[] = [];

	// CSV Header
	lines.push(
		"guild_id,user_id,relationship_user_id,affinity_score,interaction_count,last_interaction,summary,keywords,emojis,notes",
	);

	// CSV Data
	for (const network of data.networks) {
		for (const relationship of network.relationships) {
			const row = [
				data.guild_id,
				network.user_id,
				relationship.user_id,
				relationship.affinity_score,
				relationship.interaction_count || 0,
				relationship.last_interaction?.toISOString() || "",
				relationship.summary || "",
				relationship.keywords?.join(";") || "",
				relationship.emojis?.join(";") || "",
				relationship.notes || "",
			];
			lines.push(row.join(","));
		}
	}

	return lines.join("\n");
}

/**
 * Export a single user's relationship network
 */
async function exportUserNetwork(
	userId: string,
	guildId: string,
	options: ExportOptions = {
		format: "json",
		includeMetadata: true,
		includeInteractions: true,
	},
): Promise<string> {
	console.log(`🔹 Exporting relationship network for user ${userId}...`);

	const db = new SurrealDBManager();
	const relationshipManager = new RelationshipNetworkManager(db);

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Get user's relationship network
		const networkResult = await relationshipManager.getTopRelationships(
			userId,
			guildId,
			options.limit || 100,
		);

		if (!networkResult.success || !networkResult.data) {
			throw new Error(`Failed to get user network: ${networkResult.error}`);
		}

		let relationships = networkResult.data;

		// Apply filters
		if (options.filterMinScore) {
			relationships = relationships.filter(
				(r) => r.affinity_score >= (options.filterMinScore || 0),
			);
		}

		const exportData = {
			user_id: userId,
			guild_id: guildId,
			exported_at: new Date().toISOString(),
			total_relationships: relationships.length,
			relationships: relationships,
		};

		// Generate filename
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `user-network-${userId}-${timestamp}.${options.format}`;

		let output: string;

		if (options.format === "json") {
			output = JSON.stringify(exportData, null, 2);
		} else if (options.format === "csv") {
			output = generateUserCSV(exportData);
		} else {
			throw new Error(`Unsupported format: ${options.format}`);
		}

		// Write to file
		const fs = require("node:fs");
		const path = require("node:path");
		const outputPath = path.join(process.cwd(), "exports", filename);

		// Ensure exports directory exists
		const exportsDir = path.dirname(outputPath);
		if (!fs.existsSync(exportsDir)) {
			fs.mkdirSync(exportsDir, { recursive: true });
		}

		fs.writeFileSync(outputPath, output);
		console.log(`🔹 Exported to: ${outputPath}`);

		// Print summary
		console.log("\n🔹 Export Summary");
		console.log("=".repeat(50));
		console.log(`📁 File: ${filename}`);
		console.log(`📊 Format: ${options.format.toUpperCase()}`);
		console.log(`👤 User: ${userId}`);
		console.log(`🔗 Total Relationships: ${relationships.length}`);

		return outputPath;
	} catch (error) {
		console.error("🔸 Error exporting user network:", error);
		throw error;
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from database");
	}
}

function generateUserCSV(data: {
	user_id: string;
	relationships: RelationshipEntry[];
}): string {
	const lines: string[] = [];

	// CSV Header
	lines.push(
		"user_id,relationship_user_id,affinity_score,interaction_count,last_interaction,summary,keywords,emojis,notes",
	);

	// CSV Data
	for (const relationship of data.relationships) {
		const row = [
			data.user_id,
			relationship.user_id,
			relationship.affinity_score,
			relationship.interaction_count || 0,
			relationship.last_interaction?.toISOString() || "",
			relationship.summary || "",
			relationship.keywords?.join(";") || "",
			relationship.emojis?.join(";") || "",
			relationship.notes || "",
		];
		lines.push(row.join(","));
	}

	return lines.join("\n");
}

/**
 * Export network statistics summary
 */
async function exportNetworkStats(guildId: string): Promise<string> {
	console.log(`🔹 Exporting network statistics for guild ${guildId}...`);

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

		let totalRelationships = 0;
		let membersWithNetworks = 0;
		const totalAffinityScores: number[] = [];
		const memberStats: Array<{
			user_id: string;
			total_relationships: number;
			average_affinity: number;
			highest_affinity: number;
			lowest_affinity: number;
		}> = [];

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
				const relationships = networkResult.data;
				totalRelationships += relationships.length;

				const affinityScores = relationships.map((r) => r.affinity_score);
				totalAffinityScores.push(...affinityScores);

				const averageAffinity =
					affinityScores.reduce((sum, score) => sum + score, 0) /
					affinityScores.length;

				memberStats.push({
					user_id: member.user_id,
					total_relationships: relationships.length,
					average_affinity: Math.round(averageAffinity * 100) / 100,
					highest_affinity: Math.max(...affinityScores),
					lowest_affinity: Math.min(...affinityScores),
				});
			}
		}

		const statsData = {
			guild_id: guildId,
			exported_at: new Date().toISOString(),
			summary: {
				total_members: members.length,
				members_with_networks: membersWithNetworks,
				total_relationships: totalRelationships,
				average_affinity:
					totalAffinityScores.length > 0
						? Math.round(
								(totalAffinityScores.reduce((sum, score) => sum + score, 0) /
									totalAffinityScores.length) *
									100,
							) / 100
						: 0,
				highest_affinity: Math.max(...totalAffinityScores, 0),
				lowest_affinity: Math.min(...totalAffinityScores, 0),
			},
			member_statistics: memberStats.sort(
				(a, b) => b.total_relationships - a.total_relationships,
			),
		};

		// Generate filename and write file
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `network-stats-${guildId}-${timestamp}.json`;
		const outputPath = require("node:path").join(
			process.cwd(),
			"exports",
			filename,
		);

		const fs = require("node:fs");
		const exportsDir = require("node:path").dirname(outputPath);
		if (!fs.existsSync(exportsDir)) {
			fs.mkdirSync(exportsDir, { recursive: true });
		}

		fs.writeFileSync(outputPath, JSON.stringify(statsData, null, 2));
		console.log(`🔹 Exported stats to: ${outputPath}`);

		return outputPath;
	} catch (error) {
		console.error("🔸 Error exporting stats:", error);
		throw error;
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from database");
	}
}

// Export functions for use in other scripts
export { exportGuildNetworks, exportUserNetwork, exportNetworkStats };

// CLI interface
async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.log("Usage:");
		console.log("  npm run export-networks <guild-id> [format] [options]");
		console.log(
			"  npm run export-user <user-id> <guild-id> [format] [options]",
		);
		console.log("  npm run export-stats <guild-id>");
		console.log("");
		console.log("Formats: json, csv");
		console.log("Options: --min-score=<number>, --limit=<number>");
		console.log("");
		console.log("Examples:");
		console.log("  npm run export-networks 123456789012345678");
		console.log(
			"  npm run export-networks 123456789012345678 csv --min-score=10",
		);
		console.log(
			"  npm run export-user 987654321098765432 123456789012345678 json --limit=50",
		);
		console.log("  npm run export-stats 123456789012345678");
		process.exit(1);
	}

	const command = args[0];

	try {
		switch (command) {
			case "guild":
			case "networks": {
				if (args.length < 2) {
					console.log("🔸 Missing required argument: <guild-id>");
					process.exit(1);
				}
				const format = args[2] || "json";
				const options: ExportOptions = {
					format: format as "json" | "csv",
					includeMetadata: true,
					includeInteractions: true,
				};

				// Parse options
				for (let i = 3; i < args.length; i++) {
					if (args[i].startsWith("--min-score=")) {
						options.filterMinScore = Number.parseInt(args[i].split("=")[1]);
					} else if (args[i].startsWith("--limit=")) {
						options.limit = Number.parseInt(args[i].split("=")[1]);
					}
				}

				await exportGuildNetworks(args[1], options);
				break;
			}

			case "user": {
				if (args.length < 3) {
					console.log("🔸 Missing required arguments: <user-id> <guild-id>");
					process.exit(1);
				}
				const userFormat = args[3] || "json";
				const userOptions: ExportOptions = {
					format: userFormat as "json" | "csv",
					includeMetadata: true,
					includeInteractions: true,
				};

				// Parse options
				for (let i = 4; i < args.length; i++) {
					if (args[i].startsWith("--min-score=")) {
						userOptions.filterMinScore = Number.parseInt(args[i].split("=")[1]);
					} else if (args[i].startsWith("--limit=")) {
						userOptions.limit = Number.parseInt(args[i].split("=")[1]);
					}
				}

				await exportUserNetwork(args[1], args[2], userOptions);
				break;
			}

			case "stats":
				if (args.length < 2) {
					console.log("🔸 Missing required argument: <guild-id>");
					process.exit(1);
				}
				await exportNetworkStats(args[1]);
				break;

			default:
				console.log("🔸 Unknown command:", command);
				console.log("Available commands: guild, user, stats");
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
