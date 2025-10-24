import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
	connectionString:
		process.env.POSTGRES_URL || "postgresql://localhost:5432/arcados",
});

async function testUpdate() {
	const client = await pool.connect();

	try {
		console.log("🔹 Testing relationship network update...");

		const testNetwork = [
			{
				user_id: "123456789",
				affinity_percentage: 50.0,
				interaction_count: 10,
				last_interaction: new Date().toISOString(),
			},
		];

		const result = await client.query(
			"UPDATE members SET relationship_network = $1 WHERE user_id = $2 RETURNING user_id, relationship_network",
			[JSON.stringify(testNetwork), "354823920010002432"],
		);

		console.log("✅ Update result:", result.rows[0]);

		// Now test the curl query
		console.log("\n🔹 Testing curl query format:");
		console.log("Content-Type: application/json");
		console.log("");
		console.log(
			JSON.stringify(
				{
					success: true,
					user: {
						user_id: result.rows[0].user_id,
						relationship_network: result.rows[0].relationship_network,
					},
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error("🔸 Error:", error.message);
	} finally {
		client.release();
		await pool.end();
	}
}

testUpdate().catch(console.error);
