#!/usr/bin/env bun
/**
 * Parameter Tuning Script
 *
 * Tests different parameter combinations to see their effect on conversation grouping.
 * Helps identify optimal settings for your specific chat patterns.
 */

import { PostgreSQLManager } from "../../../../database/PostgreSQLManager";
import { config } from "../../../../config/index.js";

interface TuningScenario {
	name: string;
	description: string;
	parameters: {
		requireConnections: boolean;
		minMessages: number;
		mergeTimeGapMinutes: number;
		maxMessageGapHours: number;
	};
}

const scenarios: TuningScenario[] = [
	{
		name: "Current (Strict)",
		description: "Current production settings - very strict",
		parameters: {
			requireConnections: true,
			minMessages: 3,
			mergeTimeGapMinutes: 15,
			maxMessageGapHours: 8,
		},
	},
	{
		name: "Relaxed Validation",
		description: "Allow conversations without explicit replies/mentions",
		parameters: {
			requireConnections: false,
			minMessages: 3,
			mergeTimeGapMinutes: 15,
			maxMessageGapHours: 8,
		},
	},
	{
		name: "Lower Minimum",
		description: "Allow 2-message conversations",
		parameters: {
			requireConnections: true,
			minMessages: 2,
			mergeTimeGapMinutes: 15,
			maxMessageGapHours: 8,
		},
	},
	{
		name: "Aggressive Merging",
		description: "Merge conversations within 30 minutes",
		parameters: {
			requireConnections: true,
			minMessages: 3,
			mergeTimeGapMinutes: 30,
			maxMessageGapHours: 8,
		},
	},
	{
		name: "Balanced (Recommended)",
		description: "Relaxed validation + lower minimum + better merging",
		parameters: {
			requireConnections: false,
			minMessages: 2,
			mergeTimeGapMinutes: 20,
			maxMessageGapHours: 8,
		},
	},
	{
		name: "Very Permissive",
		description: "Maximum grouping - least strict",
		parameters: {
			requireConnections: false,
			minMessages: 2,
			mergeTimeGapMinutes: 30,
			maxMessageGapHours: 12,
		},
	},
];

const db = new PostgreSQLManager();

