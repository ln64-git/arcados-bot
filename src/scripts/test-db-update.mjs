import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
	connectionString:
		process.env.POSTGRES_URL || "postgresql://localhost:5432/arcados",
});

async function testDatabaseUpdate() {
	const client = await pool.connect();

	try {
		console.log("🔹 Testing database update...");

		// Test updating a user with a real relationship network
		const testNetwork = [
			{
				user_id: "716817185955250176",
				affinity_percentage: 69.94,
				interaction_count: 1200,
				last_interaction: new Date().toISOString(),
			},
			{
				user_id: "727327856786538606",
				affinity_percentage: 7.75,
				interaction_count: 133,
				last_interaction: new Date().toISOString(),
			},
			{
				user_id: "354823920010002432",
				affinity_percentage: 4.81,
				interaction_count: 82,
				last_interaction: new Date().toISOString(),
			},
		];

		const result = await client.query(
			"UPDATE members SET relationship_network = $1 WHERE user_id = $2 RETURNING user_id, jsonb_array_length(relationship_network) as network_size",
			[JSON.stringify(testNetwork), "436412266313678858"],
		);

		console.log("✅ Update result:", result.rows[0]);

		// Now check the count
		const countResult = await client.query(
			"SELECT COUNT(*) FROM members WHERE relationship_network IS NOT NULL AND jsonb_array_length(relationship_network) > 0",
		);
		console.log("📊 Total members with networks:", countResult.rows[0].count);
	} catch (error) {
		console.error("🔸 Error:", error.message);
	} finally {
		client.release();
		await pool.end();
	}
}

testDatabaseUpdate().catch(console.error);
