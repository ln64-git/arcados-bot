import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function cleanupStaleVoiceStates() {
	const dbManager = new SurrealDBManager();

	try {
		console.log("🔹 Starting cleanup of stale voice state records...");

		// Connect to database
		const connected = await dbManager.connect();
		if (!connected) {
			console.error("🔸 Failed to connect to database");
			return;
		}

		// Count records before cleanup
		const beforeResult = await dbManager.db.query(
			"SELECT count() FROM voice_states WHERE channel_id IS NONE",
		);
		const beforeCount = (beforeResult[0] as any)?.count || 0;
		console.log(
			`📊 Found ${beforeCount} stale voice state records (channel_id IS NONE)`,
		);

		if (beforeCount === 0) {
			console.log("✅ No stale records found - database is clean!");
			return;
		}

		// Delete all records where channel_id IS NONE
		const deleteResult = await dbManager.db.query(
			"DELETE FROM voice_states WHERE channel_id IS NONE",
		);

		console.log("🔹 Cleanup query executed");

		// Count records after cleanup
		const afterResult = await dbManager.db.query(
			"SELECT count() FROM voice_states WHERE channel_id IS NONE",
		);
		const afterCount = (afterResult[0] as any)?.count || 0;

		const cleanedCount = beforeCount - afterCount;
		console.log(`✅ Cleanup complete: Removed ${cleanedCount} stale records`);
		console.log(`📊 Remaining stale records: ${afterCount}`);

		// Show remaining active voice states
		const activeResult = await dbManager.db.query(
			"SELECT count() FROM voice_states WHERE channel_id IS NOT NONE",
		);
		const activeCount = (activeResult[0] as any)?.count || 0;
		console.log(`📊 Active voice states: ${activeCount}`);
	} catch (error) {
		console.error("🔸 Error during cleanup:", error);
	} finally {
		await dbManager.disconnect();
		console.log("🔹 Cleanup complete");
	}
}

cleanupStaleVoiceStates().catch(console.error);