async function main() {
	const args = process.argv.slice(2);
	const hoursBack = args[0] ? Number.parseInt(args[0], 10) : 24;

	console.log("🔧 Conversation Grouping Parameter Tuner");
	console.log("=".repeat(80));
	console.log(`Time window: Past ${hoursBack} hours`);
	console.log("=".repeat(80));

	const connected = await db.connect();
	if (!connected) {
		console.error("❌ Failed to connect to database");
		process.exit(1);
	}

	const guildId = config.guildId;
	if (!guildId) {
		console.error("❌ No guild ID configured");
		await db.disconnect();
		process.exit(1);
	}

	// Fetch current state
	const messagesResult = await db.query(
		`
    SELECT COUNT(*) as total
    FROM messages m
    LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
    LEFT JOIN channels c ON m.channel_id = c.id
    WHERE m.guild_id = $1
      AND m.created_at > NOW() - INTERVAL '${hoursBack} hours'
      AND m.active = true
      AND COALESCE(mem.bot, false) = false
      AND COALESCE(c.name, '') NOT IN ('vc-logs', 'mod-logs', 'server-logs', 'audit-logs')
    `,
		[guildId]
	);

	const conversationsResult = await db.query(
		`
    SELECT COUNT(*) as total FROM conversation_segments
    WHERE guild_id = $1
      AND start_time > NOW() - INTERVAL '${hoursBack} hours'
    `,
		[guildId]
	);

	const totalMessages =
		messagesResult.success && messagesResult.data?.[0]?.total
			? Number(messagesResult.data[0].total)
			: 0;
	const currentConversations =
		conversationsResult.success && conversationsResult.data?.[0]?.total
			? Number(conversationsResult.data[0].total)
			: 0;

	console.log(`\n📊 CURRENT STATE`);
	console.log("─".repeat(80));
	console.log(`Total messages: ${totalMessages}`);
	console.log(`Current conversations: ${currentConversations}`);

	// Get current mapped/unmapped count
	const mappedResult = await db.query(
		`
    WITH message_conversations AS (
      SELECT m.id
      FROM messages m
      JOIN conversation_segments cs ON cs.guild_id = m.guild_id
      WHERE m.id = ANY(cs.message_ids)
        AND m.guild_id = $1
        AND m.created_at > NOW() - INTERVAL '${hoursBack} hours'
    )
    SELECT
      COUNT(CASE WHEN mc.id IS NOT NULL THEN 1 END) as mapped,
      COUNT(CASE WHEN mc.id IS NULL THEN 1 END) as unmapped
    FROM messages m
    LEFT JOIN message_conversations mc ON m.id = mc.id
    LEFT JOIN members mem ON m.author_id = mem.user_id AND m.guild_id = mem.guild_id
    LEFT JOIN channels c ON m.channel_id = c.id
    WHERE m.guild_id = $1
      AND m.created_at > NOW() - INTERVAL '${hoursBack} hours'
      AND m.active = true
      AND COALESCE(mem.bot, false) = false
      AND COALESCE(c.name, '') NOT IN ('vc-logs', 'mod-logs', 'server-logs', 'audit-logs')
    `,
		[guildId]
	);

	const mapped =
		mappedResult.success && mappedResult.data?.[0]?.mapped
			? Number(mappedResult.data[0].mapped)
			: 0;
	const unmapped =
		mappedResult.success && mappedResult.data?.[0]?.unmapped
			? Number(mappedResult.data[0].unmapped)
			: 0;

	console.log(`Mapped messages: ${mapped} (${((mapped / totalMessages) * 100).toFixed(1)}%)`);
	console.log(`Unmapped messages: ${unmapped} (${((unmapped / totalMessages) * 100).toFixed(1)}%)`);

	// Analyze what would happen with different parameters
	console.log(`\n\n🎯 TUNING SCENARIO PROJECTIONS`);
	console.log("=".repeat(80));
	console.log(
		"\nThese projections estimate how different parameter combinations would affect grouping."
	);
	console.log("Actual results may vary based on message patterns.\n");

	for (const scenario of scenarios) {
		console.log(`\n${scenario.name}`);
		console.log("─".repeat(80));
		console.log(`${scenario.description}`);
		console.log("\nParameters:");
		console.log(`  Require connections: ${scenario.parameters.requireConnections ? "YES" : "NO"}`);
		console.log(`  Minimum messages: ${scenario.parameters.minMessages}`);
		console.log(`  Merge time gap: ${scenario.parameters.mergeTimeGapMinutes} minutes`);
		console.log(`  Max message gap: ${scenario.parameters.maxMessageGapHours} hours`);

		// Estimate impact
		console.log("\nEstimated Impact:");

		// Calculate potential additional mapped messages
		let additionalMapped = 0;
		let conversationChange = 0;

		// If we don't require connections, we can map messages without replies/mentions
		if (!scenario.parameters.requireConnections) {
			// Estimate: ~60% of unmapped messages could be grouped
			additionalMapped += Math.round(unmapped * 0.6);
			console.log(
				`  ✓ +${Math.round(unmapped * 0.6)} messages mapped (removing connection requirement)`
			);
		}

		// If we lower minimum messages to 2
		if (scenario.parameters.minMessages === 2) {
			// Estimate: ~20% more messages from 2-message conversations
			const bonus = Math.round(unmapped * 0.2);
			additionalMapped += bonus;
			console.log(`  ✓ +${bonus} messages from 2-message conversations`);
		}

		// If we increase merge time gap
		if (scenario.parameters.mergeTimeGapMinutes > 15) {
			// Estimate conversation reduction based on current split conversations
			const reductionPercent =
				(scenario.parameters.mergeTimeGapMinutes - 15) / 30;
			conversationChange = -Math.round(currentConversations * reductionPercent * 0.3);
			console.log(
				`  ✓ ${Math.abs(conversationChange)} fewer conversations (better merging)`
			);
		}

		// Calculate new totals
		const newMapped = Math.min(mapped + additionalMapped, totalMessages);
		const newUnmapped = totalMessages - newMapped;
		const newConversations = Math.max(
			currentConversations + conversationChange,
			1
		);
		const newCoverage = ((newMapped / totalMessages) * 100).toFixed(1);

		console.log("\nProjected Results:");
		console.log(`  Mapped: ${newMapped}/${totalMessages} (${newCoverage}%)`);
		console.log(`  Unmapped: ${newUnmapped}`);
		console.log(`  Conversations: ~${newConversations}`);
		console.log(`  Avg messages/conv: ~${(newMapped / newConversations).toFixed(1)}`);

		// Calculate quality score
		const coverageScore = (newMapped / totalMessages) * 100;
		const sizeScore = Math.min((newMapped / newConversations / 10) * 100, 100);
		const qualityScore = (coverageScore + sizeScore) / 2;

		let rating = "";
		if (qualityScore >= 80) rating = "⭐⭐⭐⭐⭐ Excellent";
		else if (qualityScore >= 70) rating = "⭐⭐⭐⭐ Very Good";
		else if (qualityScore >= 60) rating = "⭐⭐⭐ Good";
		else if (qualityScore >= 50) rating = "⭐⭐ Fair";
		else rating = "⭐ Poor";

		console.log(`\nQuality Rating: ${rating}`);
	}

	// Recommendations
	console.log(`\n\n💡 RECOMMENDATIONS`);
	console.log("=".repeat(80));

	const coveragePercent = (mapped / totalMessages) * 100;

	if (coveragePercent < 50) {
		console.log(
			"\n🔴 CRITICAL: Very low coverage (<50%). Strongly recommend relaxing validation."
		);
		console.log("\nSuggested approach:");
		console.log("  1. Try 'Balanced (Recommended)' scenario first");
		console.log("  2. Monitor results with npm run analyze:grouping");
		console.log("  3. Adjust further if needed");
	} else if (coveragePercent < 70) {
		console.log("\n🟡 MODERATE: Coverage below 70%. Consider tuning parameters.");
		console.log("\nSuggested approach:");
		console.log("  1. Start with 'Relaxed Validation' scenario");
		console.log("  2. If still unsatisfied, try 'Balanced (Recommended)'");
	} else {
		console.log(
			"\n🟢 GOOD: Coverage above 70%. Current settings may be acceptable."
		);
		console.log("\nOptional improvements:");
		console.log(
			"  1. Try 'Aggressive Merging' to reduce conversation fragmentation"
		);
		console.log("  2. Monitor with npm run analyze:grouping to verify quality");
	}

	console.log("\n\n📝 HOW TO APPLY CHANGES");
	console.log("=".repeat(80));
	console.log("\nTo implement a scenario, edit these files:");
	console.log(
		"\n1. src/features/social-intelligence/conversation-detection/ConversationValidator.ts"
	);
	console.log("   - Line 131: Comment out or modify validateConnections() requirement");
	console.log("   - Line 13: Change minMessages default value");
	console.log(
		"\n2. src/features/social-intelligence/conversation-detection/ConversationDetector.ts"
	);
	console.log("   - Line 72: Change MIN_MESSAGES constant");
	console.log("   - Line 2126-2127: Adjust merge time gap thresholds");
	console.log("   - Line 85: Change MAX_MESSAGE_GAP_MS if needed");

	console.log(
		"\nAfter making changes, regenerate conversations with:"
	);
	console.log("  npm run regenerate:conversations 24 --clear");

	console.log("\n" + "=".repeat(80));
	console.log("🔹 Analysis complete\n");

	await db.disconnect();
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});
