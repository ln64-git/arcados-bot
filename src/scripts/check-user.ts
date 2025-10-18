#!/usr/bin/env tsx

import "dotenv/config";
import { SurrealDBManager } from "../database/SurrealDBManager";

async function checkUser() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to SurrealDB");

		const userId = "354823920010002432";
		const guildId = "1004111007611895808"; // The Hearth guild

		console.log(`🔹 Checking user ${userId} in guild ${guildId}`);

		// Check if user exists in database
		const result = await db.getMember(userId, guildId);

		if (result.success && result.data) {
			console.log("🔹 User found in database:");
			console.log("🔹 Username:", result.data.username);
			console.log("🔹 Display Name:", result.data.display_name);
			console.log("🔹 Global Name:", result.data.global_name);
			console.log("🔹 Avatar:", result.data.avatar);
			console.log("🔹 Nickname:", result.data.nickname);
			console.log("🔹 Profile Hash:", result.data.profile_hash);
			console.log(
				"🔹 Profile History Entries:",
				result.data.profile_history?.length || 0,
			);

			if (
				result.data.profile_history &&
				result.data.profile_history.length > 0
			) {
				console.log("🔹 Latest Profile History:");
				const latest =
					result.data.profile_history[result.data.profile_history.length - 1];
				console.log("  - Changed at:", latest.changed_at);
				console.log("  - Changed fields:", Object.keys(latest.changed_fields));
				console.log("  - Changes:", latest.changed_fields);
			}

			console.log("🔹 Created at:", result.data.created_at);
			console.log("🔹 Updated at:", result.data.updated_at);
		} else {
			console.log("🔸 User not found in database");
			console.log("🔸 Error:", result.error);
		}
	} catch (error) {
		console.error("🔸 Error:", error);
	} finally {
		await db.disconnect();
		console.log("🔹 Disconnected from SurrealDB");
	}
}

checkUser().catch(console.error);
