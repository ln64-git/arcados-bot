#!/usr/bin/env tsx

import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function debugDatabase() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		// Check if we can query the database at all
		console.log("🔹 Testing basic database query...");
		const testQuery = `SELECT count() FROM members GROUP ALL`;
		const countResult = await db.db.query(testQuery);
		console.log(`🔹 Member count query result:`, countResult);

		// Try to get all members
		console.log("\n🔹 Getting all members...");
		const allMembers = await db.db.select("members");
		console.log(`🔹 All members result:`, allMembers);
		console.log(`🔹 Number of members:`, allMembers?.length || 0);

		if (allMembers && allMembers.length > 0) {
			console.log("\n🔹 First few members:");
			allMembers.slice(0, 3).forEach((member: any, index: number) => {
				console.log(`🔹 Member ${index + 1}:`);
				console.log(`  - ID: ${member.id}`);
				console.log(`  - User ID: ${member.user_id}`);
				console.log(`  - Username: ${member.username}`);
				console.log(`  - Guild ID: ${member.guild_id}`);
			});

			// Check specifically for our user
			const ourUser = allMembers.find(
				(m: any) => m.user_id === "354823920010002432",
			);
			if (ourUser) {
				console.log("\n🔹 ✅ Found our user!");
				console.log(`🔹 User ID: ${ourUser.user_id}`);
				console.log(`🔹 Username: ${ourUser.username}`);
				console.log(`🔹 Display Name: ${ourUser.display_name}`);
				console.log(`🔹 Guild ID: ${ourUser.guild_id}`);
			} else {
				console.log("\n🔸 ❌ Our user not found in the members list");
			}
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from SurrealDB");
	}
}

debugDatabase().catch(console.error);
