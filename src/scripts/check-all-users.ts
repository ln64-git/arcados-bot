#!/usr/bin/env tsx

import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function checkAllUsers() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		const userId = "354823920010002432";

		console.log(`🔹 Searching for user ${userId} in all members...`);

		// Query all members to see what's in the database
		const query = `SELECT * FROM members WHERE user_id = '${userId}'`;
		console.log(`🔹 Query: ${query}`);

		const result = await db.db.query(query);
		console.log(`🔹 Query result:`, result);

		if (result && result.length > 0 && result[0].length > 0) {
			console.log(`🔹 Found ${result[0].length} member(s) for user ${userId}`);
			result[0].forEach((member: any, index: number) => {
				console.log(`\n🔹 Member ${index + 1}:`);
				console.log(`  - ID: ${member.id}`);
				console.log(`  - User ID: ${member.user_id}`);
				console.log(`  - Guild ID: ${member.guild_id}`);
				console.log(`  - Username: ${member.username}`);
				console.log(`  - Display Name: ${member.display_name}`);
				console.log(`  - Global Name: ${member.global_name}`);
				console.log(`  - Avatar: ${member.avatar}`);
				console.log(`  - Profile Hash: ${member.profile_hash}`);
				console.log(
					`  - History Entries: ${member.profile_history?.length || 0}`,
				);
				console.log(`  - Created: ${member.created_at}`);
				console.log(`  - Updated: ${member.updated_at}`);
			});
		} else {
			console.log("🔸 No members found for this user");

			// Let's see what members we do have
			console.log("\n🔹 Checking what members exist in database...");
			const allMembersQuery = `SELECT user_id, username, display_name, guild_id FROM members LIMIT 10`;
			const allResult = await db.db.query(allMembersQuery);
			console.log(`🔹 Sample members in database:`, allResult);
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from SurrealDB");
	}
}

checkAllUsers().catch(console.error);
