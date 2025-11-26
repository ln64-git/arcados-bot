/**
 * View Psychological Profile for a Single User
 *
 * Usage:
 *   GUILD_ID=123456789 USER_ID=987654321 npm run profile:view-user
 */

import { PostgreSQLManager } from "../../../../database/PostgreSQLManager.js";

async function main() {
	const guildId = process.env.GUILD_ID;
	const userId = process.env.USER_ID;

	if (!guildId || !userId) {
		console.error("❌ Error: GUILD_ID and USER_ID environment variables are required");
		console.error("\nUsage:");
		console.error("  GUILD_ID=123456789 USER_ID=987654321 npm run profile:view-user");
		process.exit(1);
	}

	const db = new PostgreSQLManager();
	const connected = await db.connect();

	if (!connected) {
		console.error("❌ Failed to connect to PostgreSQL. Check POSTGRES_URL in your config.");
		process.exit(1);
	}

	try {
		const result = await db.query(
			`
      SELECT 
        display_name,
        username,
        user_id,
        psych_profile,
        behavior_patterns,
        temporal_profile
      FROM members
      WHERE guild_id = $1 AND user_id = $2
      `,
			[guildId, userId]
		);

		if (!result.success || !result.data || result.data.length === 0) {
			console.error("❌ No member found for that guild/user combination.");
			process.exit(1);
		}

		const row = result.data[0] as any;
		const psychProfile = row.psych_profile || {};
		const behaviorPatterns = row.behavior_patterns || {};
		const temporalProfile = row.temporal_profile || {};

		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log("🧠 USER PSYCHOLOGICAL PROFILE");
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log(`Guild ID: ${guildId}`);
		console.log(`User ID:  ${row.user_id}`);
		console.log(
			`Name:     ${row.display_name || row.username || "(unknown)"}\n`
		);

		// MBTI summary
		if (psychProfile.mbti_type) {
			const mbti = psychProfile.mbti_type;
			console.log("MBTI Type:");
			console.log(
				`  ${mbti.type} (${(mbti.confidence * 100).toFixed(0)}% confidence)`
			);
			if (Array.isArray(mbti.descriptors) && mbti.descriptors.length > 0) {
				console.log(`  Descriptors: ${mbti.descriptors.join(", ")}`);
			}
			console.log("");
		}

		// Big Five summary
		if (psychProfile.big_five_proxies) {
			const traits = psychProfile.big_five_proxies;
			console.log("Big Five (0-100%):");

			const entries: Array<[string, any]> = [
				["Extraversion", traits.extraversion],
				["Agreeableness", traits.agreeableness],
				["Conscientiousness", traits.conscientiousness],
				["Neuroticism", traits.neuroticism],
				["Openness", traits.openness],
			];

			for (const [label, t] of entries) {
				if (!t) continue;
				const scorePct =
					typeof t.score === "number" ? (t.score * 100).toFixed(0) : "n/a";
				const confPct =
					typeof t.confidence === "number"
						? (t.confidence * 100).toFixed(0)
						: "n/a";
				console.log(`  ${label}: ${scorePct}% (conf: ${confPct}%)`);

				if (Array.isArray(t.indicators) && t.indicators.length > 0) {
					const indicatorsPreview = t.indicators.slice(0, 5).join(", ");
					console.log(`    Indicators: ${indicatorsPreview}`);
				}
			}

			console.log("");
		}

		// Communication style
		if (psychProfile.communication_style) {
			const cs = psychProfile.communication_style;
			console.log("Communication Style:");
			if (typeof cs.formality === "number") {
				console.log(
					`  Formality: ${(cs.formality * 100).toFixed(0)}% formal`
				);
			}
			if (typeof cs.verbosity === "number") {
				console.log(
					`  Verbosity: ${(cs.verbosity * 100).toFixed(0)}th percentile`
				);
			}
			if (typeof cs.emoji_richness === "number") {
				console.log(
					`  Emoji richness: ${(cs.emoji_richness * 100).toFixed(0)}%`
				);
			}
			if (typeof cs.question_frequency === "number") {
				console.log(
					`  Question rate: ${cs.question_frequency.toFixed(
						2
					)} questions / 100 messages`
				);
			}
			console.log("");
		}

		// Metadata
		if (psychProfile.profile_metadata) {
			const meta = psychProfile.profile_metadata;
			console.log("Profile Metadata:");
			if (typeof meta.message_count_at_analysis === "number") {
				console.log(
					`  Messages at analysis: ${meta.message_count_at_analysis}`
				);
			}
			if (typeof meta.confidence_overall === "number") {
				console.log(
					`  Overall confidence: ${(meta.confidence_overall * 100).toFixed(
						0
					)}%`
				);
			}
			if (meta.last_updated) {
				console.log(`  Last updated: ${meta.last_updated}`);
			}
			if (typeof meta.staleness_threshold === "number") {
				console.log(`  Staleness threshold: ${meta.staleness_threshold} msgs`);
			}
			console.log("");
		}

		// Behavior patterns (high-level)
		if (Object.keys(behaviorPatterns).length > 0) {
			console.log("Behavior Patterns (raw JSON):");
			console.log(JSON.stringify(behaviorPatterns, null, 2));
			console.log("");
		}

		// Temporal profile (high-level)
		if (Object.keys(temporalProfile).length > 0) {
			console.log("Temporal Profile (raw JSON):");
			console.log(JSON.stringify(temporalProfile, null, 2));
			console.log("");
		}

		// Full psych_profile JSON for debugging / deep inspection
		console.log("Full psych_profile JSON:");
		console.log(JSON.stringify(psychProfile, null, 2));
		console.log("");
	} finally {
		await db.disconnect();
	}
}

main().catch((error) => {
	console.error("❌ Fatal error:", error);
	process.exit(1);
});


