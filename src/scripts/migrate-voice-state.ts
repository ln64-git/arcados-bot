/**
 * Voice State Migration Script
 *
 * Purpose:
 * - Finalize orphaned sessions (active but no recent activity)
 * - Verify data integrity (voice_states reference active sessions)
 * - Clean up stale data
 *
 * Run with: npm run migrate:voice-state
 */

import { PostgreSQLManager } from "../database/PostgreSQLManager";

async function migrate() {
	const db = new PostgreSQLManager();
	await db.connect();

	console.log("🔹 Starting voice state migration...");

	try {
		// Step 1: Finalize all orphaned sessions (active but no recent activity)
		console.log("🔹 Checking for orphaned sessions...");

		const orphanedResult = await db.query(
			`UPDATE voice_sessions
       SET left_at = NOW(), active = false,
           duration = EXTRACT(EPOCH FROM (NOW() - joined_at))::INTEGER
       WHERE active = true
         AND updated_at < NOW() - INTERVAL '1 hour'
       RETURNING id`,
		);

		if (orphanedResult.success && orphanedResult.data) {
			console.log(
				`✅ Finalized ${orphanedResult.data.length} orphaned sessions`,
			);
		} else {
			console.log("✅ No orphaned sessions found");
		}

		// Step 2: Clean up voice_states that reference inactive sessions
		console.log("🔹 Cleaning up stale voice states...");

		const staleStatesResult = await db.query(
			`DELETE FROM voice_states vs
       WHERE NOT EXISTS (
         SELECT 1 FROM voice_sessions sess
         WHERE sess.id = vs.session_id AND sess.active = true
       )
       RETURNING id`,
		);

		if (staleStatesResult.success && staleStatesResult.data) {
			console.log(
				`✅ Deleted ${staleStatesResult.data.length} stale voice states`,
			);
		} else {
			console.log("✅ No stale voice states found");
		}

		// Step 3: Verify data integrity
		console.log("🔹 Verifying data integrity...");

		// Check for voice_states without corresponding sessions
		const integrityCheck1 = await db.query(
			`SELECT COUNT(*) as count FROM voice_states vs
       WHERE NOT EXISTS (
         SELECT 1 FROM voice_sessions sess
         WHERE sess.id = vs.session_id
       )`,
		);

		if (integrityCheck1.success && integrityCheck1.data) {
			const count = integrityCheck1.data[0]?.count || 0;
			if (count > 0) {
				console.warn(
					`⚠️  Found ${count} voice_states with no corresponding session`,
				);
			} else {
				console.log("✅ All voice_states have corresponding sessions");
			}
		}

		// Check for active sessions without voice_states
		const integrityCheck2 = await db.query(
			`SELECT COUNT(*) as count FROM voice_sessions sess
       WHERE sess.active = true
         AND NOT EXISTS (
           SELECT 1 FROM voice_states vs
           WHERE vs.session_id = sess.id
         )`,
		);

		if (integrityCheck2.success && integrityCheck2.data) {
			const count = integrityCheck2.data[0]?.count || 0;
			if (count > 0) {
				console.warn(
					`⚠️  Found ${count} active sessions with no voice_state`,
				);
			} else {
				console.log("✅ All active sessions have corresponding voice_states");
			}
		}

		// Step 4: Show summary statistics
		console.log("🔹 Migration summary:");

		const summaryResult = await db.query(
			`SELECT
         (SELECT COUNT(*) FROM voice_sessions WHERE active = true) as active_sessions,
         (SELECT COUNT(*) FROM voice_sessions WHERE active = false) as completed_sessions,
         (SELECT COUNT(*) FROM voice_states) as current_states,
         (SELECT COUNT(*) FROM voice_history) as history_entries`,
		);

		if (summaryResult.success && summaryResult.data && summaryResult.data[0]) {
			const summary = summaryResult.data[0];
			console.log(`  Active sessions: ${summary.active_sessions}`);
			console.log(`  Completed sessions: ${summary.completed_sessions}`);
			console.log(`  Current voice states: ${summary.current_states}`);
			console.log(`  History entries: ${summary.history_entries}`);
		}

		console.log("✅ Voice state migration completed successfully");
	} catch (error) {
		console.error("🔸 Migration error:", error);
		throw error;
	} finally {
		await db.disconnect();
	}
}

// Run migration
migrate().catch((error) => {
	console.error("🔸 Fatal error during migration:", error);
	process.exit(1);
});
