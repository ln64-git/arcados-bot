import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
	connectionString:
		process.env.POSTGRES_URL || "postgresql://localhost:5432/arcados",
});

async function updateSpecificUsers() {
	const client = await pool.connect();

	try {
		console.log("🔹 Updating specific users with relationship networks...");

		const guildId = process.env.GUILD_ID || "1254694808228986912";

		// Test with a few specific users
		const testUsers = [
			{
				userId: "354823920010002432",
				network: [
					{
						user_id: "436412266313678858",
						affinity_percentage: 18.07,
						interaction_count: 150,
						last_interaction: new Date().toISOString(),
					},
					{
						user_id: "727327856786538606",
						affinity_percentage: 15.13,
						interaction_count: 125,
						last_interaction: new Date().toISOString(),
					},
					{
						user_id: "716817185955250176",
						affinity_percentage: 8.78,
						interaction_count: 73,
						last_interaction: new Date().toISOString(),
					},
				],
			},
			{
				userId: "436412266313678858",
				network: [
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
				],
			},
			{
				userId: "727327856786538606",
				network: [
					{
						user_id: "436412266313678858",
						affinity_percentage: 23.17,
						interaction_count: 200,
						last_interaction: new Date().toISOString(),
					},
					{
						user_id: "354823920010002432",
						affinity_percentage: 12.78,
						interaction_count: 110,
						last_interaction: new Date().toISOString(),
					},
					{
						user_id: "716817185955250176",
						affinity_percentage: 11.41,
						interaction_count: 98,
						last_interaction: new Date().toISOString(),
					},
				],
			},
		];

		for (const user of testUsers) {
			console.log(`\n🔹 Updating user ${user.userId}...`);

			// Try to update first
			const updateResult = await client.query(
				`
                UPDATE members 
                SET relationship_network = $1, updated_at = NOW()
                WHERE user_id = $2 AND guild_id = $3
            `,
				[JSON.stringify(user.network), user.userId, guildId],
			);

			if (updateResult.rowCount === 0) {
				console.log(`   User ${user.userId} not found, inserting...`);
				// Insert if doesn't exist
				await client.query(
					`
                    INSERT INTO members (
                        id, guild_id, user_id, username, display_name, 
                        discriminator, relationship_network, active, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW()
                    )
                `,
					[
						`${guildId}-${user.userId}`,
						guildId,
						user.userId,
						`user_${user.userId}`,
						`User ${user.userId}`,
						"0000",
						JSON.stringify(user.network),
					],
				);
			}

			console.log(
				`✅ Updated user ${user.userId} with ${user.network.length} relationships`,
			);
		}

		// Check final count
		const countResult = await client.query(
			"SELECT COUNT(*) FROM members WHERE relationship_network IS NOT NULL AND jsonb_array_length(relationship_network) > 0",
		);
		console.log(
			`\n📊 Total members with networks: ${countResult.rows[0].count}`,
		);
	} catch (error) {
		console.error("🔸 Error:", error.message);
	} finally {
		client.release();
		await pool.end();
	}
}

updateSpecificUsers().catch(console.error);
