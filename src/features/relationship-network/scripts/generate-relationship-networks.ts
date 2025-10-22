import { SurrealDBManager } from "../../../database/SurrealDBManager";
import type { DatabaseResult, SurrealMember } from "../../../database/schema";
import { RelationshipNetworkManager } from "../RelationshipNetworkManager";

/**
 * Script to generate relationship networks for all members in a guild
 *
 * This script will:
 * 1. Connect to the database
 * 2. Get all members in the specified guild
 * 3. Generate relationship networks for each member
 * 4. Update the database with computed relationships
 * 5. Provide progress reporting and statistics
 */

interface GenerationStats {
	total_members: number;
	processed_members: number;
	successful_updates: number;
	failed_updates: number;
	total_duration_ms: number;
	errors: string[];
}

async function generateRelationshipNetworks(
	guildId: string,
): Promise<GenerationStats> {
	console.log(
		`🔹 Starting relationship network generation for guild ${guildId}...`,
	);

	const stats: GenerationStats = {
		total_members: 0,
		processed_members: 0,
		successful_updates: 0,
		failed_updates: 0,
		total_duration_ms: 0,
		errors: [],
	};

	const startTime = Date.now();
	const db = new SurrealDBManager();
	const relationshipManager = new RelationshipNetworkManager(db);

	try {
		// Connect to database
		await db.connect();
		console.log("🔹 Connected to database");

		// Get all members in the guild
		const membersResult = await db.getMembersByGuild(guildId);
		if (!membersResult.success) {
			throw new Error(`Failed to get guild members: ${membersResult.error}`);
		}

		const members = membersResult.data || [];
		stats.total_members = members.length;

		console.log(`🔹 Found ${members.length} members in guild`);

		if (members.length === 0) {
			console.log("🔸 No members found in guild, nothing to process");
			return stats;
		}

		// Process each member
		for (let i = 0; i < members.length; i++) {
			const member = members[i];
			stats.processed_members++;

			console.log(
				`🔹 Processing member ${i + 1}/${members.length}: ${member.user_id}`,
			);

			try {
				const memberStartTime = Date.now();
				const updateResult =
					await relationshipManager.updateMemberRelationships(
						member.user_id,
						guildId,
					);

				const memberDuration = Date.now() - memberStartTime;

				if (updateResult.success) {
					stats.successful_updates++;
					console.log(
						`🔹 ✅ Updated relationships for ${member.user_id} (${memberDuration}ms)`,
					);
				} else {
					stats.failed_updates++;
					const error = `Failed to update ${member.user_id}: ${updateResult.error}`;
					stats.errors.push(error);
					console.log(`🔸 ❌ ${error}`);
				}
			} catch (error) {
				stats.failed_updates++;
				const errorMsg = `Exception updating ${member.user_id}: ${error instanceof Error ? error.message : "Unknown error"}`;
				stats.errors.push(errorMsg);
				console.log(`🔸 ❌ ${errorMsg}`);
			}

			// Add a small delay to prevent overwhelming the database
			if (i < members.length - 1) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}

		stats.total_duration_ms = Date.now() - startTime;

		// Print final statistics
		console.log("\n🔹 Generation Complete!");
		console.log(`📊 Statistics:`);
		console.log(`   - Total members: ${stats.total_members}`);
		console.log(`   - Processed: ${stats.processed_members}`);
		console.log(`   - Successful updates: ${stats.successful_updates}`);
		console.log(`   - Failed updates: ${stats.failed_updates}`);
		console.log(`   - Total duration: ${stats.total_duration_ms}ms`);
		console.log(
			`   - Average per member: ${Math.round(stats.total_duration_ms / stats.processed_members)}ms`,
		);

		if (stats.errors.length > 0) {
			console.log(`\n🔸 Errors encountered:`);
			stats.errors.forEach((error, index) => {
				console.log(`   ${index + 1}. ${error}`);
			});
		}

		return stats;
	} catch (error) {
		console.error("🔸 Fatal error during generation:", error);
		throw error;
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from database");
	}
}

/**
 * Generate relationship networks for multiple guilds
 */
async function generateForMultipleGuilds(guildIds: string[]): Promise<void> {
	console.log(
		`🔹 Generating relationship networks for ${guildIds.length} guilds...`,
	);

	const overallStats = {
		total_guilds: guildIds.length,
		processed_guilds: 0,
		total_members: 0,
		total_successful: 0,
		total_failed: 0,
		total_duration_ms: 0,
	};

	const startTime = Date.now();

	for (const guildId of guildIds) {
		console.log(`\n🔹 Processing guild ${guildId}...`);

		try {
			const stats = await generateRelationshipNetworks(guildId);

			overallStats.processed_guilds++;
			overallStats.total_members += stats.total_members;
			overallStats.total_successful += stats.successful_updates;
			overallStats.total_failed += stats.failed_updates;
		} catch (error) {
			console.error(`🔸 Failed to process guild ${guildId}:`, error);
		}
	}

	overallStats.total_duration_ms = Date.now() - startTime;

	console.log("\n🔹 Multi-Guild Generation Complete!");
	console.log(`📊 Overall Statistics:`);
	console.log(`   - Total guilds: ${overallStats.total_guilds}`);
	console.log(`   - Processed guilds: ${overallStats.processed_guilds}`);
	console.log(`   - Total members: ${overallStats.total_members}`);
	console.log(
		`   - Total successful updates: ${overallStats.total_successful}`,
	);
	console.log(`   - Total failed updates: ${overallStats.total_failed}`);
	console.log(`   - Total duration: ${overallStats.total_duration_ms}ms`);
}

// Export functions for use in other scripts
export { generateRelationshipNetworks, generateForMultipleGuilds };

// CLI interface
async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.log("Usage:");
		console.log("  npm run generate-networks <guild-id>");
		console.log("  npm run generate-networks <guild-id1> <guild-id2> ...");
		console.log("");
		console.log("Examples:");
		console.log("  npm run generate-networks 123456789012345678");
		console.log(
			"  npm run generate-networks 123456789012345678 987654321098765432",
		);
		process.exit(1);
	}

	try {
		if (args.length === 1) {
			await generateRelationshipNetworks(args[0]);
		} else {
			await generateForMultipleGuilds(args);
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
