import { Pool } from "pg";
import * as dotenv from "dotenv";
import express from "express";

dotenv.config();

const pool = new Pool({
	connectionString:
		process.env.POSTGRES_URL || "postgresql://localhost:5432/arcados",
});

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());

// Test endpoint - get all members with relationship networks
app.get("/api/members/relationships", async (req, res) => {
	try {
		const client = await pool.connect();

		const result = await client.query(`
            SELECT 
                user_id, 
                username, 
                display_name,
                relationship_network,
                jsonb_array_length(relationship_network) as network_size
            FROM members 
            WHERE relationship_network IS NOT NULL 
                AND jsonb_array_length(relationship_network) > 0
            ORDER BY jsonb_array_length(relationship_network) DESC
            LIMIT 10
        `);

		client.release();

		res.json({
			success: true,
			count: result.rows.length,
			data: result.rows.map((row) => ({
				user_id: row.user_id,
				username: row.username,
				display_name: row.display_name,
				network_size: parseInt(row.network_size),
				top_relationships: row.relationship_network.slice(0, 3).map((rel) => ({
					user_id: rel.user_id,
					affinity_percentage: rel.affinity_percentage,
					interaction_count: rel.interaction_count,
				})),
			})),
		});
	} catch (error) {
		console.error("Error:", error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Test endpoint - get specific user's relationship network
app.get("/api/members/:userId/relationships", async (req, res) => {
	try {
		const { userId } = req.params;
		const client = await pool.connect();

		const result = await client.query(
			`
            SELECT 
                user_id, 
                username, 
                display_name,
                relationship_network
            FROM members 
            WHERE user_id = $1
        `,
			[userId],
		);

		client.release();

		if (result.rows.length === 0) {
			return res.status(404).json({
				success: false,
				error: "User not found",
			});
		}

		const member = result.rows[0];
		const network = member.relationship_network || [];

		res.json({
			success: true,
			user: {
				user_id: member.user_id,
				username: member.username,
				display_name: member.display_name,
			},
			network_size: network.length,
			total_percentage: network.reduce(
				(sum, rel) => sum + rel.affinity_percentage,
				0,
			),
			relationships: network.map((rel) => ({
				user_id: rel.user_id,
				affinity_percentage: rel.affinity_percentage,
				interaction_count: rel.interaction_count,
				last_interaction: rel.last_interaction,
			})),
		});
	} catch (error) {
		console.error("Error:", error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Test endpoint - database stats
app.get("/api/stats", async (req, res) => {
	try {
		const client = await pool.connect();

		const totalMembers = await client.query("SELECT COUNT(*) FROM members");
		const membersWithNetworks = await client.query(`
            SELECT COUNT(*) FROM members 
            WHERE relationship_network IS NOT NULL 
                AND jsonb_array_length(relationship_network) > 0
        `);

		client.release();

		res.json({
			success: true,
			stats: {
				total_members: parseInt(totalMembers.rows[0].count),
				members_with_networks: parseInt(membersWithNetworks.rows[0].count),
				members_without_networks:
					parseInt(totalMembers.rows[0].count) -
					parseInt(membersWithNetworks.rows[0].count),
				coverage_percentage: (
					(parseInt(membersWithNetworks.rows[0].count) /
						parseInt(totalMembers.rows[0].count)) *
					100
				).toFixed(2),
			},
		});
	} catch (error) {
		console.error("Error:", error);
		res.status(500).json({ success: false, error: error.message });
	}
});

// Health check
app.get("/api/health", (req, res) => {
	res.json({
		success: true,
		message: "Relationship Network API is running",
		timestamp: new Date().toISOString(),
	});
});

app.listen(PORT, () => {
	console.log(
		`🔹 Relationship Network API server running on http://localhost:${PORT}`,
	);
	console.log(`🔹 Available endpoints:`);
	console.log(`   - GET /api/health`);
	console.log(`   - GET /api/stats`);
	console.log(`   - GET /api/members/relationships`);
	console.log(`   - GET /api/members/:userId/relationships`);
	console.log(`🔹 Test with: curl http://localhost:${PORT}/api/health`);
});
