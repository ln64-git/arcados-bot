import "dotenv/config";
import { PostgreSQLManager } from "../features/database/PostgreSQLManager.js";

async function cleanMessages() {
	const db = new PostgreSQLManager();

	try {
		console.log("🔹 Connecting to database...");
		const connected = await db.connect();
		if (!connected) {
			console.error("🔸 Failed to connect");
			return;
		}

		console.log("✅ Connected\n");

		// Get guild ID from command line args or env
		const guildId = process.argv[2] || process.env.GUILD_ID;

		if (!guildId) {
			console.error("🔸 Usage: npm run clean:messages <guild_id>");
			console.error("   Or set GUILD_ID in .env");
			return;
		}

		// Count messages first
		const countResult = await db.query(
			"SELECT COUNT(*) as count FROM messages WHERE guild_id = $1 AND active = true",
			[guildId]
		);

		if (!countResult.success || !countResult.data) {
			console.error("🔸 Failed to count messages");
			return;
		}

		const messageCount = Number.parseInt(
			countResult.data[0].count,
			10
		);

		console.log(
			"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
		);
		console.log(`  Clean Messages for Guild: ${guildId}`);
		console.log(
			"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
		);

		console.log(
			`⚠️  This will delete ${messageCount.toLocaleString()} messages and all derived data.`
		);
		console.log("   The bot will resync them automatically on next startup.\n");

		// Clear related data first (due to foreign key constraints)
		console.log("🗑️  Clearing derived data...");

		// Conversation segments
		const segmentsResult = await db.query(
			"DELETE FROM conversation_segments WHERE guild_id = $1",
			[guildId]
		);
		if (segmentsResult.success) {
			const rowCount = (segmentsResult.data as any)?.rowCount || 0;
			console.log(
				`   ✅ Cleared conversation_segments (deleted ${rowCount} rows)`
			);
		} else {
			console.error(
				`   🔸 Failed to clear conversation_segments: ${segmentsResult.error}`
			);
			throw new Error(
				`Failed to clear conversation_segments: ${segmentsResult.error}`
			);
		}

		// Relationship edges
		const edgesResult = await db.query(
			"DELETE FROM relationship_edges WHERE guild_id = $1",
			[guildId]
		);
		if (edgesResult.success) {
			const rowCount = (edgesResult.data as any)?.rowCount || 0;
			console.log(
				`   ✅ Cleared relationship_edges (deleted ${rowCount} rows)`
			);
		} else {
			console.error(
				`   🔸 Failed to clear relationship_edges: ${edgesResult.error}`
			);
			throw new Error(
				`Failed to clear relationship_edges: ${edgesResult.error}`
			);
		}

		// Relationship pairs
		const pairsResult = await db.query(
			"DELETE FROM relationship_pairs WHERE guild_id = $1",
			[guildId]
		);
		if (pairsResult.success) {
			const rowCount = (pairsResult.data as any)?.rowCount || 0;
			console.log(
				`   ✅ Cleared relationship_pairs (deleted ${rowCount} rows)`
			);
		} else {
			console.error(
				`   🔸 Failed to clear relationship_pairs: ${pairsResult.error}`
			);
			throw new Error(
				`Failed to clear relationship_pairs: ${pairsResult.error}`
			);
		}

		// Messages (last, as other tables may reference it)
		const messagesResult = await db.query(
			"DELETE FROM messages WHERE guild_id = $1",
			[guildId]
		);
		if (messagesResult.success) {
			const rowCount =
				(messagesResult.data as any)?.rowCount || messageCount;
			console.log(`   ✅ Deleted ${rowCount.toLocaleString()} messages`);

			// Verify deletion
			const verifyResult = await db.query(
				"SELECT COUNT(*) as count FROM messages WHERE guild_id = $1 AND active = true",
				[guildId]
			);
			if (verifyResult.success && verifyResult.data) {
				const remaining = Number.parseInt(
					verifyResult.data[0].count,
					10
				);
				if (remaining > 0) {
					console.log(
						`   ⚠️  Warning: ${remaining} messages still remain in database`
					);
				} else {
					console.log(`   ✅ Verified: All messages deleted`);
				}
			}
		} else {
			console.error(
				`   🔸 Failed to delete messages: ${messagesResult.error}`
			);
			throw new Error(`Failed to delete messages: ${messagesResult.error}`);
		}

		// Reset channel watermarks so messages get re-synced
		const watermarkResult = await db.query(
			"UPDATE channels SET last_message_id = NULL, last_message_sync = NULL WHERE guild_id = $1",
			[guildId]
		);
		if (watermarkResult.success) {
			const rowCount = (watermarkResult.data as any)?.rowCount || 0;
			console.log(
				`   ✅ Reset channel watermarks for ${rowCount} channels (will trigger full resync)`
			);

			// Verify watermark reset
			const verifyWatermarks = await db.query(
				"SELECT COUNT(*) as count FROM channels WHERE guild_id = $1 AND last_message_id IS NOT NULL",
				[guildId]
			);
			if (verifyWatermarks.success && verifyWatermarks.data) {
				const remaining = Number.parseInt(
					verifyWatermarks.data[0].count,
					10
				);
				if (remaining > 0) {
					console.log(
						`   ⚠️  Warning: ${remaining} channels still have watermarks`
					);
				} else {
					console.log(`   ✅ Verified: All watermarks reset`);
				}
			}
		} else {
			console.error(
				`   🔸 Failed to reset watermarks: ${watermarkResult.error}`
			);
			throw new Error(`Failed to reset watermarks: ${watermarkResult.error}`);
		}

		console.log(
			"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
		);
		console.log("✅ Messages and derived data cleared!");
		console.log(
			"   Restart the bot to trigger automatic resync with reply references."
		);
		console.log(
			"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
		);
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
	}
}

cleanMessages();
