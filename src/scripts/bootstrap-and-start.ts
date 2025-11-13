import "dotenv/config";
import { config } from "../config/index.js";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";
import { generateEmbeddingsForGuild } from "./generate-embeddings.js";
import { regenerateConversationsForGuild } from "./regenerate-conversations.js";
import { backfillRecentConversations } from "./backfill-recent-conversations.js";
import { KNOWN_BOT_USER_IDS } from "../features/relationship-network/constants.js";

async function hasMissingEmbeddings(
	db: PostgreSQLManager,
	guildId: string
): Promise<boolean> {
	const result = await db.query(
		`SELECT COUNT(*) AS missing
     FROM messages
     WHERE guild_id = $1
       AND active = true
       AND embedding IS NULL`,
		[guildId]
	);

	if (!result.success || !result.data) {
		console.warn("🔸 Unable to determine embedding status; defaulting to regenerate.");
		return true;
	}

	const missing = Number(result.data[0]?.missing ?? 0);
	return missing > 0;
}

async function hasRecentConversationSegments(
	db: PostgreSQLManager,
	guildId: string,
	lookbackHours: number = 24
): Promise<boolean> {
	const result = await db.query(
		`SELECT COUNT(*) AS segment_count
     FROM conversation_segments
     WHERE guild_id = $1
       AND start_time >= NOW() AT TIME ZONE 'UTC' - ($2::INT || ' hours')::INTERVAL`,
		[guildId, lookbackHours]
	);

	if (!result.success || !result.data) {
		console.warn("🔸 Unable to determine conversation status; defaulting to regenerate.");
		return false;
	}

	const count = Number(result.data[0]?.segment_count ?? 0);
	return count > 0;
}

async function hasUnassignedMessages(
	db: PostgreSQLManager,
	guildId: string,
	lookbackHours: number = 24
): Promise<boolean> {
	const result = await db.query(
		`SELECT COUNT(*) AS unassigned
     FROM messages m
     WHERE m.guild_id = $1
       AND m.active = true
       AND m.created_at >= NOW() AT TIME ZONE 'UTC' - ($2::INT || ' hours')::INTERVAL
       AND m.author_id != ALL($3::TEXT[])
       AND NOT EXISTS (
         SELECT 1
         FROM conversation_segments cs
         WHERE cs.guild_id = m.guild_id
           AND cs.channel_id = m.channel_id
           AND m.id = ANY(cs.message_ids)
       )`,
		[guildId, lookbackHours, KNOWN_BOT_USER_IDS]
	);

	if (!result.success || !result.data) {
		console.warn(
			"🔸 Unable to determine orphaned message status; defaulting to backfill."
		);
		return true;
	}

	const count = Number(result.data[0]?.unassigned ?? 0);
	return count > 0;
}

async function main() {
	const guildId = process.env.GUILD_ID || config.guildId;

	if (!guildId) {
		console.warn(
			"🔸 No GUILD_ID configured. Skipping data bootstrap and starting bot immediately."
		);
		await import("../main.js");
		return;
	}

	console.log(
		`🔹 Starting bootstrap for guild ${guildId} before launching the bot...`
	);

	const db = new PostgreSQLManager();
	await db.connect();

	let needsEmbeddings = true;
	let hasRecentSegments = false;
	let hasUnassigned = true;

	try {
		needsEmbeddings = await hasMissingEmbeddings(db, guildId);
		hasRecentSegments = await hasRecentConversationSegments(db, guildId);
		hasUnassigned = await hasUnassignedMessages(db, guildId);
	} catch (error) {
		console.warn("🔸 Failed to inspect database state; will regenerate everything.", error);
	} finally {
		await db.disconnect();
	}

	if (needsEmbeddings) {
		await generateEmbeddingsForGuild(guildId);
	} else {
		console.log("✅ Embeddings already present – skipping regeneration.");
	}

	if (!hasRecentSegments) {
		await regenerateConversationsForGuild(guildId);
	} else if (hasUnassigned) {
		await backfillRecentConversations(guildId);
	} else {
		console.log("✅ Recent conversation segments already exist – skipping regeneration.");
	}

	const cleanupDb = new PostgreSQLManager();
	if (await cleanupDb.connect()) {
		try {
			await cleanupDb.removeSingleParticipantSegments(guildId);
			console.log("🔹 Pruned single-participant conversation segments.");
		} catch (error) {
			console.warn("🔸 Failed to prune single-participant segments:", error);
		} finally {
			await cleanupDb.disconnect();
		}
	}

	console.log("🔹 Bootstrap complete. Launching bot...\n");
	await import("../main.js");
}

main().catch((error) => {
	console.error("🔸 Bun start bootstrap failed:", error);
	process.exit(1);
});
