import { SurrealDBManager } from "../database/SurrealDBManager";

async function comprehensiveDatabaseTest() {
	const db = new SurrealDBManager();

	try {
		await db.connect();
		console.log("🔹 Connected to database");

		// Test 1: Check all tables
		console.log("🔹 Test 1: Checking all tables...");
		const tables = await db.query("INFO FOR DB");
		console.log("🔹 Tables:", JSON.stringify(tables, null, 2));

		// Test 2: Check all channels regardless of guild
		console.log("\n🔹 Test 2: Checking all channels...");
		const allChannels = await db.query("SELECT * FROM channels");
		console.log("🔹 All channels:", JSON.stringify(allChannels, null, 2));

		// Test 3: Check channels with specific ID format
		console.log("\n🔹 Test 3: Checking channels with specific ID format...");
		const specificChannels = await db.query(
			"SELECT * FROM channels WHERE id CONTAINS '1430060025996378163'",
		);
		console.log(
			"🔹 Specific channels:",
			JSON.stringify(specificChannels, null, 2),
		);

		// Test 4: Check channels with is_user_channel field
		console.log("\n🔹 Test 4: Checking channels with is_user_channel field...");
		const userChannels = await db.query(
			"SELECT * FROM channels WHERE is_user_channel = true",
		);
		console.log("🔹 User channels:", JSON.stringify(userChannels, null, 2));

		// Test 5: Check channels with is_user_channel field (alternative query)
		console.log(
			"\n🔹 Test 5: Checking channels with is_user_channel field (alternative)...",
		);
		const userChannelsAlt = await db.query(
			"SELECT * FROM channels WHERE is_user_channel IS NOT NONE",
		);
		console.log(
			"🔹 User channels (alt):",
			JSON.stringify(userChannelsAlt, null, 2),
		);
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await db.disconnect();
	}
}

comprehensiveDatabaseTest();
